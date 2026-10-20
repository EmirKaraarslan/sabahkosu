# Sabah Koşusu

Kişisel kullanım için Türkçe, yerel veri odaklı bir iPhone koşu PWA'sı. Koşular ve GPS rotaları telefondaki IndexedDB'de saklanır; PC yedek sunucusu ve Telegram günlük arşivi isteğe bağlıdır.

## Şu anki durum

- Uygulama ve PC yedek servisi kaynak kodu hazır; Preview geliştirme içindir.
- Uygulama henüz herkese açık HTTPS adresinde yayımlanmadı ve gerçek iPhone'a kurulmadı. Ana ekrana PWA olarak ekleme, izinler ve GPS/Wake Lock davranışı gerçek iPhone'da ayrıca denenmelidir.
- iOS PWA'da ekran kilitliyken veya uygulama arka plandayken GPS takibi garanti edilmez; koşu sırasında uygulamayı önde, görünür ve açık tut.
- PC servisi kullanıcının bilgisayarına kurulmadı; özel ağ/HTTPS erişimi ve Telegram bot kimlik bilgileri henüz yapılandırılmadı.
- Telegram yedeği telefon numarasına doğrudan gönderilmez; botla başlatılmış özel sohbete gönderilir. Şifre çözme anahtarı PC'den ayrı, güvenli yerde saklanmalıdır.

## Geliştirme

Node.js 22+ ve pnpm ile proje kökünde:

```sh
pnpm install
pnpm dev
```

Kontrol ve üretim derlemesi:

```sh
pnpm check
pnpm build
```

PC yedek servisi testleri:

```sh
cd pc-backup
node --check server.mjs
node --test server.test.mjs
```

## PC yedekleme

Kurulum ve güvenlik adımları [`pc-backup/README.md`](pc-backup/README.md) içindedir. Sunucu varsayılan olarak yalnız `127.0.0.1` üzerinde dinler. iPhone'dan erişim için ayrıca özel, erişim kontrollü HTTPS/VPN yolu gerekir; yönlendiricide internete açık port açma. PC kapalı veya çevrimdışıyken PWA kayıtları telefonda kuyrukta kalır.
