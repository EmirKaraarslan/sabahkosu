import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, CircleHelp, LockKeyhole, Map, Pause, Play, Shield, Smartphone, Square, Volume2 } from 'lucide-react';
import type { AppSettings, Run } from '../../types/models';
import { formatDistance, formatDuration, formatPace } from '../../services/format';
import { useRunRecorder } from './useRunRecorder';

const RouteMap = lazy(() => import('../../components/RouteMap').then((module) => ({ default: module.RouteMap })));

export function PreRunScreen({ mapOn, pocketMode, onMapChange, onPocketChange, onStart, onCancel }: {
  mapOn: boolean;
  pocketMode: boolean;
  onMapChange: (value: boolean) => void;
  onPocketChange: (value: boolean) => void;
  onStart: () => void;
  onCancel: () => void;
}) {
  return (
    <main className="page pre-run-page">
      <button className="back-button" onClick={onCancel}><ArrowLeft size={19} /> Ana sayfa</button>
      <header className="page-title"><h1>Koşuya hazırlan</h1><p>Hazır olduğunda başlayabilirsin.</p></header>
      <section className="pre-run-card">
        <div className="settings-section-title"><Map size={20} /><h2>Canlı harita</h2></div>
        <p>Harita kapanırsa GPS kaydı, süre ve mesafe çalışmaya devam eder.</p>
        <div className="choice-row">
          <button className={`choice-card ${mapOn ? 'choice-selected' : ''}`} onClick={() => onMapChange(true)}><Map size={22} /><strong>Harita açık</strong><span>Rotanı ekranda gör</span></button>
          <button className={`choice-card ${!mapOn ? 'choice-selected' : ''}`} onClick={() => onMapChange(false)}><Map size={22} /><strong>Haritasız</strong><span>Metrikleri gör</span></button>
        </div>
      </section>
      <section className={`pre-run-card pocket-choice ${pocketMode ? 'pocket-active' : ''}`}>
        <div className="settings-section-title"><Smartphone size={20} /><h2>Cep modu</h2></div>
        <p>Telefon cebindeyken yanlış dokunuşları kilitler, haritayı gizler ve her kilometrede sesli özet verir.</p>
        <button className={`pill-toggle ${pocketMode ? 'on' : ''}`} role="switch" aria-checked={pocketMode} onClick={() => onPocketChange(!pocketMode)}><span />{pocketMode ? 'Açık' : 'Kapalı'}</button>
        {pocketMode && <div className="inline-notice"><LockKeyhole size={16} /> Koşu sırasında 2 saniye basılı tutarak kilidi açıp modu değiştirebilirsin.</div>}
      </section>
      <div className="pre-run-note"><CircleHelp size={17} /><span>Koşu kaydı için konum izni gerekir. Uygulama görünür ve açık kalmalıdır.</span></div>
      <button className="primary-button run-start-cta" onClick={onStart}><Play size={20} fill="currentColor" /> KOŞUYU BAŞLAT</button>
    </main>
  );
}

