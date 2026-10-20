import { db, getSettings, saveSettings } from '../db/database';
import type { AppSettings, RoutePoint, Run, StarEvent, Track, WeeklyProgress } from '../types/models';

export interface BackupPayload {
  schemaVersion: 1;
  run: Run;
  routePoints: RoutePoint[];
  starEvents: StarEvent[];
}

export interface BackupStatePayload {
  schemaVersion: 1;
  tracks: Track[];
  weeklyProgress: WeeklyProgress[];
  settings: Omit<AppSettings, 'backupToken'> & { backupToken: '' };
}

export interface PcExportPayload {
  runs: BackupPayload[];
  tracks?: Track[];
  weeklyProgress?: WeeklyProgress[];
  settings?: Partial<AppSettings> | null;
  count?: number;
  exportedAt?: string;
}

function getBackupUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('PC yedek adresi güvenli HTTPS olmalı.');
  }
  return url.toString().replace(/\/$/, '');
}

export async function queueRunBackup(runId: string): Promise<void> {
  const existing = await db.syncOutbox.get(runId);
  if (!existing) {
    await db.syncOutbox.put({ id: runId, runId, payloadVersion: 1, status: 'pending', createdAt: Date.now(), attempts: 0 });
  }
}

export async function buildBackupPayload(runId: string): Promise<BackupPayload | null> {
  const run = await db.runs.get(runId);
  if (!run || run.status !== 'completed') return null;
  const [routePoints, starEvents] = await Promise.all([
    db.routePoints.where('runId').equals(runId).sortBy('sequence'),
    db.starEvents.where('runId').equals(runId).toArray()
  ]);
  return { schemaVersion: 1, run, routePoints, starEvents };
}

export async function buildBackupState(): Promise<BackupStatePayload> {
  const [tracks, weeklyProgress, settings] = await Promise.all([
    db.tracks.toArray(), db.weeklyProgress.toArray(), getSettings()
  ]);
  return {
    schemaVersion: 1,
    tracks,
    weeklyProgress,
    settings: { ...settings, backupEnabled: false, backupUrl: '', backupToken: '' }
  };
}

export async function syncPendingRuns(): Promise<{ sent: number; pending: number; message?: string }> {
  const settings = await getSettings();
  if (!settings.backupEnabled || !settings.backupUrl.trim() || !settings.backupToken.trim()) {
    return { sent: 0, pending: await db.syncOutbox.where('status').anyOf('pending', 'failed').count(), message: 'PC yedeği henüz yapılandırılmadı.' };
  }
  if (!navigator.onLine) return { sent: 0, pending: await db.syncOutbox.where('status').anyOf('pending', 'failed').count(), message: 'İnternet bağlantısı yok; kayıtlar telefonda bekliyor.' };

  let baseUrl: string;
  try {
    baseUrl = getBackupUrl(settings.backupUrl);
  } catch (error) {
    return { sent: 0, pending: await db.syncOutbox.where('status').anyOf('pending', 'failed').count(), message: error instanceof Error ? error.message : 'PC adresi geçersiz.' };
  }

  let sent = 0;
  const queue = await db.syncOutbox.where('status').anyOf('pending', 'failed').sortBy('createdAt');
  for (const item of queue) {
    const payload = await buildBackupPayload(item.runId);
    if (!payload) {
      await db.syncOutbox.delete(item.id);
      continue;
    }
    try {
      const response = await fetch(`${baseUrl}/api/v1/runs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.backupToken}`
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok) throw new Error(response.status === 401 ? 'PC yedek anahtarı reddedildi.' : `PC yedek servisi yanıtı: ${response.status}`);
      await db.syncOutbox.update(item.id, { status: 'sent', attempts: item.attempts + 1, lastError: undefined });
      sent += 1;
    } catch (error) {
      await db.syncOutbox.update(item.id, {
        status: 'failed',
        attempts: item.attempts + 1,
        lastError: error instanceof Error ? error.message : 'Bağlantı kurulamadı.'
      });
      break;
    }
  }

  let stateError = '';
  try {
    const state = await buildBackupState();
    const response = await fetch(`${baseUrl}/api/v1/state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.backupToken}`
      },
      body: JSON.stringify(state),
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) throw new Error(response.status === 401 ? 'PC yedek anahtarı reddedildi.' : `PC durum yedeği yanıtı: ${response.status}`);
  } catch (error) {
    stateError = error instanceof Error ? error.message : 'Pist/seri bilgileri PC’ye gönderilemedi.';
  }

  const pending = await db.syncOutbox.where('status').anyOf('pending', 'failed').count();
  if (sent > 0 || !stateError) await saveSettings({ ...settings, lastBackupAt: Date.now() });
  if (stateError) return { sent, pending, message: `Koşu kuyruğu: ${pending} bekliyor. Uygulama durumu eşitlenemedi: ${stateError}` };
  if (sent > 0) return { sent, pending, message: `${sent} koşu, pistler ve seri bilgileri PC’ye yedeklendi.` };
  if (pending) return { sent, pending, message: 'PC’ye ulaşılamadı; kayıtlar telefonda bekliyor.' };
  return { sent, pending, message: 'Koşular, pistler ve seri bilgileri PC ile eşitlendi.' };
}

export async function downloadPcExport(): Promise<PcExportPayload> {
  const settings = await getSettings();
  if (!settings.backupEnabled || !settings.backupUrl.trim() || !settings.backupToken.trim()) throw new Error('Önce PC yedek bağlantısını ayarlarda yapılandır.');
  const baseUrl = getBackupUrl(settings.backupUrl);
  const response = await fetch(`${baseUrl}/api/v1/export`, { headers: { Authorization: `Bearer ${settings.backupToken}` } });
  if (!response.ok) throw new Error(`PC yedeği alınamadı: ${response.status}`);
  const data = await response.json() as PcExportPayload;
  return { ...data, runs: data.runs ?? [] };
}
