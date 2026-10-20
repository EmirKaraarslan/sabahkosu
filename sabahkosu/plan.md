# Sabah Koşusu PWA — uygulama planı

## Amaç ve kapsam

iPhone’da kişisel kullanım için, masrafsız ve çevrimdışı temel koşu kaydı sunan Türkçe bir PWA yapılacak. Uygulama hesabı, ücretli harita API’si veya managed backend/veritabanı servisi kullanmayacak. Telefon birincil veri kaynağı olacak; tamamlanan koşular güvenli bağlantı olduğunda kullanıcının PC’sindeki yerel yedek servisine aktarılacak. PWA çevrimdışıyken aktarım kuyruğa alınacak. PC, koşu yedeklerini yerelde saklayıp günde bir şifreli arşivi kullanıcının Telegram bot sohbetine gönderecek.

Uygulama PWA olarak ana ekrana eklenebilir olacak. Koşu GPS’i uygulama önde ve görünürken çalışacak. Ekranı uyanık tutmak için Wake Lock istenecek; iOS bunun reddedilebileceğini veya bırakılabileceğini belirttiğinden gerçek iPhone’da denenmesi gerekir. Uygulamadan çıkınca veya ekran kilitlenince arka plan GPS kaydı garanti edilmez. İnternet yokken koşu ve GPS noktaları kaydedilir; harita taban döşemeleri çevrimdışı garanti edilmez.

## Ekran ve davranış kapsamı

Dört alt sekme olacak: **Ana Sayfa, Pistler, Geçmiş, Ayarlar**. Profil düzenleme, üstteki profil alanından açılacak. Ekranlar kullanıcının onayladığı mockup’ların sade Apple-benzeri görsel diliyle uygulanacak.

Koşu akışı: Ana Sayfa → koşu öncesi Cep modu seçimi → canlı takip → duraklat/devam et → bitir → atlanabilir koşu anketi → sonuç/kutlama ekranı. Canlı takipte harita açık/kapalı olabilir; her iki görünümde süre, mesafe ve ortalama tempo kalır. Cep modunda harita kapanır, ekrana rastgele dokunma kontrolleri etkilemez, kilometre başına sesli özet verilir. Mod, koşu öncesi seçilebilir; koşu sırasında kilit alanına uzun basarak değiştirilebilir. Duraklat/devam ve bitir kontrolleri normal modda görünür.

Koşu sonu anketinde tempo hissi 1 (rahat)–5 (zorlayıcı), süre hissi 1 (kısa)–5 (uzun), yorgunluk 1 (hiç yorgun değilim)–5 (çok yorgunum) olarak puanlanır; anket atlanabilir. Ayrı sonuç ekranı yeni rekoru önceki en iyi toplam süreyle karşılaştırır ve rekor/yıldız ödüllerini büyük kutlamalı başlıklarla gösterir.

Her koşu GPS rotası olarak kaydedilir. Aynı pist adayı; benzer rota şekli, başlangıç/bitiş yakınlığı, aynı yön ve yaklaşık %10’dan az mesafe farkıyla bulunur; ilk eşleşme kullanıcıya sorulur. Ters yön ayrı pisttir. Pist için en iyi toplam süre tutulur; tempo koşu özetinde gösterilir.

Yıldızlar: koşuyu tamamla +1; yeni pist keşfi ilk sefer +1; pistte yeni en iyi süre +1; haftalık hedefi tamamlama +1; hedef üstündeki ilk ekstra koşu +3. Koşu başına farklı uygun ödüller birikebilir; aynı ödül olayı iki kez yazılmaz. Hafta Pazartesi–Pazar kabul edilir. Haftalık koşu hedefi tutunca seri ateşi bir hafta uzar; tutmazsa söner. Ayda bir esneklik hakkı hedef kaçırılan haftada seriyi koruyabilir; eksik koşu veya haftalık hedef yıldızı kazandırmaz. Hak ayda bir yenilenir ve kullanılmadan önce sorulur.

Ayarlar: haftalık koşu hedefi, seri esnekliği durumu, varsayılan harita, kilometre birimi, sabah hatırlatıcısı, sesli özet tercihi ve veri dışa aktarma. Ana sayfada hedef, seri ateşi, koşuyu başlat ve en son/öne çıkan pist gösterilir.

## Teknik yaklaşım

