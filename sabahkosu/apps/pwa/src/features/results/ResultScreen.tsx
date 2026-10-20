import { useEffect, useState } from 'react';
import { ArrowLeft, Award, Check, Flame, Share2, Star } from 'lucide-react';
import type { AppSettings, Run, Track } from '../../types/models';
import { formatDistance, formatDuration, formatPace } from '../../services/format';

export function ResultScreen({ run, track, settings, previousBestSec, onHome }: {
  run: Run;
  track?: Track;
  settings: AppSettings;
  previousBestSec?: number;
  onHome: () => void;
}) {
  const [showConfetti, setShowConfetti] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setShowConfetti(false), 2_400);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <main className="result-screen">
      {showConfetti && <div className="celebration-ribbons" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>}
      <button className="result-back" aria-label="Ana sayfaya dön" onClick={onHome}><ArrowLeft size={21} /></button>
      <div className="result-celebration">
        <div className="result-medal">{run.isRecord ? <Award size={41} /> : <Flame size={41} />}</div>
        <span className="result-kicker">KOŞU TAMAMLANDI</span>
        <h1>{run.isRecord ? 'YENİ PİST REKORU!' : 'HARİKA İŞ ÇIKARDIN!'}</h1>
        <p>{track?.name ?? 'Sabah koşusu'}</p>
        {run.isRecord && previousBestSec && <div className="record-compare"><span>Önceki en iyi <strong>{formatDuration(previousBestSec)}</strong></span><span className="compare-arrow">→</span><span>Yeni süre <strong>{formatDuration(run.activeDurationSec)}</strong></span></div>}
      </div>
      <div className="result-stars"><div className="star-orbit"><Star size={41} fill="currentColor" /></div><strong>+{run.starsEarned}</strong><span>YILDIZ KAZANDIN</span></div>
      <section className="result-stats">
        <div><span>SÜRE</span><strong>{formatDuration(run.activeDurationSec)}</strong></div>
        <div><span>MESAFE</span><strong>{formatDistance(run.distanceM, settings.distanceUnit)}</strong></div>
        <div><span>ORT. TEMPO</span><strong>{formatPace(run.avgPaceSecPerKm, settings.distanceUnit)}</strong></div>
      </section>
      <div className="result-footer-note"><Check size={16} /> Koşun bu telefona kaydedildi{run.isRecord ? ' ve pist rekorun güncellendi.' : '.'}</div>
      <button className="primary-button result-home-button" onClick={onHome}>ANA SAYFAYA DÖN</button>
      <button className="text-button result-share" onClick={() => { if (navigator.share) void navigator.share({ title: 'Sabah Koşusu', text: `${formatDistance(run.distanceM, settings.distanceUnit)} · ${formatDuration(run.activeDurationSec)} · ${formatPace(run.avgPaceSecPerKm, settings.distanceUnit)}` }); }}><Share2 size={16} /> Koşu özetini paylaş</button>
    </main>
  );
}