export function LiveRunScreen({ run, settings, pocketMode, mapOn, onRunUpdate, onPause, onResume, onFinish, onMapChange, onPocketChange }: {
  run: Run;
  settings: AppSettings;
  pocketMode: boolean;
  mapOn: boolean;
  onRunUpdate: (run: Run) => void;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  onMapChange: (value: boolean) => void;
  onPocketChange: (value: boolean) => void;
}) {
  const { points, gpsMessage, elapsedSeconds } = useRunRecorder(run, onRunUpdate);
  const [locked, setLocked] = useState(pocketMode && run.status === 'recording');
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const holdTimer = useRef<number | undefined>(undefined);
  const distanceM = run.distanceM;
  const pace = distanceM > 0 ? elapsedSeconds / (distanceM / 1000) : null;

  useEffect(() => setLocked(pocketMode && run.status === 'recording'), [pocketMode, run.id]);

  useEffect(() => {
    if (run.status !== 'recording' || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;
    const request = async () => {
      if (document.visibilityState !== 'visible' || disposed) return;
      try {
        sentinel = await navigator.wakeLock.request('screen');
        if (!disposed) setWakeLockActive(true);
        sentinel.addEventListener('release', () => { if (!disposed) setWakeLockActive(false); }, { once: true });
      } catch {
        if (!disposed) setWakeLockActive(false);
      }
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') void request(); };
    void request();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (sentinel && !sentinel.released) void sentinel.release();
      setWakeLockActive(false);
    };
  }, [run.status]);

  const announcedKm = useRef(0);
  useEffect(() => {
    if (distanceM < 1000) return;
    const completedKm = Math.floor(distanceM / 1000);
    if (completedKm <= announcedKm.current) return;
    announcedKm.current = completedKm;
    if (!settings.voiceAnnouncements || !('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(`${completedKm} kilometre. Toplam süre ${formatDuration(elapsedSeconds)}. Ortalama tempon ${formatPace(pace, settings.distanceUnit)}.`);
    utterance.lang = 'tr-TR';
    utterance.rate = 0.98;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [distanceM, elapsedSeconds, pace, settings.distanceUnit, settings.voiceAnnouncements]);

  useEffect(() => () => { if (holdTimer.current) window.clearTimeout(holdTimer.current); }, []);
  const startHold = () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      if (pocketMode && locked) setLocked(false);
      else if (pocketMode) { onPocketChange(false); setLocked(false); }
      else { onPocketChange(true); setLocked(true); }
    }, 2_000);
  };
  const cancelHold = () => { if (holdTimer.current) window.clearTimeout(holdTimer.current); holdTimer.current = undefined; };

  if (pocketMode && locked) {
    return (
      <main className="run-screen pocket-locked">
        <header className="run-header"><span className="run-status"><i /> {run.status === 'paused' ? 'KOŞU DURAKLATILDI' : 'KOŞU SÜRÜYOR'}</span><span className="pocket-label"><LockKeyhole size={16} /> CEP MODU</span></header>
        <p className="run-encouragement">Güçlü ol, devam et.</p>
        <div className="pocket-metrics">
          <div className="pocket-primary-metric"><span>SÜRE</span><strong>{formatDuration(elapsedSeconds)}</strong></div>
          <div className="pocket-secondary-metrics"><div><strong>{formatDistance(distanceM, settings.distanceUnit)}</strong><span>MESAFE</span></div><div><strong>{formatPace(pace, settings.distanceUnit)}</strong><span>ORT. TEMPO</span></div></div>
        </div>
        <div className="gps-status"><span className="gps-pulse" />{gpsMessage}</div>
        <div className="pocket-hold" onPointerDown={startHold} onPointerUp={cancelHold} onPointerLeave={cancelHold} onPointerCancel={cancelHold} onContextMenu={(event) => event.preventDefault()} role="button" tabIndex={0} aria-label="Cep modu kilidini açmak için iki saniye basılı tut">
          <LockKeyhole size={22} /><span>Kontrolleri açmak için<br /><strong>2 saniye basılı tut</strong></span>
        </div>
        <p className="wake-note"><Shield size={15} /> {wakeLockActive ? 'Ekran açık tutuluyor' : 'Ekranı açık tutma isteği etkin değil'}</p>
      </main>
    );
  }

  return (
    <main className="run-screen">
      <header className="run-header"><span className="run-status"><i /> {run.status === 'paused' ? 'KOŞU DURAKLATILDI' : 'KOŞU SÜRÜYOR'}</span>{pocketMode ? <span className="pocket-label"><LockKeyhole size={16} /> CEP MODU AÇIK</span> : <span className="run-live-label">CANLI TAKİP</span>}</header>
      <div className="run-encouragement">Güçlü ol, devam et.</div>
      <div className="run-map-wrap">
        {mapOn && !pocketMode ? <Suspense fallback={<div className="route-map map-waiting"><span>Harita yükleniyor…</span></div>}><RouteMap points={points} className="live-map" /></Suspense> : <div className="map-off-card"><Map size={28} /><strong>Harita kapalı</strong><span>Konum kaydı devam ediyor.</span></div>}
        <div className="map-toggle"><Map size={16} /><span>Harita</span><button className={`mini-switch ${mapOn && !pocketMode ? 'active' : ''}`} role="switch" aria-checked={mapOn && !pocketMode} onClick={() => onMapChange(!mapOn || pocketMode)}><i /></button></div>
      </div>
      <div className="live-metrics">
        <div><strong>{formatDuration(elapsedSeconds)}</strong><span>SÜRE</span></div>
        <div><strong>{formatDistance(distanceM, settings.distanceUnit)}</strong><span>MESAFE</span></div>
        <div><strong>{formatPace(pace, settings.distanceUnit)}</strong><span>ORT. TEMPO</span></div>
      </div>
      <div className="gps-status"><span className={`gps-pulse ${gpsMessage.includes('zayıf') ? 'gps-weak' : ''}`} />{gpsMessage}{wakeLockActive && <span className="wake-inline"><Check size={14} /> Ekran açık</span>}</div>
      {pocketMode && <div className="inline-notice pocket-unlock-hint"><LockKeyhole size={15} /> Cep modunu kilitlemek için aşağıdaki alana 2 saniye basılı tut.</div>}
      {run.status === 'paused' && <div className="paused-banner">Koşu duraklatıldı · süre sayacı bekliyor</div>}
      {confirmFinish && <div className="finish-confirm"><strong>Koşuyu bitirmek istiyor musun?</strong><span>Kaydedilen rota ve süre korunacak.</span><div><button className="secondary-button" onClick={() => setConfirmFinish(false)}>Devam et</button><button className="danger-button" onClick={onFinish}><Check size={17} /> Evet, bitir</button></div></div>}
      <div className="run-controls">
        {run.status === 'recording' ? <button className="control-button pause-control" onClick={onPause}><Pause size={28} fill="currentColor" /><span>DURAKLAT</span></button> : <button className="control-button pause-control" onClick={onResume}><Play size={27} fill="currentColor" /><span>DEVAM ET</span></button>}
        {!confirmFinish && <button className="control-button finish-control" onClick={() => setConfirmFinish(true)}><Square size={24} fill="currentColor" /><span>BİTİR</span></button>}
      </div>
      <div className="run-control-lock" onPointerDown={startHold} onPointerUp={cancelHold} onPointerLeave={cancelHold} onPointerCancel={cancelHold} onContextMenu={(event) => event.preventDefault()} role="button" tabIndex={0} aria-label={pocketMode ? 'Cep modunu kapatmak için iki saniye basılı tut' : 'Cep modunu açmak için iki saniye basılı tut'}>
        <LockKeyhole size={16} />{pocketMode ? 'Cep modunu kapatmak için 2 sn basılı tut' : 'Cep modunu açmak için 2 sn basılı tut'}
      </div>
      <p className="wake-note"><Volume2 size={15} /> {settings.voiceAnnouncements ? 'Kilometre başı sesli özet açık' : 'Sesli özet kapalı'} · Ekran kapalıyken kayıt garanti edilmez.</p>
    </main>
  );
}
