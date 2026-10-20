import { useState } from 'react';
import { Check, MapPin, Plus, Route } from 'lucide-react';
import type { Track } from '../../types/models';
import type { TrackMatch } from '../../services/route-matching';
import { formatDistance } from '../../services/format';

export function TrackDecision({ candidates, defaultName, distanceM, onConfirmExisting, onCreateNew }: {
  candidates: TrackMatch[];
  defaultName: string;
  distanceM: number;
  onConfirmExisting: (track: Track) => void;
  onCreateNew: (name: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const best = candidates[0]?.track;
  return (
    <main className="page track-decision-page">
      <div className="decision-icon"><Route size={30} /></div>
      {distanceM < 100 ? <>
        <span className="step-label">KOŞU TAMAMLANDI</span>
        <h1>GPS rotası eksik</h1>
        <p className="decision-copy">Koşu kaydını saklayacağız; ancak güvenilir rota olmadığı için bunu bir piste bağlamayacak ve pist rekoru saymayacağız.</p>
        <div className="decision-distance"><MapPin size={16} /> Kaydedilen rota: {formatDistance(distanceM)}</div>
        <button className="primary-button full-button" onClick={() => onCreateNew('')}><Check size={18} /> Koşuyu kaydet</button>
      </> : <>
        <span className="step-label">ROTA KAYDEDİLDİ</span>
        {best ? <>
          <h1>Bu rota aynı pist mi?</h1>
          <p className="decision-copy">GPS rotan <strong>{best.name}</strong> pistine benziyor. Süre karşılaştırmalarının adil kalması için eşleşmeyi onayla.</p>
          <button className="candidate-track" onClick={() => onConfirmExisting(best)}><MapPin size={20} /><span><strong>{best.name}</strong><small>{formatDistance(best.distanceM)} · {best.runCount} koşu</small></span><Check size={19} /></button>
          <div className="decision-divider"><span>veya</span></div>
        </> : <>
          <h1>Yeni bir pist keşfettin!</h1>
          <p className="decision-copy">Bu rota başka bir kayıtlı pistle eşleşmedi. Ona bir isim ver.</p>
        </>}
        <label className="field-label">Pist adı<input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="Örn. Sahil turu" /></label>
        <div className="decision-distance"><MapPin size={16} /> Yaklaşık {formatDistance(distanceM)} rota</div>
        <button className="primary-button full-button" onClick={() => onCreateNew(name.trim() || defaultName)}><Plus size={18} /> Yeni pist olarak kaydet</button>
      </>}
    </main>
  );
}
