import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, ChevronRight, Star, X } from 'lucide-react';
import { BottomNav } from '../components/BottomNav';
import { LazyRouteMap } from '../components/LazyRouteMap';
import { db, DEFAULT_SETTINGS, getSettings, saveSettings } from '../db/database';
import { HomeScreen, type TrackCardData } from '../features/home/HomeScreen';
import { TracksScreen } from '../features/tracks/TracksScreen';
import { HistoryScreen, type RunCardData } from '../features/history/HistoryScreen';
import { SettingsScreen, type BackupUiState } from '../features/settings/SettingsScreen';
import { ProfileSheet } from '../features/profile/ProfileSheet';
import { PreRunScreen, LiveRunScreen } from '../features/run/RunScreens';
import { SurveyScreen } from '../features/survey/SurveyScreen';
import { ResultScreen } from '../features/results/ResultScreen';
import { TrackDecision } from '../features/tracks/TrackDecision';
import { awardWeeklyExtras, countStars, countWeeklyRuns, declineFlexForMissedWeek, getCurrentStreak, getPreviousWeekFlexPrompt, grantStar, initializeCurrentWeek, useFlexForMissedWeek, type WeeklyFlexPrompt } from '../services/rewards';
import { calculateRouteDistance, findTrackCandidates, type TrackMatch } from '../services/route-matching';
import { formatDate, formatDistance, formatDuration, formatPace, getWeekKey } from '../services/format';
import { queueRunBackup, syncPendingRuns, downloadPcExport } from '../services/backup-sync';
import type { AppSettings, RoutePoint, Run, StarEvent, SurveyResponse, Track, WeeklyProgress } from '../types/models';
import type { FlowScreen, TabId } from './navigation';

interface TrackDetailData {
  track: Track;
  points: RoutePoint[];
  runs: Run[];
}

