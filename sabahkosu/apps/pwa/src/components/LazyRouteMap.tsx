import { lazy, Suspense } from 'react';
import type { RoutePoint } from '../types/models';

const RouteMap = lazy(() => import('./RouteMap').then((module) => ({ default: module.RouteMap })));

export function LazyRouteMap({ points }: { points: RoutePoint[] }) {
  return (
    <Suspense fallback={<div className="route-map map-waiting"><span>Harita yükleniyor…</span></div>}>
      <RouteMap points={points} />
    </Suspense>
  );
}
