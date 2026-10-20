import type { RoutePoint, Track } from '../types/models';
import { db } from '../db/database';

const EARTH_RADIUS_M = 6_371_000;
const ENDPOINT_TOLERANCE_M = 180;
const SHAPE_TOLERANCE_M = 110;

export function distanceBetween(a: Pick<RoutePoint, 'latitude' | 'longitude'>, b: Pick<RoutePoint, 'latitude' | 'longitude'>): number {
  const toRad = (degrees: number) => degrees * Math.PI / 180;
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function calculateRouteDistance(points: RoutePoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous && current && current.accuracyM <= 50 && previous.accuracyM <= 50) {
      const gap = current.timestamp - previous.timestamp;
      if (gap <= 20_000) total += distanceBetween(previous, current);
    }
  }
  return total;
}

function resampleRoute(points: RoutePoint[], sampleCount = 24): Array<Pick<RoutePoint, 'latitude' | 'longitude'>> {
  if (points.length < 2) return [];
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1]! + distanceBetween(points[index - 1]!, points[index]!));
  }
  const total = cumulative[cumulative.length - 1] ?? 0;
  if (total <= 0) return [];
  const output: Array<Pick<RoutePoint, 'latitude' | 'longitude'>> = [];
  let segment = 1;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const target = total * sample / (sampleCount - 1);
    while (segment < cumulative.length - 1 && cumulative[segment]! < target) segment += 1;
    const startDistance = cumulative[segment - 1] ?? 0;
    const endDistance = cumulative[segment] ?? total;
    const ratio = endDistance === startDistance ? 0 : (target - startDistance) / (endDistance - startDistance);
    const a = points[segment - 1]!;
    const b = points[segment]!;
    output.push({
      latitude: a.latitude + (b.latitude - a.latitude) * ratio,
      longitude: a.longitude + (b.longitude - a.longitude) * ratio
    });
  }
  return output;
}

function directedShapeError(run: RoutePoint[], reference: RoutePoint[]): number {
  const runSamples = resampleRoute(run);
  const referenceSamples = resampleRoute(reference);
  if (runSamples.length !== referenceSamples.length || runSamples.length < 2) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let index = 0; index < runSamples.length; index += 1) {
    // Compare matching positions in order: a reversed circuit should not pass as this track.
    sum += distanceBetween(runSamples[index]!, referenceSamples[index]!);
  }
  return sum / runSamples.length;
}

export interface TrackMatch {
  track: Track;
  shapeErrorM: number;
  distanceDifferenceRatio: number;
}

export async function findTrackCandidates(points: RoutePoint[], tracks?: Track[]): Promise<TrackMatch[]> {
  if (points.length < 2) return [];
  const trackList = tracks ?? await db.tracks.toArray();
  const runDistance = calculateRouteDistance(points);
  if (runDistance < 100) return [];
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) return [];

  const matches: TrackMatch[] = [];
  for (const track of trackList) {
    const distanceDifferenceRatio = Math.abs(runDistance - track.distanceM) / Math.max(track.distanceM, 1);
    if (distanceDifferenceRatio > 0.1) continue;
    const reference = await db.routePoints.where('runId').equals(track.representativeRunId).sortBy('sequence');
    const referenceStart = reference[0];
    const referenceEnd = reference[reference.length - 1];
    if (!referenceStart || !referenceEnd) continue;
    // Endpoints in the same order plus ordered route-shape similarity preserve direction.
    if (distanceBetween(start, referenceStart) > ENDPOINT_TOLERANCE_M || distanceBetween(end, referenceEnd) > ENDPOINT_TOLERANCE_M) continue;
    const shapeErrorM = directedShapeError(points, reference);
    if (shapeErrorM <= SHAPE_TOLERANCE_M) matches.push({ track, shapeErrorM, distanceDifferenceRatio });
  }
  return matches.sort((a, b) => a.shapeErrorM - b.shapeErrorM);
}