- **İstemci:** React + TypeScript + Vite; mobil öncelikli tek sayfalı arayüz.
- **PWA:** uygulamaya ait manifest, ikonlar ve Service Worker; uygulama kabuğu ve temel dosyalar çevrimdışı önbelleğe alınır.
- **Yerel veritabanı:** IndexedDB, Dexie erişim katmanı. Kaynak gerçek (source of truth) telefondur. Koşu kaydı açılır açılmaz oluşturulur; her konum örneği geldiğinde sırayla yazılır. Koşu tamamlanırken özet, anket, pist eşleştirmesi ve ödül olayları birlikte güncellenir.
- **Konum/ekran:** Geolocation API `watchPosition`; görünür koşu ekranı sırasında Screen Wake Lock. Düşük pil/güç modu ve iOS sayfa yaşam döngüsü nedeniyle Wake Lock/GPS mutlak garanti olarak sunulmaz.
- **Harita:** Leaflet tabanlı rota çizimi; başlangıçta ücretli API anahtarı gerektirmeyen OpenStreetMap tabanlı katman. Harita altlığı yoksa GPS verisi silinmez; rota basit zemin üzerinde çizilebilir.
- **PC yedek servisi:** Aynı proje içinde ayrı `pc-backup/` Node.js servisi hazırlanır; tamamlanan koşuları ve GPS noktalarını tekil koşu kimliğiyle, pist/rekor kayıtlarını, haftalık seri-esneklik durumunu ve sırları ayıklanmış tercihleri alır. Koşular PC’de dosya tabanlı yerel arşive, diğer uygulama durumu tek korumalı JSON dosyasına yazılır; yinelenen koşu gönderimleri idempotent işlenir. API yalnız özel HTTPS bağlantısından erişilebilir tasarlanır; yönlendiricide herkese açık port açılmaz. PWA’da senkronizasyon adresi ve bağlantı durumu bulunur.
- **Çevrimdışı eşitleme:** PWA her koşu için `syncOutbox` kaydı oluşturur. PC erişilemiyorsa veri telefonda kalır; PWA tekrar açık ve ağ bağlantısı varken gönderim yeniden denenir. iOS’ta uygulama kapalıyken arka plan senkronizasyonu garanti edilmez.
- **Telegram yedeği:** PC günlük zamanlayıcıyla yerel arşivi şifreli dosyaya çevirip Telegram botu aracılığıyla kullanıcının özel sohbetine gönderir. Bot anahtarı yalnız PC’de saklanır, PWA’ya konmaz. Telegram’a telefon numarasına doğrudan mesaj değil, bot başlatılmış özel sohbet üzerinden gönderim yapılır. PC kapalı/uykusuz veya internetsizse günlük iş o anda çalışamaz; PC yeniden açılınca eksik yedek için telafi çalıştırması yapılır.
- **Kurtarma ve gizlilik:** Ayarlarda JSON dışa aktarma/geri yükleme kalır. Telegram’a giden arşiv şifreli olacağından çözme anahtarı ayrıca güvenli yerde saklanır; anahtar olmadan yedek açılamaz.
- **Altyapı ve test yayını:** WebDev managed server ve database kapalı kalır; mevcut Manus-hosted test yayını ayrı olarak durur. Kullanıcı ayrıca GitHub Pages’e test yayını ve kaynak kodunun public olmasına açıkça izin verdi. Canonical Manus deposu değişmeden kalır; ayrı `EmirKaraarslan35/sabahkosu` public GitHub deposu GitHub Pages kaynağıdır. GitHub Actions kilitli pnpm sürümüyle derleyip `apps/pwa/dist` içeriğini yayımlar. Proje deposu alt yolunda yayınlandığı için `base`, manifest, ikonlar, görseller ve Service Worker `/sabahkosu/` altına uygun yapılandırılır. Koşu verisi uygulamada telefonda kalır ve repoya gönderilmez. PC servisi/Telegram yedeği henüz kurulmuş değildir.

## Veri modeli

IndexedDB depoları: `runs` (koşu durumu, özet, pist bağlantısı, anket), `routePoints` (runId + sıra ile GPS örnekleri), `tracks` (pist yönü, mesafesi, temsil rotası ve en iyi süre), `starEvents` (her ödülün idempotent defteri), `weeklyProgress` (haftalık hedef, durum ve esneklik kullanımı), `settings` (kullanıcı tercihleri ve PC bağlantı durumu), `syncOutbox` (PC’ye gönderilmeyi bekleyen koşu kimliği, sürüm, deneme sayısı ve durum). PC servisi her koşuyu tekil dosyada, güncel pist/hafta/tercih durumunu korumalı JSON dosyasında, hepsini de günlük şifreli arşivde tutar.

