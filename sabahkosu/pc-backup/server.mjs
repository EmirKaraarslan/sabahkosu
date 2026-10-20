import http from 'node:http';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNS_DIR_NAME = 'runs';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_POINTS = 100_000;
const DEFAULT_MAX_STAR_EVENTS = 50_000;
const DEFAULT_MAX_BATCH_RUNS = 100;
const BACKUP_AAD_PREFIX = 'pc-backup-v1:';

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function assertFiniteNumber(value, field, { min, max } = {}) {
  if (!isFiniteNumber(value)) throw new HttpError(422, 'invalid_payload', `${field} must be a finite number`);
  if (min !== undefined && value < min) throw new HttpError(422, 'invalid_payload', `${field} is below the allowed range`);
  if (max !== undefined && value > max) throw new HttpError(422, 'invalid_payload', `${field} is above the allowed range`);
}

function assertString(value, field, { maxLength = 1000, nonEmpty = true } = {}) {
  if (typeof value !== 'string' || (nonEmpty && value.trim() === '') || value.length > maxLength) {
    throw new HttpError(422, 'invalid_payload', `${field} must be a string of at most ${maxLength} characters`);
  }
}

function assertUuid(value, field = 'run.id') {
  assertString(value, field, { maxLength: 36 });
  if (!UUID_RE.test(value)) throw new HttpError(422, 'invalid_payload', `${field} must be a UUID`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function validateRunObject(run) {
  if (!isPlainObject(run)) throw new HttpError(422, 'invalid_payload', 'run must be an object');
  assertUuid(run.id);
  if (run.status !== 'completed') {
    throw new HttpError(422, 'invalid_payload', 'only completed runs can be backed up');
  }
  const numericFields = [
    'startedAt', 'endedAt', 'lastResumedAt', 'pausedDurationMs', 'activeDurationSec',
    'distanceM', 'createdAt', 'updatedAt', 'starsEarned'
  ];
  for (const field of numericFields) {
    if (run[field] !== undefined) assertFiniteNumber(run[field], `run.${field}`);
  }
  if (run.avgPaceSecPerKm !== undefined && run.avgPaceSecPerKm !== null) {
    assertFiniteNumber(run.avgPaceSecPerKm, 'run.avgPaceSecPerKm');
  }
  if (run.trackId !== undefined && run.trackId !== null) assertString(run.trackId, 'run.trackId', { maxLength: 200 });
  if (run.survey !== undefined && !isPlainObject(run.survey)) {
    throw new HttpError(422, 'invalid_payload', 'run.survey must be an object');
  }
}

function validateRoutePoints(routePoints, runId) {
  if (!Array.isArray(routePoints)) throw new HttpError(422, 'invalid_payload', 'routePoints must be an array');
  if (routePoints.length > DEFAULT_MAX_POINTS) {
    throw new HttpError(422, 'invalid_payload', `routePoints cannot contain more than ${DEFAULT_MAX_POINTS} points`);
  }
  const sequences = new Set();
  for (const [index, point] of routePoints.entries()) {
    if (!isPlainObject(point)) throw new HttpError(422, 'invalid_payload', `routePoints[${index}] must be an object`);
    if (point.runId !== runId) throw new HttpError(422, 'invalid_payload', `routePoints[${index}].runId must match run.id`);
    if (!Number.isInteger(point.sequence) || point.sequence < 0) {
      throw new HttpError(422, 'invalid_payload', `routePoints[${index}].sequence must be a non-negative integer`);
    }
    if (sequences.has(point.sequence)) throw new HttpError(422, 'invalid_payload', 'routePoints.sequence values must be unique');
    sequences.add(point.sequence);
    assertFiniteNumber(point.timestamp, `routePoints[${index}].timestamp`);
    assertFiniteNumber(point.latitude, `routePoints[${index}].latitude`, { min: -90, max: 90 });
    assertFiniteNumber(point.longitude, `routePoints[${index}].longitude`, { min: -180, max: 180 });
    assertFiniteNumber(point.accuracyM, `routePoints[${index}].accuracyM`, { min: 0 });
    if (point.altitudeM !== undefined) assertFiniteNumber(point.altitudeM, `routePoints[${index}].altitudeM`);
    if (point.speedMps !== undefined) assertFiniteNumber(point.speedMps, `routePoints[${index}].speedMps`, { min: 0 });
  }
}

function validateStarEvents(starEvents, runId) {
  if (!Array.isArray(starEvents)) throw new HttpError(422, 'invalid_payload', 'starEvents must be an array');
  if (starEvents.length > DEFAULT_MAX_STAR_EVENTS) {
    throw new HttpError(422, 'invalid_payload', `starEvents cannot contain more than ${DEFAULT_MAX_STAR_EVENTS} events`);
  }
  for (const [index, event] of starEvents.entries()) {
    if (!isPlainObject(event)) throw new HttpError(422, 'invalid_payload', `starEvents[${index}] must be an object`);
    assertString(event.id, `starEvents[${index}].id`, { maxLength: 200 });
    if (event.runId !== runId) throw new HttpError(422, 'invalid_payload', `starEvents[${index}].runId must match run.id`);
    assertString(event.reason, `starEvents[${index}].reason`, { maxLength: 100 });
    assertFiniteNumber(event.amount, `starEvents[${index}].amount`);
    assertFiniteNumber(event.createdAt, `starEvents[${index}].createdAt`);
    assertString(event.weekKey, `starEvents[${index}].weekKey`, { maxLength: 100 });
  }
}

function normalizeIndexedDbPayload(input) {
  if (!isPlainObject(input)) throw new HttpError(422, 'invalid_payload', 'request body must be a JSON object');
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1) {
    throw new HttpError(422, 'invalid_payload', 'schemaVersion must be 1');
  }
  if (!isPlainObject(input.run) || input.routePoints === undefined) {
    return normalizeCompactPayload(input);
  }
  const sourceRun = canonicalize(input.run);
  const runId = sourceRun.id?.toLowerCase();
  const run = canonicalize({ ...sourceRun, id: runId });
  validateRunObject(run);
  const routePoints = canonicalize(input.routePoints).map((point) => ({ ...point, runId }));
  const starEvents = (input.starEvents === undefined ? [] : canonicalize(input.starEvents)).map((event) => ({ ...event, runId }));
  validateRoutePoints(routePoints, run.id);
  validateStarEvents(starEvents, run.id);
  return canonicalize({ schemaVersion: 1, run, routePoints, starEvents });
}

function normalizeCompactPayload(input) {
  const runIdValue = input.runId ?? input.id;
  assertUuid(runIdValue, 'runId');
  const runId = runIdValue.toLowerCase();
  const completedAt = input.completedAt;
  assertString(completedAt, 'completedAt', { maxLength: 100 });
  const parsedCompletedAt = Date.parse(completedAt);
  if (!Number.isFinite(parsedCompletedAt)) throw new HttpError(422, 'invalid_payload', 'completedAt must be an ISO date');
  if (!Array.isArray(input.gpsPoints)) throw new HttpError(422, 'invalid_payload', 'gpsPoints must be an array');
  const routePoints = input.gpsPoints.map((point, index) => {
    if (!isPlainObject(point)) throw new HttpError(422, 'invalid_payload', `gpsPoints[${index}] must be an object`);
    const latitude = point.latitude ?? point.lat;
    const longitude = point.longitude ?? point.lon ?? point.lng;
    const timestamp = point.timestamp ?? point.recordedAt;
    const accuracyM = point.accuracyM ?? point.accuracyMeters ?? 0;
    return {
      runId,
      sequence: point.sequence ?? index,
      timestamp,
      latitude,
      longitude,
      accuracyM,
      ...(point.altitudeM === undefined ? {} : { altitudeM: point.altitudeM }),
      ...(point.speedMps === undefined ? {} : { speedMps: point.speedMps })
    };
  });
  const run = {
    id: runId,
    status: 'completed',
    completedAt,
    endedAt: parsedCompletedAt,
    ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata })
  };
  validateRunObject(run);
  validateRoutePoints(routePoints, runId);
  return canonicalize({ schemaVersion: 1, run, routePoints, starEvents: [] });
}