export function App() {
  const [tab, setTab] = useState<TabId>('home');
  const [flow, setFlow] = useState<FlowScreen>('idle');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [runs, setRuns] = useState<RunCardData[]>([]);
  const [tracks, setTracks] = useState<TrackCardData[]>([]);
  const [stars, setStars] = useState(0);
  const [weeklyRuns, setWeeklyRuns] = useState(0);
  const [streak, setStreak] = useState(0);
  const [flexPrompt, setFlexPrompt] = useState<WeeklyFlexPrompt | null>(null);
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [mapOn, setMapOn] = useState(true);
  const [pocketMode, setPocketMode] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [trackMatches, setTrackMatches] = useState<TrackMatch[]>([]);
  const [completedTrack, setCompletedTrack] = useState<Track | undefined>();
  const [previousBestSec, setPreviousBestSec] = useState<number | undefined>();
  const [backupUi, setBackupUi] = useState<BackupUiState>({ pending: 0, lastMessage: '', busy: false });
  const [toast, setToast] = useState('');
  const [selectedRun, setSelectedRun] = useState<RunCardData | null>(null);
  const [selectedRunPoints, setSelectedRunPoints] = useState<RoutePoint[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<TrackDetailData | null>(null);

  const refreshData = useCallback(async () => {
    const savedSettings = await getSettings();
    await initializeCurrentWeek(savedSettings.weekTargetRuns);
    setFlexPrompt(await getPreviousWeekFlexPrompt());
    const allRuns = await db.runs.orderBy('startedAt').reverse().toArray();
    const allTracks = await db.tracks.toArray();
    const runWithTrack: RunCardData[] = allRuns.map((run) => ({ run, track: allTracks.find((track) => track.id === run.trackId) }));
    const trackCards: TrackCardData[] = await Promise.all(allTracks
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(async (track) => {
        const points = await db.routePoints.where('runId').equals(track.representativeRunId).sortBy('sequence');
        const trackRuns = allRuns.filter((run) => run.trackId === track.id).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
        return { track, points, lastRunAt: trackRuns[0]?.endedAt };
      }));
    const [starTotal, currentWeekRuns, currentStreak, pending] = await Promise.all([
      countStars(), countWeeklyRuns(), getCurrentStreak(), db.syncOutbox.where('status').anyOf('pending', 'failed').count()
    ]);
    setSettings(savedSettings);
    setMapOn(savedSettings.defaultMapOn);
    setPocketMode(savedSettings.pocketModeDefault);
    setRuns(runWithTrack);
    setTracks(trackCards);
    setStars(starTotal);
    setWeeklyRuns(currentWeekRuns);
    setStreak(currentStreak);
    setBackupUi((current) => ({ ...current, pending }));
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await refreshData();
      const unfinished = await db.runs.where('status').anyOf('recording', 'paused', 'interrupted').toArray();
      const mostRecent = unfinished.sort((a, b) => b.startedAt - a.startedAt)[0];
      if (!alive || !mostRecent) return;
      const interrupted = mostRecent.status === 'recording'
        ? { ...mostRecent, status: 'interrupted' as const, lastResumedAt: undefined, updatedAt: Date.now() }
        : mostRecent;
      if (interrupted !== mostRecent) await db.runs.put(interrupted);
      setActiveRun(interrupted);
      setFlow('paused');
      setToast('Önceki koşu yarım kalmış. Kayıtlı rota korunuyor.');
    })();
    return () => { alive = false; };
  }, [refreshData]);

  useEffect(() => {
    const retry = () => { void syncPendingRuns().then((result) => { setBackupUi((state) => ({ ...state, pending: result.pending, lastMessage: result.message ?? '' })); }); };
    const onOnline = () => retry();
    window.addEventListener('online', onOnline);
    retry();
    return () => window.removeEventListener('online', onOnline);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3_500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const runCardData = useMemo(() => runs, [runs]);

  const handleUseFlex = async () => {
    if (!flexPrompt) return;
    const used = await useFlexForMissedWeek(flexPrompt.weekKey);
    setToast(used ? 'Esneklik hakkı kullanıldı; seri ateşin korundu. Eksik koşu ve yıldız eklenmedi.' : 'Bu ayın esneklik hakkı kullanılmış; seri korunamadı.');
    await refreshData();
  };

  const handleDeclineFlex = async () => {
    if (!flexPrompt) return;
    await declineFlexForMissedWeek(flexPrompt.weekKey);
    setToast('Esneklik hakkı kullanılmadı; bu haftanın serisi tamamlanmadı.');
    await refreshData();
  };

  const startRun = async () => {
    const now = Date.now();
    const run: Run = {
      id: crypto.randomUUID(), status: 'recording', startedAt: now, lastResumedAt: now,
      pausedDurationMs: 0, activeDurationSec: 0, distanceM: 0, avgPaceSecPerKm: null,
      starsEarned: 0, createdAt: now, updatedAt: now
    };
    await db.runs.add(run);
    setActiveRun(run);
    setMapOn(settings.defaultMapOn);
    setPocketMode(settings.pocketModeDefault);
    setFlow('running');
    setToast('Koşu başladı. GPS konum izni istenirse izin ver.');
  };

  const updateActiveRun = (updated: Run) => {
    setActiveRun((current) => current ? { ...current, distanceM: updated.distanceM, updatedAt: updated.updatedAt } : updated);
  };

  const pauseRun = async () => {
    if (!activeRun) return;
    const now = Date.now();
    const elapsed = activeRun.lastResumedAt ? Math.max(0, Math.floor((now - activeRun.lastResumedAt) / 1000)) : 0;
    const updated: Run = { ...activeRun, status: 'paused', activeDurationSec: activeRun.activeDurationSec + elapsed, lastResumedAt: undefined, updatedAt: now };
    await db.runs.put(updated);
    setActiveRun(updated);
    setFlow('paused');
  };

  const resumeRun = async () => {
    if (!activeRun) return;
    const updated: Run = { ...activeRun, status: 'recording', lastResumedAt: Date.now(), updatedAt: Date.now() };
    await db.runs.put(updated);
    setActiveRun(updated);
    setFlow('running');
  };

  const finishRun = async () => {
    if (!activeRun) return;
    const now = Date.now();
    const elapsed = activeRun.status === 'recording' && activeRun.lastResumedAt ? Math.max(0, Math.floor((now - activeRun.lastResumedAt) / 1000)) : 0;
    const activeDurationSec = activeRun.activeDurationSec + elapsed;
    const points = await db.routePoints.where('runId').equals(activeRun.id).sortBy('sequence');
    const distanceM = calculateRouteDistance(points);
    const completed: Run = {
      ...activeRun,
      status: 'completed',
      endedAt: now,
      lastResumedAt: undefined,
      activeDurationSec,
      distanceM,
      avgPaceSecPerKm: distanceM > 0 ? activeDurationSec / (distanceM / 1000) : null,
      updatedAt: now
    };
    await db.runs.put(completed);
    setActiveRun(completed);
    setFlow('survey');
  };

  const beginTrackDecision = async (response?: SurveyResponse) => {
    if (!activeRun) return;
    const run = await db.runs.get(activeRun.id);
    if (!run) return;
    const updated = response ? { ...run, survey: response, updatedAt: Date.now() } : run;
    if (response) await db.runs.put(updated);
    setActiveRun(updated);
    const points = await db.routePoints.where('runId').equals(updated.id).sortBy('sequence');
    const candidates = await findTrackCandidates(points);
    setTrackMatches(candidates);
    setFlow('track-confirm');
  };

  const finalizeTrack = async (existingTrack?: Track, newName?: string) => {
    if (!activeRun) return;
    const run = await db.runs.get(activeRun.id);
    if (!run || run.status !== 'completed') return;
    const points = await db.routePoints.where('runId').equals(run.id).sortBy('sequence');
    const canCreateTrack = points.length >= 2 && run.distanceM >= 100;
    let track = existingTrack;
    let isNewTrack = false;
    let wasRecord = false;
    let previousBest: number | undefined;

    if (!track && canCreateTrack) {
      const now = Date.now();
      track = {
        id: crypto.randomUUID(),
        name: newName?.trim() || `Pist ${String((await db.tracks.count()) + 1).padStart(2, '0')}`,
        createdAt: now,
        representativeRunId: run.id,
        directionKey: 'forward',
        distanceM: run.distanceM,
        bestRunId: run.id,
        bestDurationSec: run.activeDurationSec,
        bestPaceSecPerKm: run.avgPaceSecPerKm,
        runCount: 1,
        totalStars: 0
      };
      isNewTrack = true;
    } else if (track) {
      previousBest = track.bestDurationSec;
      wasRecord = run.activeDurationSec < track.bestDurationSec;
      track = {
        ...track,
        runCount: track.runCount + 1,
        distanceM: Math.round((track.distanceM * track.runCount + run.distanceM) / Math.max(track.runCount + 1, 1)),
        bestRunId: wasRecord ? run.id : track.bestRunId,
        bestDurationSec: wasRecord ? run.activeDurationSec : track.bestDurationSec,
        bestPaceSecPerKm: wasRecord ? run.avgPaceSecPerKm : track.bestPaceSecPerKm
      };
    }

    const linkedRun: Run = { ...run, trackId: track?.id, isRecord: wasRecord, starsEarned: 0, updatedAt: Date.now() };
    await db.transaction('rw', [db.runs, db.tracks, db.starEvents, db.weeklyProgress], async () => {
      if (track) await db.tracks.put(track);
      await db.runs.put(linkedRun);
      await grantStar('run_complete', linkedRun, 1, track?.id);
      if (isNewTrack && track) await grantStar('new_track', linkedRun, 1, track.id);
      if (wasRecord && track) await grantStar('track_record', linkedRun, 1, track.id);

      const weekKey = getWeekKey(new Date(linkedRun.endedAt ?? Date.now()));
      const start = new Date(`${weekKey}T00:00:00`);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      const completedCount = await db.runs.where('status').equals('completed').filter((item) => (item.endedAt ?? 0) >= start.getTime() && (item.endedAt ?? 0) < end.getTime()).count();
      const existingWeek = await db.weeklyProgress.get(weekKey);
      const target = existingWeek?.targetRuns ?? settings.weekTargetRuns;
      const status = completedCount >= target ? 'goal_met' : 'in_progress';
      await db.weeklyProgress.put({ weekKey, targetRuns: existingWeek?.targetRuns ?? target, completedRuns: completedCount, status, flexUsed: existingWeek?.flexUsed ?? false, flexUsedMonth: existingWeek?.flexUsedMonth, updatedAt: Date.now() } as WeeklyProgress);
      await awardWeeklyExtras(linkedRun, completedCount, target);
    });

    const events: StarEvent[] = await db.starEvents.where('runId').equals(linkedRun.id).toArray();
    const starsEarned = events.reduce((sum, event) => sum + event.amount, 0);
    const finalRun = { ...linkedRun, starsEarned };
    await db.runs.put(finalRun);
    let updatedTrack: Track | undefined;
    if (track) {
      const trackEvents = await db.starEvents.where('trackId').equals(track.id).toArray();
      updatedTrack = { ...track, totalStars: trackEvents.reduce((sum, event) => sum + event.amount, 0) };
      await db.tracks.put(updatedTrack);
    }
    await queueRunBackup(finalRun.id);
    const syncResult = await syncPendingRuns();
    setBackupUi((state) => ({ ...state, pending: syncResult.pending, lastMessage: syncResult.message ?? '' }));
    setActiveRun(finalRun);
    setCompletedTrack(updatedTrack);
    setPreviousBestSec(wasRecord ? previousBest : undefined);
    await refreshData();
    if (!canCreateTrack && !existingTrack) setToast('GPS rotası yeterli değil; koşu kaydedildi ancak pist rekoru oluşturulmadı.');
    setFlow('result');
  };

  const handleExport = async () => {
    const [savedRuns, points, savedTracks, starEvents, weeks, currentSettings] = await Promise.all([
      db.runs.toArray(), db.routePoints.toArray(), db.tracks.toArray(), db.starEvents.toArray(), db.weeklyProgress.toArray(), getSettings()
    ]);
    const safeSettings = { ...currentSettings, backupEnabled: false, backupUrl: '', backupToken: '' };
    const bundle = { schemaVersion: 1, exportedAt: new Date().toISOString(), runs: savedRuns, routePoints: points, tracks: savedTracks, starEvents, weeklyProgress: weeks, settings: safeSettings };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `sabah-kosusu-yedek-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (file: File) => {
    const parsed = JSON.parse(await file.text()) as { runs?: Run[]; routePoints?: RoutePoint[]; tracks?: Track[]; starEvents?: StarEvent[]; weeklyProgress?: WeeklyProgress[]; settings?: Partial<AppSettings> };
    if (!Array.isArray(parsed.runs) || !Array.isArray(parsed.routePoints)) throw new Error('Yedek dosyası tanınamadı.');
    await db.transaction('rw', [db.runs, db.routePoints, db.tracks, db.starEvents, db.weeklyProgress, db.settings], async () => {
      await db.runs.bulkPut(parsed.runs!);
      await db.routePoints.bulkPut(parsed.routePoints!);
      if (parsed.tracks) await db.tracks.bulkPut(parsed.tracks);
      if (parsed.starEvents) await db.starEvents.bulkPut(parsed.starEvents);
      if (parsed.weeklyProgress) await db.weeklyProgress.bulkPut(parsed.weeklyProgress);
      if (parsed.settings) await db.settings.put({ ...await getSettings(), ...parsed.settings, key: 'profile', backupEnabled: settings.backupEnabled, backupToken: settings.backupToken, backupUrl: settings.backupUrl });
    });
    await refreshData();
    setToast('Yedek bu telefona yüklendi.');
  };

  const handleRestorePc = async () => {
    const backup = await downloadPcExport();
    const currentSettings = await getSettings();
    await db.transaction('rw', [db.runs, db.routePoints, db.starEvents, db.tracks, db.weeklyProgress, db.settings], async () => {
      for (const payload of backup.runs) {
        await db.runs.put(payload.run);
        await db.routePoints.bulkPut(payload.routePoints);
        await db.starEvents.bulkPut(payload.starEvents);
      }
      if (backup.tracks?.length) await db.tracks.bulkPut(backup.tracks);
      if (backup.weeklyProgress?.length) await db.weeklyProgress.bulkPut(backup.weeklyProgress);
      if (backup.settings) await db.settings.put({ ...currentSettings, ...backup.settings, key: 'profile', backupEnabled: currentSettings.backupEnabled, backupUrl: currentSettings.backupUrl, backupToken: currentSettings.backupToken });
    });
    await refreshData();
    setToast(`${backup.runs.length} koşu ve ${backup.tracks?.length ?? 0} pist PC yedeğinden geri yüklendi.`);
  };

  const onSync = async () => {
    setBackupUi((state) => ({ ...state, busy: true }));
    try {
      const result = await syncPendingRuns();
      setBackupUi({ pending: result.pending, lastMessage: result.message ?? '', busy: false });
      if (result.message) setToast(result.message);
      await refreshData();
    } finally {
      setBackupUi((state) => ({ ...state, busy: false }));
    }
  };

  const saveAppSettings = async (next: AppSettings) => {
    await saveSettings(next);
    setSettings(next);
    if (next.backupEnabled && next.backupUrl.trim() && next.backupToken.trim()) {
      const result = await syncPendingRuns();
      setBackupUi((state) => ({ ...state, pending: result.pending, lastMessage: result.message ?? '' }));
    }
    await refreshData();
    setToast('Ayarların kaydedildi.');
  };

  const openTrack = async (track: Track) => {
    const points = await db.routePoints.where('runId').equals(track.representativeRunId).sortBy('sequence');
    const trackRuns = (await db.runs.where('trackId').equals(track.id).toArray()).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
    setSelectedTrack({ track, points, runs: trackRuns });
  };

  const openRun = async (run: Run, track?: Track) => {
    const points = await db.routePoints.where('runId').equals(run.id).sortBy('sequence');
    setSelectedRun({ run, track });
    setSelectedRunPoints(points);
  };

  const closeFlow = () => { setFlow('idle'); setActiveRun(null); setTab('home'); void refreshData(); };

  return (
    <div className="app-shell">
      {flow === 'idle' && <>
        {tab === 'home' && <HomeScreen settings={settings} weeklyRuns={weeklyRuns} streak={streak} stars={stars} tracks={tracks} onStart={() => setFlow('pre-run')} onProfile={() => setProfileOpen(true)} onOpenTracks={() => setTab('tracks')} onOpenTrack={openTrack} />}
        {tab === 'tracks' && <TracksScreen tracks={tracks} settings={settings} onOpenTrack={openTrack} />}
        {tab === 'history' && <HistoryScreen runs={runCardData} settings={settings} onOpenRun={(run) => void openRun(run, runs.find((item) => item.run.id === run.id)?.track)} />}
        {tab === 'settings' && <SettingsScreen settings={settings} backup={backupUi} onSave={saveAppSettings} onSync={onSync} onExport={handleExport} onImport={handleImport} onRestorePc={handleRestorePc} />}
        <BottomNav active={tab} onChange={setTab} />
      </>}
      {flow === 'pre-run' && <PreRunScreen mapOn={mapOn} pocketMode={pocketMode} onMapChange={setMapOn} onPocketChange={setPocketMode} onStart={() => void startRun()} onCancel={() => setFlow('idle')} />}
      {(flow === 'running' || flow === 'paused') && activeRun && <LiveRunScreen run={activeRun} settings={settings} pocketMode={pocketMode} mapOn={mapOn} onRunUpdate={updateActiveRun} onPause={() => void pauseRun()} onResume={() => void resumeRun()} onFinish={() => void finishRun()} onMapChange={setMapOn} onPocketChange={setPocketMode} />}
      {flow === 'survey' && <SurveyScreen onSubmit={(response) => void beginTrackDecision(response)} onSkip={() => void beginTrackDecision()} />}
      {flow === 'track-confirm' && activeRun && <TrackDecision candidates={trackMatches} defaultName={`Pist ${String(tracks.length + 1).padStart(2, '0')}`} distanceM={activeRun.distanceM} onConfirmExisting={(track) => void finalizeTrack(track)} onCreateNew={(name) => void finalizeTrack(undefined, name)} />}
      {flow === 'result' && activeRun && <ResultScreen run={activeRun} track={completedTrack} settings={settings} previousBestSec={previousBestSec} onHome={closeFlow} />}

      {profileOpen && <ProfileSheet settings={settings} onClose={() => setProfileOpen(false)} onSave={saveAppSettings} />}
      {flow === 'idle' && flexPrompt && <div className="sheet-backdrop"><section className="detail-sheet flex-prompt" role="dialog" aria-modal="true" aria-labelledby="flex-title"><span className="step-label">AYLIK ESNEKLİK HAKKI</span><h2 id="flex-title">Geçen haftanın serisini koruyalım mı?</h2><p className="decision-copy">Hedefin {flexPrompt.targetRuns} koşuydu; {flexPrompt.completedRuns} koşu tamamlandı. Bu ayki tek esneklik hakkını kullanırsan seri korunur; eksik koşu tamamlanmış sayılmaz ve hedef yıldızı verilmez.</p><div className="flex-prompt-actions"><button className="secondary-button" onClick={() => void handleDeclineFlex()}>Bu kez kullanma</button><button className="primary-button" onClick={() => void handleUseFlex()}>Seriyi koru</button></div></section></div>}
      {selectedRun && <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedRun(null); }}><section className="detail-sheet" role="dialog" aria-modal="true"><button className="sheet-close" aria-label="Kapat" onClick={() => setSelectedRun(null)}><X size={21} /></button><span className="step-label">KOŞU ÖZETİ</span><h2>{selectedRun.track?.name ?? 'Koşu'}</h2><p className="detail-date">{formatDate(selectedRun.run.endedAt ?? selectedRun.run.startedAt, { weekday: 'long', day: 'numeric', month: 'long' })}</p>{selectedRunPoints.length > 1 && <div className="detail-map"><LazyRouteMap points={selectedRunPoints} /></div>}<div className="detail-stats"><span><strong>{formatDuration(selectedRun.run.activeDurationSec)}</strong>Süre</span><span><strong>{formatDistance(selectedRun.run.distanceM, settings.distanceUnit)}</strong>Mesafe</span><span><strong>{formatPace(selectedRun.run.avgPaceSecPerKm, settings.distanceUnit)}</strong>Tempo</span></div>{selectedRun.run.survey && <div className="survey-summary"><strong>Koşu hissi</strong><span>Tempo {selectedRun.run.survey.paceFeel}/5 · Süre {selectedRun.run.survey.durationFeel}/5 · Yorgunluk {selectedRun.run.survey.fatigue}/5</span></div>}<button className="secondary-button full-button" onClick={() => setSelectedRun(null)}>Kapat</button></section></div>}
      {selectedTrack && <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedTrack(null); }}><section className="detail-sheet" role="dialog" aria-modal="true"><button className="sheet-close" aria-label="Kapat" onClick={() => setSelectedTrack(null)}><X size={21} /></button><span className="step-label">KAYITLI PİST</span><h2>{selectedTrack.track.name}</h2><p className="detail-date">{formatDistance(selectedTrack.track.distanceM, settings.distanceUnit)} · {selectedTrack.track.runCount} koşu</p>{selectedTrack.points.length > 1 && <div className="detail-map"><LazyRouteMap points={selectedTrack.points} /></div>}<div className="track-record-summary"><div><span>EN İYİ SÜRE</span><strong>{formatDuration(selectedTrack.track.bestDurationSec)}</strong></div><div><span>ORT. TEMPO</span><strong>{formatPace(selectedTrack.track.bestPaceSecPerKm, settings.distanceUnit)}</strong></div><div><span>YILDIZ</span><strong><Star size={17} fill="currentColor" /> {selectedTrack.track.totalStars}</strong></div></div><h3 className="detail-subheading">Bu pistteki koşular</h3>{selectedTrack.runs.slice(0, 5).map((run) => <button className="track-run-row" key={run.id} onClick={() => { setSelectedTrack(null); void openRun(run, selectedTrack.track); }}><span>{formatDate(run.endedAt ?? run.startedAt, { day: 'numeric', month: 'short' })}</span><strong>{formatDuration(run.activeDurationSec)}</strong>{run.isRecord && <span className="record-badge"><Award size={14} /> Rekor</span>}<ChevronRight size={17} /></button>)}<button className="secondary-button full-button" onClick={() => setSelectedTrack(null)}>Kapat</button></section></div>}
      {toast && <div className="toast"><span>{toast}</span><button aria-label="Bildirimi kapat" onClick={() => setToast('')}><X size={15} /></button></div>}
      <div className="sr-only" aria-live="polite">{flow === 'running' && activeRun ? `Koşu sürüyor, ${formatDuration(activeRun.activeDurationSec)}, ${formatDistance(activeRun.distanceM, settings.distanceUnit)}` : ''}</div>
    </div>
  );
}
