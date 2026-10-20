export type RunStatus = 'recording' | 'paused' | 'completed' | 'interrupted';
export type DistanceUnit = 'km' | 'mi';
export type StarReason = 'run_complete' | 'new_track' | 'track_record' | 'weekly_goal' | 'weekly_extra_run';
export type SyncStatus = 'pending' | 'sent' | 'failed';

export interface SurveyResponse {
  paceFeel: number;
  durationFeel: number;
  fatigue: number;
}

export interface Run {
  id: string;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  lastResumedAt?: number;
  pausedDurationMs: number;
  activeDurationSec: number;
  distanceM: number;
  avgPaceSecPerKm: number | null;
  trackId?: string;
  isRecord?: boolean;
  survey?: SurveyResponse;
  starsEarned: number;
  createdAt: number;
  updatedAt: number;
}

export interface RoutePoint {
  runId: string;
  sequence: number;
  timestamp: number;
  latitude: number;
  longitude: number;
  accuracyM: number;
  altitudeM?: number;
  speedMps?: number;
}

export interface Track {
  id: string;
  name: string;
  createdAt: number;
  representativeRunId: string;
  directionKey: string;
  distanceM: number;
  bestRunId: string;
  bestDurationSec: number;
  bestPaceSecPerKm: number | null;
  runCount: number;
  totalStars: number;
}

export interface StarEvent {
  id: string;
  runId: string;
  trackId?: string;
  reason: StarReason;
  amount: number;
  createdAt: number;
  weekKey: string;
}

export interface WeeklyProgress {
  weekKey: string;
  targetRuns: number;
  completedRuns: number;
  status: 'in_progress' | 'goal_met' | 'missed' | 'protected_by_flex';
  flexUsed: boolean;
  flexUsedMonth?: string;
  flexDeclined?: boolean;
  updatedAt: number;
}

export interface AppSettings {
  key: 'profile';
  displayName: string;
  weekTargetRuns: number;
  distanceUnit: DistanceUnit;
  defaultMapOn: boolean;
  pocketModeDefault: boolean;
  voiceAnnouncements: boolean;
  reminderEnabled: boolean;
  reminderTime: string;
  reminderDays: number[];
  backupEnabled: boolean;
  backupUrl: string;
  backupToken: string;
  lastBackupAt?: number;
}

export interface SyncOutboxItem {
  id: string;
  runId: string;
  payloadVersion: number;
  status: SyncStatus;
  createdAt: number;
  attempts: number;
  lastError?: string;
}
