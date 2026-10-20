import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  createService,
  decryptBackupEnvelope
} from './server.mjs';

const TOKEN = 'test-token-' + 'x'.repeat(64);
const ORIGIN = 'https://pwa.example.test';
const RUN_ID = '550e8400-e29b-41d4-a716-446655440000';
const RUN_ID_2 = '550e8400-e29b-41d4-a716-446655440001';
const KEY = randomBytes(32).toString('base64');

function payload(id = RUN_ID) {
  return {
    schemaVersion: 1,
    run: {
      id,
      status: 'completed',
      startedAt: 1710000000000,
      endedAt: 1710001800000,
      pausedDurationMs: 0,
      activeDurationSec: 1800,
      distanceM: 5000,
      avgPaceSecPerKm: 360,
      starsEarned: 1,
      createdAt: 1710000000000,
      updatedAt: 1710001800000
    },
    routePoints: [{
      runId: id,
      sequence: 0,
      timestamp: 1710000000000,
      latitude: 41.01,
      longitude: 28.97,
      accuracyM: 8,
      altitudeM: 20,
      speedMps: 2.7
    }],
    starEvents: []
  };
}

function appState() {
  return {
    schemaVersion: 1,
    tracks: [{ id: 'track-01', name: 'Park turu', representativeRunId: RUN_ID, distanceM: 5000, bestDurationSec: 1800 }],
    weeklyProgress: [{ weekKey: '2026-10-19', targetRuns: 3, completedRuns: 1, status: 'in_progress', flexUsed: false }],
    settings: { backupToken: '' }
  };
}

async function makeTempService(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-backup-test-'));
  const service = createService({
    host: '127.0.0.1',
    port: 0,
    token: TOKEN,
    allowedOrigin: ORIGIN,
    dataDir: path.join(root, 'data'),
    backupDir: path.join(root, 'backups'),
    now: () => new Date('2026-10-19T12:00:00.000Z'),
    ...options
  });
  await service.start();
  const address = service.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return { root, service, baseUrl };
}

async function closeTempService(context) {
  await context.service.close();
  await fs.rm(context.root, { recursive: true, force: true });
}

async function request(baseUrl, route, options = {}) {
  return fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers ?? {})
    }
  });
}

function authHeaders() {
  return { Authorization: `Bearer ${TOKEN}` };
}

test('protects API routes, enforces exact CORS, and stores runs idempotently', async () => {
  const context = await makeTempService();
  try {
    const health = await request(context.baseUrl, '/health', { headers: { Origin: ORIGIN } });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal((await health.json()).ok, true);

    const wrongOrigin = await request(context.baseUrl, '/health', { headers: { Origin: 'https://evil.example' } });
    assert.equal(wrongOrigin.status, 403);

    const unauthenticated = await request(context.baseUrl, '/api/v1/runs', {
      method: 'POST',
      body: JSON.stringify(payload()),
      headers: { Origin: ORIGIN }
    });
    assert.equal(unauthenticated.status, 401);

    const stored = await request(context.baseUrl, '/api/v1/runs', {
      method: 'POST',
      body: JSON.stringify(payload()),
      headers: { ...authHeaders(), Origin: ORIGIN }
    });
    assert.equal(stored.status, 201);
    assert.equal((await stored.json()).status, 'stored');

    const duplicate = await request(context.baseUrl, '/api/runs', {
      method: 'POST',
      body: JSON.stringify(payload()),
      headers: authHeaders()
    });
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).status, 'duplicate');

    const stateResponse = await request(context.baseUrl, '/api/v1/state', {
      method: 'POST',
      body: JSON.stringify(appState()),
      headers: authHeaders()
    });
    assert.equal(stateResponse.status, 200);
    assert.equal((await stateResponse.json()).status, 'stored');

    const conflictPayload = payload();
    conflictPayload.run.distanceM = 5001;
    const conflict = await request(context.baseUrl, '/api/v1/runs', {
      method: 'POST',
      body: JSON.stringify(conflictPayload),
      headers: authHeaders()
    });
    assert.equal(conflict.status, 409);

    const exported = await request(context.baseUrl, '/api/v1/export', { headers: authHeaders() });
    assert.equal(exported.status, 200);
    const exportBody = await exported.json();
    assert.equal(exportBody.count, 1);
    assert.equal(exportBody.runs[0].run.id, RUN_ID);
    assert.equal(exportBody.tracks[0].name, 'Park turu');
    assert.equal(exportBody.weeklyProgress[0].status, 'in_progress');
    assert.equal(exportBody.settings.backupToken, '');

    const runFile = path.join(context.service.config.runsDir, `${RUN_ID}.json`);
    assert.equal((await fs.stat(runFile)).mode & 0o777, 0o600);
  } finally {
    await closeTempService(context);
  }
});