function decodeEncryptionKey(value) {
  if (Buffer.isBuffer(value)) {
    if (value.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes');
    return Buffer.from(value);
  }
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes');
  return key;
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolvePath(value, fallback) {
  const selected = value || fallback;
  return path.isAbsolute(selected) ? selected : path.resolve(MODULE_DIR, selected);
}

function loadDotEnv(filePath = path.join(MODULE_DIR, '.env')) {
  try {
    const text = requireReadFileSync(filePath);
    for (const rawLine of text.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function requireReadFileSync(filePath) {
  // Kept tiny and dependency-free so .env loading does not require a package.
  return readFileSync(filePath, 'utf8');
}

function makeConfig(options = {}) {
  const env = { ...process.env, ...(options.env ?? {}) };
  let encryptionKey = null;
  let encryptionKeyError = null;
  const suppliedKey = options.encryptionKey ?? env.BACKUP_ENCRYPTION_KEY;
  if (suppliedKey) {
    try {
      encryptionKey = decodeEncryptionKey(suppliedKey);
    } catch (error) {
      encryptionKeyError = error instanceof Error ? error.message : 'invalid encryption key';
    }
  }
  const allowedOrigin = options.allowedOrigin !== undefined ? options.allowedOrigin : (env.ALLOWED_ORIGIN ?? '');
  const telegramBotToken = options.telegramBotToken ?? (env.TELEGRAM_BOT_TOKEN ?? '');
  const telegramChatId = options.telegramChatId ?? (env.TELEGRAM_CHAT_ID ?? '');
  const dataDir = resolvePath(options.dataDir ?? env.DATA_DIR, path.join(MODULE_DIR, 'data'));
  const backupDir = resolvePath(options.backupDir ?? env.BACKUP_DIR, path.join(MODULE_DIR, 'backups'));
  return {
    host: options.host ?? env.HOST ?? '127.0.0.1',
    port: Number(options.port ?? env.PORT ?? 8787),
    authToken: options.authToken ?? options.token ?? env.AUTH_TOKEN ?? '',
    allowedOrigin: String(allowedOrigin).trim(),
    maxBodyBytes: options.maxBodyBytes ?? parsePositiveInteger(env.MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES),
    dataDir,
    runsDir: path.join(dataDir, RUNS_DIR_NAME),
    stateFilePath: path.join(dataDir, 'app-state.json'),
    backupDir,
    backupManifestPath: path.join(backupDir, 'manifest.json'),
    encryptionKey,
    encryptionKeyError,
    telegramBotToken: String(telegramBotToken).trim(),
    telegramChatId: String(telegramChatId).trim(),
    telegramTimeoutMs: options.telegramTimeoutMs ?? parsePositiveInteger(env.TELEGRAM_TIMEOUT_MS, 20_000),
    now: options.now ?? (() => new Date()),
    telegramSender: options.telegramSender ?? sendTelegramDocument,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    maxBatchRuns: options.maxBatchRuns ?? DEFAULT_MAX_BATCH_RUNS
  };
}

async function ensureDirectories(config) {
  await fs.mkdir(config.runsDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(config.backupDir, { recursive: true, mode: 0o700 });
  await fs.chmod(config.runsDir, 0o700).catch(() => {});
  await fs.chmod(config.backupDir, 0o700).catch(() => {});
}

async function atomicWrite(filePath, content) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`;
  try {
    await fs.writeFile(temporaryPath, content, { mode: 0o600 });
    const handle = await fs.open(temporaryPath, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporaryPath, filePath);
    await fs.chmod(filePath, 0o600).catch(() => {});
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function readJson(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content);
}

async function readStoredPayload(filePath) {
  let stored;
  try {
    stored = await readJson(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') throw error;
    throw new Error('a stored run file is unreadable');
  }
  if (!isPlainObject(stored) || stored.format !== 'pc-run-v1' || !isPlainObject(stored.payload)) {
    throw new Error('a stored run file has an invalid format');
  }
  try {
    return normalizeIndexedDbPayload(stored.payload);
  } catch {
    throw new Error('a stored run file contains an invalid payload');
  }
}

function runFilePath(config, runId) {
  return path.join(config.runsDir, `${runId.toLowerCase()}.json`);
}

async function storeNormalizedRun(config, payload) {
  const runId = payload.run.id.toLowerCase();
  const filePath = runFilePath(config, runId);
  let existing;
  try {
    existing = await readStoredPayload(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      existing = null;
    } else if (error instanceof Error && error.message.startsWith('a stored run file')) {
      throw new HttpError(500, 'storage_error', 'a stored run file is unreadable');
    } else {
      throw error;
    }
  }
  if (existing) {
    if (stableJson(existing) === stableJson(payload)) return { status: 'duplicate', runId };
    throw new HttpError(409, 'run_conflict', 'this run UUID already contains different data');
  }
  const stored = {
    format: 'pc-run-v1',
    receivedAt: new Date().toISOString(),
    payload
  };
  await atomicWrite(filePath, JSON.stringify(stored));
  return { status: 'stored', runId };
}

async function storeRun(config, input) {
  const payload = normalizeIndexedDbPayload(input);
  return storeNormalizedRun(config, payload);
}

function normalizeAppState(input) {
  if (!isPlainObject(input) || (input.schemaVersion !== undefined && input.schemaVersion !== 1)) {
    throw new HttpError(422, 'invalid_state', 'state must be a version 1 JSON object');
  }
  const tracks = input.tracks ?? [];
  const weeklyProgress = input.weeklyProgress ?? [];
  if (!Array.isArray(tracks) || tracks.length > 10_000) throw new HttpError(422, 'invalid_state', 'tracks must be a bounded array');
  if (!Array.isArray(weeklyProgress) || weeklyProgress.length > 10_000) throw new HttpError(422, 'invalid_state', 'weeklyProgress must be a bounded array');
  for (const [index, track] of tracks.entries()) {
    if (!isPlainObject(track)) throw new HttpError(422, 'invalid_state', `tracks[${index}] must be an object`);
    assertString(track.id, `tracks[${index}].id`, { maxLength: 200 });
    assertString(track.name, `tracks[${index}].name`, { maxLength: 200 });
    assertString(track.representativeRunId, `tracks[${index}].representativeRunId`, { maxLength: 100 });
    assertFiniteNumber(track.distanceM, `tracks[${index}].distanceM`, { min: 0 });
    assertFiniteNumber(track.bestDurationSec, `tracks[${index}].bestDurationSec`, { min: 0 });
  }
  for (const [index, week] of weeklyProgress.entries()) {
    if (!isPlainObject(week)) throw new HttpError(422, 'invalid_state', `weeklyProgress[${index}] must be an object`);
    assertString(week.weekKey, `weeklyProgress[${index}].weekKey`, { maxLength: 20 });
    assertFiniteNumber(week.targetRuns, `weeklyProgress[${index}].targetRuns`, { min: 1, max: 7 });
    assertFiniteNumber(week.completedRuns, `weeklyProgress[${index}].completedRuns`, { min: 0 });
    if (!['in_progress', 'goal_met', 'missed', 'protected_by_flex'].includes(week.status)) {
      throw new HttpError(422, 'invalid_state', `weeklyProgress[${index}].status is invalid`);
    }
  }
  const settings = input.settings === undefined || input.settings === null ? null : input.settings;
  if (settings !== null && !isPlainObject(settings)) throw new HttpError(422, 'invalid_state', 'settings must be an object or null');
  if (settings?.backupToken) throw new HttpError(422, 'invalid_state', 'backupToken must never be sent to the PC state endpoint');
  const safeSettings = settings === null ? null : { ...settings, backupEnabled: false, backupUrl: '', backupToken: '' };
  return canonicalize({ schemaVersion: 1, tracks, weeklyProgress, settings: safeSettings });
}

async function readAppState(config) {
  try {
    return normalizeAppState(await readJson(config.stateFilePath));
  } catch (error) {
    if (error?.code === 'ENOENT') return { schemaVersion: 1, tracks: [], weeklyProgress: [], settings: null };
    if (error instanceof HttpError) throw error;
    throw new Error('the stored app state is unreadable');
  }
}

async function storeAppState(config, input) {
  const state = normalizeAppState(input);
  const existing = await readAppState(config).catch(() => null);
  if (existing && stableJson(existing) === stableJson(state)) return { status: 'duplicate' };
  await atomicWrite(config.stateFilePath, JSON.stringify(state));
  return { status: 'stored' };
}

async function listStoredPayloads(config) {
  const entries = (await fs.readdir(config.runsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && UUID_RE.test(entry.name.slice(0, -5)) && entry.name.endsWith('.json'))
    .sort((a, b) => a.name.localeCompare(b.name));
  const payloads = [];
  for (const entry of entries) payloads.push(await readStoredPayload(path.join(config.runsDir, entry.name)));
  return payloads;
}

function localDateKey(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) throw new Error('invalid local date');
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function readManifest(config) {
  try {
    const manifest = await readJson(config.backupManifestPath);
    if (!isPlainObject(manifest) || !isPlainObject(manifest.dates)) throw new Error('invalid manifest');
    return manifest;
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: 1, dates: {} };
    throw new Error('backup manifest is unreadable');
  }
}

async function writeManifest(config, manifest) {
  await atomicWrite(config.backupManifestPath, JSON.stringify(manifest));
}

export async function encryptBackupPayload(backupPayload, encryptionKey, date, createdAt = new Date()) {
  const key = decodeEncryptionKey(encryptionKey);
  const plaintext = Buffer.from(JSON.stringify(backupPayload), 'utf8');
  const compressed = await gzipAsync(plaintext);
  const iv = randomBytes(12);
  const aad = Buffer.from(`${BACKUP_AAD_PREFIX}${date}`, 'utf8');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return {
    format: 'pc-backup-encrypted-v1',
    date,
    createdAt: createdAt.toISOString(),
    compression: 'gzip',
    encryption: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

export async function decryptBackupEnvelope(envelope, encryptionKey) {
  if (!isPlainObject(envelope) || envelope.format !== 'pc-backup-encrypted-v1' || envelope.encryption !== 'aes-256-gcm') {
    throw new Error('invalid encrypted backup envelope');
  }
  const key = decodeEncryptionKey(encryptionKey);
  const iv = Buffer.from(envelope.iv, 'base64');
  const authTag = Buffer.from(envelope.authTag, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(`${BACKUP_AAD_PREFIX}${envelope.date}`, 'utf8'));
  decipher.setAuthTag(authTag);
  const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse((await gunzipAsync(compressed)).toString('utf8'));
}

function telegramIsConfigured(config) {
  return Boolean(config.telegramBotToken && config.telegramChatId && config.encryptionKey);
}

function telegramDisabledReason(config) {
  if (config.encryptionKeyError) return 'backup encryption key is invalid';
  if (!config.encryptionKey) return 'backup encryption key is not configured';
  if (!config.telegramBotToken || !config.telegramChatId) return 'Telegram credentials are not configured';
  return null;
}

export async function sendTelegramDocument(filePath, config) {
  if (!config.telegramBotToken || !config.telegramChatId) throw new Error('Telegram credentials are not configured');
  if (!config.encryptionKey) throw new Error('backup encryption is not configured');
  const bytes = await fs.readFile(filePath);
  const form = new FormData();
  form.append('chat_id', config.telegramChatId);
  form.append('document', new Blob([bytes], { type: 'application/octet-stream' }), path.basename(filePath));
  const response = await config.fetchImpl(`https://api.telegram.org/bot${config.telegramBotToken}/sendDocument`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(config.telegramTimeoutMs)
  });
  let result = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }
  if (!response.ok || !result?.ok) throw new Error(`Telegram upload failed with HTTP ${response.status}`);
  return result;
}

function authDigest(token) {
  return createHash('sha256').update(token, 'utf8').digest();
}

function authorizationIsValid(request, expectedToken) {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return false;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return false;
  const received = authDigest(match[1]);
  const expected = authDigest(expectedToken);
  return timingSafeEqual(received, expected);
}

async function readRequestBody(request, limit) {
  const declaredLength = request.headers['content-length'];
  if (declaredLength !== undefined) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new HttpError(400, 'invalid_content_length', 'invalid Content-Length');
    if (parsed > limit) throw new HttpError(413, 'body_too_large', 'request body exceeds the configured limit');
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) throw new HttpError(413, 'body_too_large', 'request body exceeds the configured limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...headers
  });
  response.end(body);
}

