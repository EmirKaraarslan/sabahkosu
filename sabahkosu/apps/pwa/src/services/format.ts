import type { DistanceUnit } from '../types/models';

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function formatDistance(distanceM: number, unit: DistanceUnit = 'km'): string {
  const value = unit === 'mi' ? distanceM / 1609.344 : distanceM / 1000;
  return `${value.toFixed(value < 10 ? 2 : 1).replace('.', ',')} ${unit}`;
}

export function formatPace(secondsPerKm: number | null, unit: DistanceUnit = 'km'): string {
  if (!secondsPerKm || !Number.isFinite(secondsPerKm)) return '—:—';
  const perUnit = unit === 'mi' ? secondsPerKm * 1.609344 : secondsPerKm;
  const minutes = Math.floor(perUnit / 60);
  const seconds = Math.round(perUnit % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')} /${unit}`;
}

export function getWeekKey(date = new Date()): string {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = local.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  local.setDate(local.getDate() + delta);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
}

export function getMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function formatDate(timestamp: number, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('tr-TR', options ?? { day: 'numeric', month: 'long', year: 'numeric' }).format(timestamp);
}
