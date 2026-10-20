import { db } from '../db/database';
import type { Run, StarEvent, StarReason, WeeklyProgress } from '../types/models';
import { getMonthKey, getWeekKey } from './format';

export interface WeeklyFlexPrompt {
  weekKey: string;
  targetRuns: number;
  completedRuns: number;
}

export function starEventId(reason: StarReason, runId: string, weekKey: string, trackId?: string): string {
  if (reason === 'weekly_goal' || reason === 'weekly_extra_run') return `${reason}:${weekKey}`;
  if (reason === 'new_track' && trackId) return `${reason}:${trackId}`;
  return `${reason}:${runId}`;
}

export async function grantStar(reason: StarReason, run: Run, amount: number, trackId?: string): Promise<boolean> {
  const weekKey = getWeekKey(new Date(run.endedAt ?? Date.now()));
  const id = starEventId(reason, run.id, weekKey, trackId);
  const exists = await db.starEvents.get(id);
  if (exists) return false;
  const event: StarEvent = { id, runId: run.id, trackId, reason, amount, createdAt: Date.now(), weekKey };
  await db.starEvents.put(event);
  return true;
}

export async function awardWeeklyExtras(run: Run, completedCount: number, target: number): Promise<number> {
  let awarded = 0;
  if (completedCount === target && await grantStar('weekly_goal', run, 1)) awarded += 1;
  if (completedCount === target + 1 && await grantStar('weekly_extra_run', run, 3)) awarded += 3;
  return awarded;
}

export async function countStars(): Promise<number> {
  const events = await db.starEvents.toArray();
  return events.reduce((total, event) => total + event.amount, 0);
}

export async function countWeeklyRuns(weekKey = getWeekKey()): Promise<number> {
  const weekStart = new Date(`${weekKey}T00:00:00`);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  return db.runs.where('status').equals('completed').filter((run) => {
    const finished = run.endedAt ?? 0;
    return finished >= weekStart.getTime() && finished < weekEnd.getTime();
  }).count();
}

export async function initializeCurrentWeek(targetRuns: number): Promise<void> {
  const weekKey = getWeekKey();
  if (await db.weeklyProgress.get(weekKey)) return;
  const completedRuns = await countWeeklyRuns(weekKey);
  const row: WeeklyProgress = {
    weekKey,
    targetRuns,
    completedRuns,
    status: completedRuns >= targetRuns ? 'goal_met' : 'in_progress',
    flexUsed: false,
    updatedAt: Date.now()
  };
  await db.weeklyProgress.put(row);
}

export async function getPreviousWeekFlexPrompt(): Promise<WeeklyFlexPrompt | null> {
  const weekStart = new Date(`${getWeekKey()}T00:00:00`);
  weekStart.setDate(weekStart.getDate() - 7);
  const weekKey = getWeekKey(weekStart);
  const existing = await db.weeklyProgress.get(weekKey);
  // A missing row means the app had no recorded activity in this week; do not prompt a new user.
  if (!existing || existing.status === 'goal_met' || existing.status === 'protected_by_flex') return null;

  const completedRuns = await countWeeklyRuns(weekKey);
  if (completedRuns >= existing.targetRuns) {
    await db.weeklyProgress.put({ ...existing, completedRuns, status: 'goal_met', updatedAt: Date.now() });
    return null;
  }
  const missed: WeeklyProgress = existing.status === 'missed' && existing.completedRuns === completedRuns
    ? existing
    : { ...existing, completedRuns, status: 'missed', updatedAt: Date.now() };
  if (missed !== existing) await db.weeklyProgress.put(missed);
  if (missed.flexDeclined || missed.flexUsed) return null;

  const monthKey = getMonthKey();
  const usedThisMonth = await db.weeklyProgress.where('flexUsedMonth').equals(monthKey).first();
  if (usedThisMonth) return null;
  return { weekKey, targetRuns: missed.targetRuns, completedRuns };
}

export async function useFlexForMissedWeek(missedWeekKey: string): Promise<boolean> {
  const monthKey = getMonthKey();
  const usedThisMonth = await db.weeklyProgress.where('flexUsedMonth').equals(monthKey).first();
  const week = await db.weeklyProgress.get(missedWeekKey);
  if (!week || week.status !== 'missed' || week.flexUsed || usedThisMonth) return false;
  await db.weeklyProgress.put({ ...week, status: 'protected_by_flex', flexUsed: true, flexUsedMonth: monthKey, updatedAt: Date.now() });
  return true;
}

export async function declineFlexForMissedWeek(missedWeekKey: string): Promise<void> {
  const week = await db.weeklyProgress.get(missedWeekKey);
  if (!week || week.status !== 'missed' || week.flexUsed) return;
  await db.weeklyProgress.put({ ...week, flexDeclined: true, updatedAt: Date.now() });
}

export async function getCurrentStreak(): Promise<number> {
  const progress = await db.weeklyProgress.toArray();
  const completedWeeks = new Set(progress.filter((week) => week.status === 'goal_met' || week.status === 'protected_by_flex').map((week) => week.weekKey));
  let cursor = new Date(`${getWeekKey()}T00:00:00`);
  cursor.setDate(cursor.getDate() - 7);
  let streak = 0;
  for (let index = 0; index < 260; index += 1) {
    const key = getWeekKey(cursor);
    if (!completedWeeks.has(key)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 7);
  }
  const current = await db.weeklyProgress.get(getWeekKey());
  if (current?.status === 'goal_met' || current?.status === 'protected_by_flex') return streak + 1;
  return streak;
}