function sendEmpty(response, status, headers = {}) {
  response.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  response.end();
}

function parseJsonBody(text) {
  if (!text.trim()) throw new HttpError(400, 'empty_body', 'request body must not be empty');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json', 'request body must be valid JSON');
  }
}

function corsHeaders(config, request) {
  const origin = request.headers.origin;
  if (origin === undefined) return {};
  if (!config.allowedOrigin || origin !== config.allowedOrigin) {
    throw new HttpError(403, 'cors_not_allowed', 'Origin is not allowed');
  }
  return {
    'Access-Control-Allow-Origin': config.allowedOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin'
  };
}

function assertServerConfig(config) {
  if (typeof config.authToken !== 'string' || Buffer.byteLength(config.authToken, 'utf8') < 32) {
    throw new Error('AUTH_TOKEN must be a random value of at least 32 bytes/chars; refusing to start without authentication');
  }
  if (config.allowedOrigin === '*') throw new Error('ALLOWED_ORIGIN must be one exact origin, not *');
  if (!Number.isSafeInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error('PORT must be between 0 and 65535');
}

function publicBackupSummary(result) {
  return {
    ok: result.ok,
    date: result.date,
    localBackup: result.localBackup,
    telegram: result.telegram,
    skipped: result.skipped ?? false
  };
}

function millisecondsUntilNextLocalBackup(now) {
  const next = new Date(now.getTime());
  next.setHours(24, 5, 0, 0);
  return Math.max(1_000, next.getTime() - now.getTime());
}

export function createService(options = {}) {
  loadDotEnv();
  const config = makeConfig(options);
  let started = false;
  let listening = false;
  let backupTimer = null;

  function scheduleDailyBackup() {
    if (!listening) return;
    if (backupTimer) clearTimeout(backupTimer);
    backupTimer = setTimeout(async () => {
      try {
        await service.backupNow({ force: true });
      } catch {
        // The next timer and the next startup both provide another catch-up attempt.
      } finally {
        scheduleDailyBackup();
      }
    }, millisecondsUntilNextLocalBackup(config.now()));
    backupTimer.unref?.();
  }

  const service = {
    config,
    server: null,
    async exportData() {
      const runs = await listStoredPayloads(config);
      const state = await readAppState(config);
      return { ...state, runs, count: runs.length, exportedAt: config.now().toISOString() };
    },
    async exportAppState() {
      return readAppState(config);
    },
    async saveAppState(input) {
      return storeAppState(config, input);
    },
    async backupNow({ force = true } = {}) {
      await ensureDirectories(config);
      const date = localDateKey(config.now());
      const manifest = await readManifest(config);
      const previous = manifest.dates[date];
      if (!force && previous?.telegramSentAt) return { ok: true, skipped: true, date, localBackup: previous.localBackup ?? null, telegram: 'already-sent' };
      if (!config.encryptionKey) {
        const result = { ok: false, date, localBackup: null, telegram: 'disabled', reason: telegramDisabledReason(config) };
        manifest.dates[date] = { ...(previous ?? {}), attemptedAt: config.now().toISOString(), telegramSentAt: null, disabledReason: result.reason };
        await writeManifest(config, manifest);
        return result;
      }
      const payload = {
        format: 'pc-backup-plaintext-v1',
        date,
        createdAt: config.now().toISOString(),
        state: await readAppState(config),
        runs: (await listStoredPayloads(config)).map(canonicalize)
      };
      const envelope = await encryptBackupPayload(payload, config.encryptionKey, date, config.now());
      const filePath = path.join(config.backupDir, `runs-${date}.json.gz.enc`);
      await atomicWrite(filePath, JSON.stringify(envelope));
      const localBackup = path.basename(filePath);
      const entry = {
        ...(previous ?? {}),
        localBackup,
        localCreatedAt: envelope.createdAt,
        telegramSentAt: null,
        disabledReason: undefined,
        telegramError: undefined
      };
      if (!telegramIsConfigured(config)) {
        entry.disabledReason = telegramDisabledReason(config);
        manifest.dates[date] = entry;
        await writeManifest(config, manifest);
        return { ok: true, date, localBackup, telegram: 'disabled', reason: entry.disabledReason };
      }
      try {
        await config.telegramSender(filePath, config);
        entry.telegramSentAt = config.now().toISOString();
        manifest.dates[date] = entry;
        await writeManifest(config, manifest);
        return { ok: true, date, localBackup, telegram: 'sent' };
      } catch {
        entry.telegramError = 'Telegram upload failed; the encrypted local backup was retained';
        manifest.dates[date] = entry;
        await writeManifest(config, manifest);
        return { ok: false, date, localBackup, telegram: 'failed', reason: entry.telegramError };
      }
    },
    async catchUpBackup() {
      const date = localDateKey(config.now());
      const manifest = await readManifest(config);
      if (manifest.dates[date]?.telegramSentAt) {
        return { ok: true, skipped: true, date, localBackup: manifest.dates[date].localBackup ?? null, telegram: 'already-sent' };
      }
      return service.backupNow({ force: false });
    },
    async start() {
      if (started) return service.server?.address();
      assertServerConfig(config);
      await ensureDirectories(config);
      try {
        await service.catchUpBackup();
      } catch {
        // Local sync remains available even when a catch-up backup cannot be made.
      }
      service.server = http.createServer(async (request, response) => {
        let headers = {};
        try {
          headers = corsHeaders(config, request);
          const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
          if (request.method === 'OPTIONS') {
            sendEmpty(response, 204, headers);
            return;
          }
          if (request.method === 'GET' && url.pathname === '/health') {
            const manifest = await readManifest(config).catch(() => ({ dates: {} }));
            const date = localDateKey(config.now());
            sendJson(response, 200, {
              ok: true,
              service: 'pc-backup',
              date,
              telegram: config.encryptionKey && config.telegramBotToken && config.telegramChatId ? 'enabled' : 'disabled',
              telegramDisabledReason: telegramDisabledReason(config),
              backupEncryptionConfigured: Boolean(config.encryptionKey),
              currentDateBackup: manifest.dates?.[date]?.telegramSentAt ? 'sent' : 'not-sent'
            }, headers);
            return;
          }
          if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'not_found', 'route not found');
          if (!authorizationIsValid(request, config.authToken)) throw new HttpError(401, 'unauthorized', 'Bearer authentication required');

          const isRunPost = request.method === 'POST' && (url.pathname === '/api/runs' || url.pathname === '/api/v1/runs');
          if (isRunPost) {
            if (!(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
              throw new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json');
            }
            const result = await storeRun(config, parseJsonBody(await readRequestBody(request, config.maxBodyBytes)));
            sendJson(response, result.status === 'stored' ? 201 : 200, { ok: true, ...result }, headers);
            return;
          }

          const isStateGet = request.method === 'GET' && (url.pathname === '/api/state' || url.pathname === '/api/v1/state');
          if (isStateGet) {
            sendJson(response, 200, await service.exportAppState(), headers);
            return;
          }

          const isStatePost = request.method === 'POST' && (url.pathname === '/api/state' || url.pathname === '/api/v1/state');
          if (isStatePost) {
            if (!(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
              throw new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json');
            }
            const result = await service.saveAppState(parseJsonBody(await readRequestBody(request, config.maxBodyBytes)));
            sendJson(response, 200, { ok: true, ...result }, headers);
            return;
          }

          const isExport = request.method === 'GET' && (url.pathname === '/api/export' || url.pathname === '/api/v1/export');
          const isSyncGet = request.method === 'GET' && (url.pathname === '/api/sync' || url.pathname === '/api/v1/sync');
          if (isExport || isSyncGet) {
            const result = await service.exportData();
            sendJson(response, 200, result, headers);
            return;
          }

          const isBatch = request.method === 'POST' && [
            '/api/sync', '/api/v1/sync', '/api/import', '/api/v1/import', '/api/restore', '/api/v1/restore'
          ].includes(url.pathname);
          if (isBatch) {
            if (!(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
              throw new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json');
            }
            const body = parseJsonBody(await readRequestBody(request, config.maxBodyBytes));
            if (!isPlainObject(body) || !Array.isArray(body.runs)) throw new HttpError(422, 'invalid_payload', 'body.runs must be an array');
            if (body.runs.length > config.maxBatchRuns) throw new HttpError(422, 'invalid_payload', `at most ${config.maxBatchRuns} runs may be imported at once`);
            const normalized = body.runs.map(normalizeIndexedDbPayload);
            const results = [];
            for (const payload of normalized) results.push(await storeNormalizedRun(config, payload));
            sendJson(response, 200, { ok: true, count: results.length, results }, headers);
            return;
          }

          if (request.method === 'POST' && (url.pathname === '/api/backup' || url.pathname === '/api/v1/backup')) {
            const result = await service.backupNow({ force: true });
            sendJson(response, result.ok ? 200 : 502, publicBackupSummary(result), headers);
            return;
          }
          throw new HttpError(404, 'not_found', 'route not found');
        } catch (error) {
          const status = error instanceof HttpError ? error.status : 500;
          const code = error instanceof HttpError ? error.code : 'internal_error';
          const message = error instanceof HttpError ? error.message : 'internal server error';
          sendJson(response, status, { ok: false, error: code, message }, headers);
        }
      });
      service.server.headersTimeout = 10_000;
      service.server.requestTimeout = 30_000;
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          service.server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          service.server.off('error', onError);
          resolve();
        };
        service.server.once('error', onError);
        service.server.once('listening', onListening);
        service.server.listen(config.port, config.host);
      });
      started = true;
      listening = true;
      scheduleDailyBackup();
      return service.server.address();
    },
    async close() {
      if (!service.server || !listening) return;
      if (backupTimer) clearTimeout(backupTimer);
      backupTimer = null;
      await new Promise((resolve) => service.server.close(() => resolve()));
      listening = false;
      started = false;
    }
  };
  return service;
}

async function main() {
  loadDotEnv();
  const service = createService();
  if (process.argv.includes('--backup-now')) {
    const result = await service.backupNow({ force: true });
    console.log(JSON.stringify(publicBackupSummary(result)));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const address = await service.start();
  const displayAddress = typeof address === 'object' && address ? `${address.address}:${address.port}` : String(address);
  console.log(`PC backup listening on ${displayAddress}; Telegram ${service.config.encryptionKey && service.config.telegramBotToken && service.config.telegramChatId ? 'enabled' : 'disabled'}.`);
  const shutdown = async () => {
    await service.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'unable to start PC backup service');
    process.exitCode = 1;
  });
}
