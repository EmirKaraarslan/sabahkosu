import { useEffect } from 'react';
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from 'react-leaflet';
import type { RoutePoint } from '../types/models';

type LatLng = [number, number];

function FitRoute({ positions }: { positions: LatLng[] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length === 1) map.setView(positions[0]!, 16);
    else if (positions.length > 1) map.fitBounds(positions, { padding: [32, 32], maxZoom: 16 });
  }, [map, positions]);
  return null;
}

export function RouteMap({ points, className = '' }: { points: RoutePoint[]; className?: string }) {
  const positions = points.map((point) => [point.latitude, point.longitude] as LatLng);
  const center = positions[0] ?? [41.0082, 28.9784];

  if (points.length === 0) {
    return (
      <div className={`route-map route-map-empty ${className}`}>
        <div className="map-waiting">
          <span className="gps-pulse" />
          <strong>GPS noktası bekleniyor</strong>
          <span>Açık havaya çıkınca rota görünür.</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`route-map ${className}`}>
      <MapContainer center={center} zoom={16} zoomControl={false} scrollWheelZoom={false} dragging={false} doubleClickZoom={false} touchZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> katkıda bulunanlar'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitRoute positions={positions} />
        {positions.length > 1 && <Polyline positions={positions} pathOptions={{ color: '#176346', weight: 6, lineCap: 'round', lineJoin: 'round' }} />}
        <CircleMarker center={positions[0]!} radius={7} pathOptions={{ color: '#fff', weight: 3, fillColor: '#176346', fillOpacity: 1 }} />
        {positions.length > 1 && <CircleMarker center={positions[positions.length - 1]!} radius={8} pathOptions={{ color: '#fff', weight: 3, fillColor: '#e8b740', fillOpacity: 1 }} />}
      </MapContainer>
    </div>
  );
}