## Proje yapısı

- `apps/pwa/src/app/`: uygulama kabuğu, sekme yönlendirme ve global durum.
- `apps/pwa/src/features/home/`, `tracks/`, `history/`, `settings/`, `profile/`: ana sekmeler ve profil düzenleme.
- `apps/pwa/src/features/run/`: koşu öncesi ayarlar, canlı takip, Cep modu ve GPS durumları.
- `apps/pwa/src/features/survey/`, `results/`: anket, rekor karşılaştırması ve ödül kutlaması.
- `apps/pwa/src/components/`: ortak kart, buton, alt sekme, harita ve sayı bileşenleri.
- `apps/pwa/src/db/`: IndexedDB şeması ve veritabanı erişimi.
- `apps/pwa/src/services/`: GPS noktası işleme, rota eşleştirme, süre/mesafe, yıldız/seri kuralları, yedekleme/eşitleme, Wake Lock ve sesli özet.
- `apps/pwa/public/`: manifest, ikonlar, çevrimdışı pist görseli ve PWA sabit dosyaları.
- `pc-backup/`: PC’de ayrı çalıştırılacak senkronizasyon API’si, yerel koşu arşivi ve Telegram günlük yedek zamanlayıcısı; tokenlar ve şifreleme anahtarları örnek yapılandırma dışında tutulur.

## Tasarım yönü

- **Tasarım hareketi:** Apple Human Interface yaklaşımından esinlenen, markaları veya birebir Apple arayüzünü kopyalamayan sade yerel-iOS hissi.
- **İlkeler:** koşu sırasında düşük dikkat yükü; açık ve büyük metrikler; tutarlı gezinme; oyun ödüllerinde ölçülü kutlama.
- **Renk:** beyaz/açık zemin ve koyu orman yeşili eylem/rota vurgusu; altın sarısı yıldız ödülü; yardımcı gri metin.
- **Yerleşim:** mobil tek sütun, geniş aralıklar, yuvarlatılmış kartlar ve sabit dört sekmeli alt menü; koşu sırasında alt menü yerine büyük güvenli kontroller.
- **İmza öğeleri:** sabah koşu pisti fotoğrafı, yeşil GPS rota çizgileri, seri ateşi ve yıldız.
- **Etkileşim/animasyon:** büyük dokunma alanları; Cep modunda dokunma kilidi ve uzun basma ile değiştirme; rekor/yıldızda kısa, dikkat dağıtmayan kutlama.
- **Tipografi:** iOS sistem sans-serif ailesi ve platform uygun yedekler; başlıklar belirgin, canlı metrikler büyük, yardımcı metinler düşük kontrastlı ama okunaklı.
- **Marka:** Sabah koşusuna düzenli çıkmak isteyen tek kullanıcıya, kendi parkurunda gelişimini sakin biçimde gösteren uygulama. Kişilik: sade, teşvik edici, kişisel.
- **Ses tonu:** kısa ve destekleyici. Örnekler: “Günaydın.” / “Güçlü ol, devam et.”
- **İşaret/ikon:** basit bir koşu rotası halkasının üzerinde doğan güneş; uygulama adı tipografi olarak kalır, ayrı bir marka logosu taklit edilmez.
- **İmza renk:** koyu orman yeşili.

## Uygulama sırası

Plan onaylandığından önce tam kabul koşullarını taşıyan `TODO.md` oluşturulacak; ardından PWA kabuğu/manifest, yerel veritabanı, ana sekmeler, GPS koşu akışı, anket/sonuç ve ödül kuralları uygulanacak. Buna ek olarak PC yedek servisi, PWA gönderim kuyruğu, güvenli PC API’si, günlük şifreli Telegram arşivi ve geri yükleme/dışa aktarma akışı hazırlanacak. Kullanıcının açık talebiyle test için GitHub Pages workflow’u da sağlanacak; kaynak kodu public olmasına onay verildi. iPhone’da kurulum ve koşu testi ayrıca yapılacak; ekran kilitliyken GPS takibi kapsam dışı kalacak. PC’nin ağ erişimi ve Telegram bot bilgileri kurulum aşamasında güvenli biçimde kullanıcıdan alınacak.
