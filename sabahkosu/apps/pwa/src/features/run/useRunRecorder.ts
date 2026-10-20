import { useEffect, useMemo, useState } from 'react';
import { db } from '../../db/database';
import type { RoutePoint, Run } from '../../types/models';
import { calculateRouteDistance, distanceBetween } from '../../services/route-matching';

export function useRunRecorder(run: Run, onRunUpdate: (run: Run) => void) {
  const [points, setPoints] = useState<RoutePoint[]>([]);
  const [gpsMessage, setGpsMessage] = useState('GPS hazırlanıyor…');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    db.routePoints.where('runId').equals(run.id).sortBy('sequence').then((existing) => {
      if (!cancelled) {
        setPoints(existing);
        setGpsMessage(existing.length ? 'GPS kaydı sürüyor' : 'GPS noktası bekleniyor');
      }
    });
    return () => { cancelled = true; };
  }, [run.id]);

  useEffect(() => {
    if (run.status !== 'recording') return;
    if (!('geolocation' in navigator)) {
      setGpsMessage('Bu tarayıcı konum erişimini desteklemiyor.');
      return;
    }
    if (!window.isSecureContext) {
      setGpsMessage('GPS için güvenli HTTPS bağlantısı gerekli.');
      return;
    }

    let active = true;
    let nextSequence = points.length;
    let lastAccepted = points[points.length - 1];
    const watchId = navigator.geolocation.watchPosition(async (position) => {
      if (!active) return;
      const accuracyM = position.coords.accuracy;
      if (accuracyM > 70) {
        setGpsMessage(`GPS sinyali zayıf (${Math.round(accuracyM)} m hassasiyet).`);
        return;
      }
      const point: RoutePoint = {
        runId: run.id,
        sequence: nextSequence,
        timestamp: position.timestamp || Date.now(),
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyM,
        altitudeM: position.coords.altitude ?? undefined,
        speedMps: position.coords.speed ?? undefined
      };
      if (lastAccepted && point.timestamp - lastAccepted.timestamp < 1_500 && distanceBetween(point, lastAccepted) < 3) return;
      nextSequence += 1;
      lastAccepted = point;
      const updatedPoints = [...pointsRef.current, point];
      pointsRef.current = updatedPoints;
      setPoints(updatedPoints);
      setGpsMessage('GPS kaydı sürüyor');
      const distanceM = calculateRouteDistance(updatedPoints);
      const updatedRun = { ...run, distanceM, updatedAt: Date.now() };
      onRunUpdate(updatedRun);
      await db.transaction('rw', db.routePoints, db.runs, async () => {
        await db.routePoints.put(point);
        await db.runs.update(run.id, { distanceM, updatedAt: Date.now() });
      });
    }, (error) => {
      const messages: Record<number, string> = {
        1: 'Konum izni kapalı. iPhone ayarlarından konum izni ver.',
        2: 'Konum şu an bulunamıyor; açık alana çıkınca tekrar dene.',
        3: 'GPS yanıtı gecikti; aramaya devam ediyor.'
      };
      setGpsMessage(messages[error.code] ?? 'GPS sinyali alınamadı.');
    }, { enableHighAccuracy: true, maximumAge: 1_000, timeout: 15_000 });

    return () => {
      active = false;
      navigator.geolocation.clearWatch(watchId);
    };
  // points are loaded once per run; updates use pointsRef to avoid restarting the watcher.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id, run.status]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (run.status !== 'recording') return;
    const persist = window.setInterval(() => {
      if (!run.lastResumedAt) return;
      const elapsed = Math.max(0, Math.floor((Date.now() - run.lastResumedAt) / 1000));
      const activeDurationSec = run.activeDurationSec + elapsed;
      void db.runs.update(run.id, { activeDurationSec, updatedAt: Date.now() });
    }, 5_000);
    return () => window.clearInterval(persist);
  }, [run.id, run.status, run.lastResumedAt, run.activeDurationSec]);

  const pointsRef = useMemo(() => ({ current: points }), [run.id]);
  pointsRef.current = points;
  const elapsedSeconds = run.activeDurationSec + (run.status === 'recording' && run.lastResumedAt ? Math.floor((now - run.lastResumedAt) / 1000) : 0);

  return { points, gpsMessage, elapsedSeconds };
}
