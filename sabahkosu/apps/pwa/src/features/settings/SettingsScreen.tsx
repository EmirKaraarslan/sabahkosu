import { useEffect, useRef, useState } from 'react';
import { Bell, Check, ChevronRight, CloudUpload, Download, LockKeyhole, Map, Mic2, ShieldCheck, Target, Upload } from 'lucide-react';
import type { AppSettings } from '../../types/models';

export interface BackupUiState {
  pending: number;
  lastMessage: string;
  busy: boolean;
}

export function SettingsScreen({ settings, backup, onSave, onSync, onExport, onImport, onRestorePc }: {
  settings: AppSettings;
  backup: BackupUiState;
  onSave: (settings: AppSettings) => Promise<void>;
  onSync: () => Promise<void>;
  onExport: () => Promise<void>;
  onImport: (file: File) => Promise<void>;
  onRestorePc: () => Promise<void>;
}) {
  const [form, setForm] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [showPc, setShowPc] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => setForm(settings), [settings]);
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setForm((current) => ({ ...current, [key]: value }));
  const persist = async () => { await onSave(form); setSaved(true); window.setTimeout(() => setSaved(false), 1800); };
  const withBusy = async (action: () => Promise<void>) => { setBusyAction(true); try { await action(); } finally { setBusyAction(false); } };

  return (
    <main className="page settings-page">
      <header className="page-title"><h1>Ayarlar</h1><p>Koşu düzenini kendine göre ayarla</p></header>
      <section className="settings-card">
        <div className="settings-section-title"><Target size={19} /><h2>Koşu hedefi</h2></div>
        <label className="setting-row"><span>Haftalık koşu hedefi</span><select value={form.weekTargetRuns} onChange={(event) => update('weekTargetRuns', Number(event.target.value))}>{[1,2,3,4,5,6,7].map((n) => <option key={n} value={n}>{n} gün</option>)}</select></label>
        <label className="setting-row"><span>Mesafe birimi</span><select value={form.distanceUnit} onChange={(event) => update('distanceUnit', event.target.value as AppSettings['distanceUnit'])}><option value="km">Kilometre</option><option value="mi">Mil</option></select></label>
        <ToggleRow icon={<Map size={18} />} label="Koşuda haritayı varsayılan aç" checked={form.defaultMapOn} onChange={(checked) => update('defaultMapOn', checked)} />
        <ToggleRow icon={<LockKeyhole size={18} />} label="Cep modunu varsayılan aç" checked={form.pocketModeDefault} onChange={(checked) => update('pocketModeDefault', checked)} />
      </section>

      <section className="settings-card">
        <div className="settings-section-title"><Bell size={19} /><h2>Hatırlatıcı ve ses</h2></div>
        <ToggleRow icon={<Mic2 size={18} />} label="Kilometre başı sesli özet" checked={form.voiceAnnouncements} onChange={(checked) => update('voiceAnnouncements', checked)} />
        <ToggleRow icon={<Bell size={18} />} label="Sabah hatırlatıcısı" checked={form.reminderEnabled} onChange={(checked) => update('reminderEnabled', checked)} />
        {form.reminderEnabled && <label className="setting-row"><span>Hatırlatma saati</span><input type="time" value={form.reminderTime} onChange={(event) => update('reminderTime', event.target.value)} /></label>}
        <p className="setting-note">PWA hatırlatıcıları iPhone bildirim izinlerine ve kurulum durumuna bağlıdır.</p>
      </section>

      <section className="settings-card backup-card">
        <div className="settings-section-title"><ShieldCheck size={19} /><h2>Veri yedeği</h2></div>
        <div className="backup-state"><span className={`status-dot ${form.backupEnabled ? 'connected' : ''}`} /><div><strong>{form.backupEnabled ? 'PC yedeği açık' : 'Yedek ayarlanmadı'}</strong><p>{backup.pending ? `${backup.pending} koşu gönderilmeyi bekliyor` : backup.lastMessage || 'Koşular önce telefona kaydedilir.'}</p></div></div>
        <button className="setting-action" onClick={() => setShowPc((open) => !open)}><CloudUpload size={19} /><span>PC yedek bağlantısını ayarla</span><ChevronRight size={18} /></button>
        {showPc && <div className="pc-backup-fields">
          <label>PC’nin özel HTTPS adresi<input type="url" placeholder="https://..." value={form.backupUrl} onChange={(event) => update('backupUrl', event.target.value)} autoCapitalize="none" autoCorrect="off" /></label>
          <label>Yedek erişim anahtarı<input type="password" placeholder="PC’de oluşturulan anahtar" value={form.backupToken} onChange={(event) => update('backupToken', event.target.value)} autoCapitalize="none" autoCorrect="off" /></label>
          <ToggleRow icon={<CloudUpload size={18} />} label="Koşuları PC’ye eşitle" checked={form.backupEnabled} onChange={(checked) => update('backupEnabled', checked)} />
          <p className="setting-note">PC kapalıysa koşular telefonda sırada kalır. Eşitleme, uygulama yeniden açıldığında ve bağlantı geldiğinde denenir.</p>
          <button className="secondary-button full-button" disabled={busyAction || !form.backupEnabled} onClick={() => void withBusy(onSync)}>{busyAction ? 'Bağlanıyor…' : 'Şimdi eşitle'}</button>
          <button className="text-button" disabled={busyAction || !form.backupEnabled} onClick={() => void withBusy(onRestorePc)}>PC’den yedeği geri yükle</button>
        </div>}
        <div className="backup-actions">
          <button className="setting-action" onClick={() => void withBusy(onExport)}><Download size={19} /><span>JSON yedeğini indir</span><ChevronRight size={18} /></button>
          <button className="setting-action" onClick={() => fileInput.current?.click()}><Upload size={19} /><span>Dosyadan geri yükle</span><ChevronRight size={18} /></button>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void withBusy(() => onImport(file)); event.currentTarget.value = ''; }} />
        </div>
        {saved && <div className="save-confirm"><Check size={16} /> Ayarlar kaydedildi</div>}
      </section>
      <button className="primary-button save-settings" onClick={() => void persist()}><Check size={19} /> Değişiklikleri kaydet</button>
      <p className="privacy-note"><LockKeyhole size={15} /> Koşu rotaların bu telefonda ve eşitlediğin PC’de saklanır.</p>
    </main>
  );
}

function ToggleRow({ icon, label, checked, onChange }: { icon: React.ReactNode; label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="setting-row toggle-row"><span className="setting-label"><span className="setting-icon">{icon}</span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="switch" /></label>;
}
