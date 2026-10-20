import { ChevronRight, MapPin, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AppSettings, Track } from '../../types/models';
import type { TrackCardData } from '../home/HomeScreen';
import { formatDistance, formatDuration } from '../../services/format';
import { RouteShape } from '../../components/RouteShape';

export function TracksScreen({ tracks, settings, onOpenTrack }: { tracks: TrackCardData[]; settings: AppSettings; onOpenTrack: (track: Track) => void }) {
  const [filter, setFilter] = useState<'all' | 'recent'>('all');
  const visible = useMemo(() => filter === 'recent' ? tracks.slice(0, 3) : tracks, [filter, tracks]);
  return (
    <main className="page list-page">
      <header className="page-title"><h1>Pistler</h1><p>Koştuğun rotalar</p></header>
      <div className="segmented-control">
        <button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>Tümü</button>
        <button className={filter === 'recent' ? 'selected' : ''} onClick={() => setFilter('recent')}>Son koşulan</button>
      </div>
      {visible.length ? <div className="track-list">
        {visible.map(({ track, points }) => (
          <button className="track-card" key={track.id} onClick={() => onOpenTrack(track)}>
            <RouteShape points={points} />
            <div className="track-card-info">
              <strong>{track.name}</strong>
              <span>{formatDistance(track.distanceM, settings.distanceUnit)} · {track.runCount} koşu</span>
              <span>En iyi süre {formatDuration(track.bestDurationSec)}</span>
              <span className="track-stars"><Star size={17} fill="currentColor" /> {track.totalStars}</span>
            </div>
            <ChevronRight size={21} className="track-chevron" />
          </button>
        ))}
      </div> : (
        <div className="empty-state large-empty"><div className="empty-icon"><MapPin size={28} /></div><h2>Henüz pist yok</h2><p>İlk koşunu tamamladığında GPS rotan burada kaydedilecek.</p></div>
      )}
    </main>
  );
}
