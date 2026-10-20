import { Award, ChevronRight, Clock3, Route, Star } from 'lucide-react';
import type { AppSettings, Run, Track } from '../../types/models';
import { formatDate, formatDistance, formatDuration, formatPace } from '../../services/format';

export interface RunCardData {
  run: Run;
  track?: Track;
}

export function HistoryScreen({ runs, settings, onOpenRun }: { runs: RunCardData[]; settings: AppSettings; onOpenRun: (run: Run) => void }) {
  return (
    <main className="page list-page">
      <header className="page-title"><h1>Geçmiş</h1><p>Koşu yolculuğun</p></header>
      <div className="history-summary"><Route size={18} /><span>{runs.length} koşu kaydedildi</span></div>
      {runs.length ? <div className="history-list">
        {runs.map(({ run, track }) => (
          <button className="history-card" key={run.id} onClick={() => onOpenRun(run)}>
            <div className="history-date"><span>{formatDate(run.endedAt ?? run.startedAt, { weekday: 'short' })}</span><strong>{formatDate(run.endedAt ?? run.startedAt, { day: 'numeric', month: 'short' })}</strong></div>
            <div className="history-main">
              <strong>{track?.name ?? 'Pist eşleştirilmedi'}</strong>
              <span className="history-metrics"><span><Clock3 size={14} /> {formatDuration(run.activeDurationSec)}</span><span>{formatDistance(run.distanceM, settings.distanceUnit)}</span><span>{formatPace(run.avgPaceSecPerKm, settings.distanceUnit)}</span></span>
              <span className="history-badges">{run.isRecord && <span className="record-badge"><Award size={14} /> Rekor</span>}<span className="track-stars"><Star size={15} fill="currentColor" /> {run.starsEarned} yıldız</span></span>
            </div>
            <ChevronRight className="track-chevron" size={20} />
          </button>
        ))}
      </div> : <div className="empty-state large-empty"><div className="empty-icon"><Clock3 size={28} /></div><h2>İlk koşun seni bekliyor</h2><p>Tamamladığın koşular ve gelişimin burada birikecek.</p></div>}
    </main>
  );
}
