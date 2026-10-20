import type { RoutePoint } from '../types/models';

export function RouteShape({ points, className = '' }: { points: RoutePoint[]; className?: string }) {
  if (points.length < 2) return <div className={`route-shape route-shape-empty ${className}`}><span>Rota kaydı yok</span></div>;
  const lats = points.map((point) => point.latitude);
  const lngs = points.map((point) => point.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latSpan = maxLat - minLat || 0.00001;
  const lngSpan = maxLng - minLng || 0.00001;
  const sampled = points.filter((_, index) => index === 0 || index === points.length - 1 || index % Math.max(1, Math.ceil(points.length / 80)) === 0);
  const path = sampled.map((point, index) => {
    const x = 16 + ((point.longitude - minLng) / lngSpan) * 168;
    const y = 114 - ((point.latitude - minLat) / latSpan) * 88;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  return (
    <div className={`route-shape ${className}`}>
      <svg viewBox="0 0 200 130" role="img" aria-label="Kaydedilmiş koşu rotası">
        <path d={path} fill="none" stroke="#176346" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        {sampled.length > 0 && <circle cx={16 + ((sampled[0]!.longitude - minLng) / lngSpan) * 168} cy={114 - ((sampled[0]!.latitude - minLat) / latSpan) * 88} r="6" fill="#176346" stroke="white" strokeWidth="3" />}
        {sampled.length > 1 && <circle cx={16 + ((sampled[sampled.length - 1]!.longitude - minLng) / lngSpan) * 168} cy={114 - ((sampled[sampled.length - 1]!.latitude - minLat) / latSpan) * 88} r="6" fill="#e8b740" stroke="white" strokeWidth="3" />}
      </svg>
    </div>
  );
}
