import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { AppSettings } from '../../types/models';

export function ProfileSheet({ settings, onClose, onSave }: { settings: AppSettings; onClose: () => void; onSave: (settings: AppSettings) => Promise<void> }) {
  const [name, setName] = useState(settings.displayName);
  const [saved, setSaved] = useState(false);
  useEffect(() => setName(settings.displayName), [settings.displayName]);
  const submit = async () => {
    await onSave({ ...settings, displayName: name.trim() || 'Koşucu' });
    setSaved(true);
    window.setTimeout(onClose, 350);
  };
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="profile-sheet" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <div className="sheet-handle" />
        <div className="sheet-header"><h2 id="profile-title">Profil</h2><button aria-label="Kapat" onClick={onClose}><X size={21} /></button></div>
        <div className="profile-avatar">{name.trim().charAt(0).toLocaleUpperCase('tr-TR') || 'K'}</div>
        <label className="field-label">Adın<input autoFocus value={name} maxLength={32} onChange={(event) => setName(event.target.value)} placeholder="Adını yaz" /></label>
        <button className="primary-button full-button" onClick={() => void submit()}><Check size={18} /> {saved ? 'Kaydedildi' : 'Profili kaydet'}</button>
      </section>
    </div>
  );
}
