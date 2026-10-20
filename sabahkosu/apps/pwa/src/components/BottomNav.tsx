import { Clock3, House, MapPin, Settings } from 'lucide-react';
import type { TabId } from '../app/navigation';

const tabs: { id: TabId; label: string; icon: typeof House }[] = [
  { id: 'home', label: 'Ana Sayfa', icon: House },
  { id: 'tracks', label: 'Pistler', icon: MapPin },
  { id: 'history', label: 'Geçmiş', icon: Clock3 },
  { id: 'settings', label: 'Ayarlar', icon: Settings }
];

export function BottomNav({ active, onChange }: { active: TabId; onChange: (tab: TabId) => void }) {
  return <nav className="bottom-nav" aria-label="Ana gezinme">{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={active === id ? 'active' : ''} aria-current={active === id ? 'page' : undefined} onClick={() => onChange(id)}><Icon size={23} strokeWidth={active === id ? 2.6 : 1.8} /><span>{label}</span></button>)}</nav>;
}