test('rejects invalid completed-run payloads and oversized request bodies', async () => {
  const context = await makeTempService({ maxBodyBytes: 4096 });
  try {
    const invalid = payload();
    invalid.run.status = 'recording';
    const invalidResponse = await request(context.baseUrl, '/api/v1/runs', {
      method: 'POST',
      body: JSON.stringify(invalid),
      headers: authHeaders()
    });
    assert.equal(invalidResponse.status, 422);

    const oversized = await request(context.baseUrl, '/api/v1/runs', {
      method: 'POST',
      body: JSON.stringify({ padding: 'x'.repeat(5000) }),
      headers: authHeaders()
    });
    assert.equal(oversized.status, 413);
  } finally {
    await closeTempService(context);
  }
});

test('supports authenticated batch import/restore and sync export', async () => {
  const context = await makeTempService();
  try {
    const imported = await request(context.baseUrl, '/api/v1/restore', {
      method: 'POST',
      body: JSON.stringify({ runs: [payload(RUN_ID_2)] }),
      headers: authHeaders()
    });
    assert.equal(imported.status, 200);
    assert.equal((await imported.json()).count, 1);

    const sync = await request(context.baseUrl, '/api/v1/sync', { headers: authHeaders() });
    assert.equal(sync.status, 200);
    assert.equal((await sync.json()).count, 1);

    const unauthenticatedRestore = await request(context.baseUrl, '/api/v1/restore', {
      method: 'POST',
      body: JSON.stringify({ runs: [payload()] })
    });
    assert.equal(unauthenticatedRestore.status, 401);
  } finally {
    await closeTempService(context);
  }
});

test('writes gzip plus AES-256-GCM backup and never passes plaintext to Telegram', async () => {
  const telegramFiles = [];
  const context = await makeTempService({
    encryptionKey: KEY,
    telegramBotToken: 'bot-token-not-real',
    telegramChatId: '123456',
    telegramSender: async (filePath) => {
      telegramFiles.push({ filePath, bytes: await fs.readFile(filePath) });
    }
  });
  try {
    telegramFiles.length = 0; // startup catch-up intentionally creates today's empty backup
    const stored = await request(context.baseUrl, '/api/v1/runs', {
      method: 'POST',
      body: JSON.stringify(payload()),
      headers: authHeaders()
    });
    assert.equal(stored.status, 201);
    await context.service.saveAppState(appState());
    const backup = await context.service.backupNow({ force: true });
    assert.equal(backup.telegram, 'sent');
    assert.equal(telegramFiles.length, 1);
    assert.match(telegramFiles[0].filePath, /runs-2026-10-19\.json\.gz\.enc$/u);

    const raw = telegramFiles[0].bytes.toString('utf8');
    assert.equal(raw.includes(RUN_ID), false);
    const envelope = JSON.parse(raw);
    const decrypted = await decryptBackupEnvelope(envelope, KEY);
    assert.equal(decrypted.runs[0].run.id, RUN_ID);
    assert.equal(decrypted.runs[0].routePoints[0].latitude, 41.01);
    assert.equal(decrypted.state.tracks[0].name, 'Park turu');
  } finally {
    await closeTempService(context);
  }
});

test('continues local backup and reports Telegram disabled when credentials are absent', async () => {
  const context = await makeTempService({ encryptionKey: KEY });
  try {
    const result = await context.service.backupNow({ force: true });
    assert.equal(result.ok, true);
    assert.equal(result.telegram, 'disabled');
    assert.match(result.reason, /Telegram credentials/u);
    const files = await fs.readdir(context.service.config.backupDir);
    assert.ok(files.some((file) => file.endsWith('.json.gz.enc')));
  } finally {
    await closeTempService(context);
  }
});
