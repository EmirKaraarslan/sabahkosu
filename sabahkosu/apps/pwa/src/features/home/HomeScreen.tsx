import { ChevronRight, Flame, MapPin, Star, UserRound } from 'lucide-react';
import type { AppSettings, RoutePoint, Track } from '../../types/models';
import { formatDate, formatDuration, formatDistance } from '../../services/format';
import { RouteShape } from '../../components/RouteShape';

export interface TrackCardData {
  track: Track;
  points: RoutePoint[];
  lastRunAt?: number;
}

export function HomeScreen({
  settings,
  weeklyRuns,
  streak,
  stars,
  tracks,
  onStart,
  onProfile,
  onOpenTracks,
  onOpenTrack
}: {
  settings: AppSettings;
  weeklyRuns: number;
  streak: number;
  stars: number;
  tracks: TrackCardData[];
  onStart: () => void;
  onProfile: () => void;
  onOpenTracks: () => void;
  onOpenTrack: (track: Track) => void;
}) {
  const today = new Date();
  const greeting = today.getHours() < 12 ? 'Günaydın' : today.getHours() < 18 ? 'Merhaba' : 'İyi akşamlar';
  const featured = tracks[0];

  return (
    <main className="page home-page">
      <header className="home-header">
        <div>
          <h1>{greeting}{settings.displayName && settings.displayName !== 'Koşucu' ? `, ${settings.displayName}` : ''}</h1>
          <p>{formatDate(today.getTime(), { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <button className="profile-button" aria-label="Profili düzenle" onClick={onProfile}><UserRound size={23} /></button>
      </header>

      <section className="hero-card" aria-label="Sabah koşusu">
        <img src={`${import.meta.env.BASE_URL}images/track-hero.webp`} alt="Gün doğumunda boş bir koşu pisti" />
        <div className="hero-shade" />
        <p>Daha iyi bir sen<br />bugün mümkün.</p>
        <span className="hero-label">SABAH KOŞUSU</span>
      </section>

      <section className="summary-grid" aria-label="Haftalık ilerleme">
        <article className="summary-card goal-card">
          <div className="summary-heading"><span>HAFTALIK HEDEF</span><ChevronRight size={20} /></div>
          <strong>{weeklyRuns} / {settings.weekTargetRuns} koşu</strong>
          <div className="goal-dots" aria-label={`${weeklyRuns} koşu tamamlandı`}>
            {Array.from({ length: settings.weekTargetRuns }, (_, index) => <i key={index} className={index < weeklyRuns ? 'filled' : ''} />)}
          </div>
        </article>
        <article className="summary-card streak-card">
          <div className="summary-heading"><span>SERİ ATEŞİ</span><ChevronRight size={20} /></div>
          <div className="streak-total"><span className="flame-badge"><Flame size={31} fill="currentColor" /></span><strong>{streak} hafta</strong></div>
        </article>
      </section>

      <div className="home-star-note"><Star size={16} fill="currentColor" /> {stars} yıldız biriktirdin</div>

      <button className="primary-button start-button" onClick={onStart}>
        <span className="runner-mark" aria-hidden="true">↗</span>
        <span>KOŞUYA BAŞLA</span>
      </button>

      <section className="home-section-heading">
        <h2>PİSTLERİM</h2>
        <button aria-label="Tüm pistleri gör" onClick={onOpenTracks}><ChevronRight size={22} /></button>
      </section>
      {featured ? (
        <button className="featured-track-card" onClick={() => onOpenTrack(featured.track)}>
          <RouteShape points={featured.points} />
          <div className="featured-track-info">
            <strong>{featured.track.name}</strong>
            <span>{formatDistance(featured.track.distanceM, settings.distanceUnit)} · {featured.track.runCount} koşu</span>
            <span>En iyi süre {formatDuration(featured.track.bestDurationSec)}</span>
            <span className="track-stars"><Star size={17} fill="currentColor" /> {featured.track.totalStars} yıldız</span>
          </div>
          <ChevronRight className="track-chevron" size={20} />
        </button>
      ) : (
        <div className="empty-card home-empty"><MapPin size={22} /><span>İlk koşundan sonra rotan burada görünecek.</span></div>
      )}
    </main>
  );
}
