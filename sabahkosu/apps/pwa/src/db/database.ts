import Dexie, { type Table } from 'dexie';
import type { AppSettings, RoutePoint, Run, StarEvent, SyncOutboxItem, Track, WeeklyProgress } from '../types/models';

export class RunningDatabase extends Dexie {
  runs!: Table<Run, string>;
  routePoints!: Table<RoutePoint, [string, number]>;
  tracks!: Table<Track, string>;
  starEvents!: Table<StarEvent, string>;
  weeklyProgress!: Table<WeeklyProgress, string>;
  settings!: Table<AppSettings, string>;
  syncOutbox!: Table<SyncOutboxItem, string>;

  constructor() {
    super('sabah-kosusu-v1');
    this.version(1).stores({
      runs: 'id, status, startedAt, trackId, [status+startedAt]',
      routePoints: '[runId+sequence], runId, timestamp',
      tracks: 'id, name, directionKey, createdAt',
      starEvents: 'id, runId, trackId, reason, weekKey, createdAt',
      weeklyProgress: 'weekKey, status, flexUsedMonth',
      settings: 'key',
      syncOutbox: 'id, runId, status, createdAt'
    });
  }
}

export const db = new RunningDatabase();

export const DEFAULT_SETTINGS: AppSettings = {
  key: 'profile',
  displayName: 'Koşucu',
  weekTargetRuns: 3,
  distanceUnit: 'km',
  defaultMapOn: true,
  pocketModeDefault: false,
  voiceAnnouncements: true,
  reminderEnabled: false,
  reminderTime: '06:30',
  reminderDays: [1, 2, 3, 4, 5],
  backupEnabled: false,
  backupUrl: '',
  backupToken: ''
};

export async function getSettings(): Promise<AppSettings> {
  const saved = await db.settings.get('profile');
  if (saved) return { ...DEFAULT_SETTINGS, ...saved };
  await db.settings.put(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await db.settings.put(settings);
}
