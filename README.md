# Su Rotası — Muttalip pazar su dağıtım rotası

Su dağıtım aracı için **sesli ve büyük ekranlı** rota takip uygulaması.
Tek bir statik site (PWA); derleme aracı gerektirmez, GitHub Pages'te yayınlanır,
Android telefonda "Ana ekrana ekle" ile uygulama gibi açılır ve **internet
olmadan da** çalışır.

Rota hazır veri olarak kullanılır: **219 adım, ~14,98 km, 214 manevra.**
Uygulama rotayı yeniden hesaplamaz.

---

## 1. Dosyalar

```
index.html      Ekran düzeni
style.css       Görünüm (büyük yazı, yüksek kontrast)
rota.js         Rota geometrisi ve konum eşleştirme çekirdeği (arayüzden bağımsız)
app.js          Arayüz, harita, GPS, ses, simülasyon, notlar, GPX
sw.js           Service worker — çevrimdışı çalışma
manifest.json   Ana ekrana ekleme bilgileri
veri/
  rota_adimlari.json   Rotanın kendisi (uygulamanın tek veri kaynağı)
gorseller/
  ikon-192.png, ikon-512.png, ikon-maskable-512.png   (geçici ikonlar)
vendor/
  leaflet.js, leaflet.css, images/   Harita kütüphanesi (yerel kopya)
test/
  simule_test.js    Eşleştirme çekirdeği testi (Node ile)
  tarayici_test.js  Gerçek tarayıcıda uçtan uca test (Playwright ile)
```

---

## 2. GitHub Pages'te yayınlama (adım adım)

1. GitHub'da yeni bir depo aç: **Repositories → New**.
   Ad olarak örneğin `su-rotasi` yaz, **Public** seç, "Add a README" işaretini
   **kaldır**, **Create repository** de.

2. Bu klasördeki **bütün dosyaları** depoya yükle.
   En kolay yol: depo sayfasında **Add file → Upload files**, sonra bu klasörün
   içindeki dosya ve klasörleri sürükle bırak, **Commit changes** de.
   (Klasör yapısı bozulmamalı: `veri/`, `gorseller/`, `vendor/` alt klasör kalsın.)

   Git ile yapmak istersen:
   ```bash
   cd su-rotasi
   git init
   git add .
   git commit -m "Su rotası uygulaması"
   git branch -M main
   git remote add origin https://github.com/KULLANICI_ADIN/su-rotasi.git
   git push -u origin main
   ```

3. Depoda **Settings → Pages** sekmesine gir.
   **Source** olarak **Deploy from a branch**, **Branch** olarak **main** ve
   klasör olarak **/ (root)** seç, **Save** de.

4. Bir iki dakika sonra aynı sayfada adres görünür:
   `https://KULLANICI_ADIN.github.io/su-rotasi/`
   Konum izni için HTTPS şart olduğundan bu adres üzerinden açılmalı
   (bilgisayarda dosyaya çift tıklayarak açmak **çalışmaz**).

5. **Telefona kurmak:** Android'de Chrome ile bu adresi aç →
   sağ üstteki üç nokta → **Ana ekrana ekle**. Artık simge tam ekran açılır.

6. **Konum izni:** uygulama ilk kez BAŞLAT'a basıldığında konum ister.
   "İzin ver"i seçin. İzin yanlışlıkla reddedilirse:
   Chrome → adres çubuğundaki kilit → **İzinler → Konum → İzin ver**.

7. **Sesi test edin:** telefonda Türkçe konuşma motoru kurulu olmalı.
   Ayarlar → Erişilebilirlik → Metin okuma çıkışı → dil **Türkçe**.

### Dosyaları güncelleyince

`sw.js` içindeki `SURUM` değerini (`su-rotasi-v1` → `su-rotasi-v2`) artırın ve
yükleyin. Telefon eski sürümü önbellekten silip yenisini indirir.

---

## 3. Kullanım

### Ana ekran

| Bölüm | Ne gösterir |
|---|---|
| Üst bant | Sıradaki manevranın büyük oku, kalan mesafe, talimat metni |
| Rozet | **SU DAĞIT** (sarı) veya **SADECE GEÇİŞ** (gri) — adımın türü |
| Sağ üst | GPS durumu: GPS / GPS ZAYIF / GPS BEKLENİYOR / SİM |
| Harita | Araç ve yönü; geçilen rota soluk, şu anki adım kalın, sonraki 3 adım mavi |
| Alt bant | İlerleme çubuğu, "Adım 57 / 219", "6,1 / 14,98 km" |

### Butonlar

- **BAŞLAT / DURAKLAT** — takibi başlatır, ekranı açık tutar, sesi açar.
- **◀ GERİ / İLERİ ▶** — GPS yanılırsa adımı elle düzeltmek için.
- **✎ NOT DÜŞ** — tek dokunuşla "burada sorun var" kaydı (konum + adım + saat).
- **🔊 SES** — sesi açıp kapatır.
- **☰ MENÜ** — simülasyon, notlar, GPX, sıfırlama, başlangıca yol tarifi.
- Haritadaki **⇧ / N** — yön yukarı ↔ kuzey yukarı.

### Simülasyon (evde test)

MENÜ → Simülasyon → **1x / 5x / 20x** → KAPAT → **BAŞLAT**.
GPS olmadan araç rotada ilerler, sesli komutlar da çalışır.
Gerçek sürüşe dönmek için Simülasyon → **KAPALI** seçin.

### Kaldığı yerden devam

İlerleme telefonda saklanır. Uygulama kapanıp açılınca aynı adımdan devam eder.
Yeni pazar için: MENÜ → **İLERLEMEYİ SIFIRLA** (onay sorar).

### Sürüş kaydı

Gerçek sürülen iz kaydedilir. MENÜ → **GPX OLARAK PAYLAŞ / İNDİR** ile
Android paylaşım menüsünden gönderilir veya dosya olarak iner.
Notlar da GPX içine işaret noktası (waypoint) olarak eklenir.

---

## 4. Rota eşleştirme nasıl çalışıyor

Rota kendi üstünden defalarca geçtiği için "konumu rotanın en yakın noktasına
bağlamak" yanlış sonuç verir. Bunun yerine (`rota.js`):

- Eşleştirme **yalnızca şu anki adım ve sonraki 5 adım** (en çok 400 m) içinde yapılır.
- Aracın **gidiş yönü** kullanılır: GPS `heading` güvenilir değilse son
  konumlardan hesaplanır (en az 15 m yer değişimi, yumuşatmalı).
  Adımın yönüyle **90°'den fazla** fark varsa o adıma eşleşme yapılmaz.
- Adım, sonuna **~15 m** kala ve bir sonraki adıma geçilince ilerler; adımlar
  **teker teker** ilerletilir, hiçbiri atlanmaz.
- **GPS doğruluğu 30 m'den kötüyse** ilerletme yapılmaz.
- **Çıkmaz sokak (`geri_don`)**: araç dönene kadar ilerletilmez. Dönüş yönden
  anlaşılır — araç ters yöne döndüğünde o adım yön filtresini geçemez ve
  uygulama dönüş adımına geçer.
- Yön tahmini üst üste tutmazsa (çok gürültülü GPS) yön filtresi geçici olarak
  devre dışı kalır, böylece uygulama takılıp kalmaz.

### Sesli yönlendirme

- Her manevra yaklaşırken iki kez söylenir: **~150 m kala** ("150 metre sonra
  sağa dönün") ve **~30 m kala** ("Sağa dönün").
  Adım kısaysa (manevraya girerken zaten 170 m'den yakınsa) sadece yakın olan söylenir.
- `duz_devam` manevralarında uzak anons yapılmaz ve **aynı cümle art arda
  tekrarlanmaz** (içinde "su dağıtmaya başlayın/bırakın" varsa her zaman söylenir).
- Rotadan çıkılınca ("şu anki adımdan 35 m'den uzak, 10 saniyeden fazla"):
  **"Rotadan çıktınız"** denir, ekranda rotaya dönülecek en yakın ileri nokta
  mesafe ve yönüyle gösterilir. **Otomatik yeniden rota hesaplama yapılmaz.**
- Rota bitince **"Rota tamamlandı"** denir.

---

## 5. Çevrimdışı çalışma

Service worker kurulumda uygulama dosyalarını ve `veri/rota_adimlari.json`
dosyasını indirir. Harita karoları (OpenStreetMap) gezildikçe önbelleğe alınır
(en çok ~1200 karo). İnternet yokken:

- rota çizgisi, araç konumu, adım takibi ve sesli komutlar **çalışır**;
- harita arka planı yoksa sol üstte **"Harita çevrimdışı"** yazar.

Evde bir kez uygulamayı açıp simülasyonu çalıştırmak, mahallenin karolarının
önbelleğe alınmasına yardımcı olur.

---

## 6. Görseller

Kendi ikonlarınızı `gorseller/` klasörüne şu adlarla koyabilirsiniz:

- `ikon-192.png` (192×192)
- `ikon-512.png` (512×512)
- `ikon-maskable-512.png` (512×512, kenarlarda boşluk bırakan tasarım)

Klasördeki dosyalar geçici olarak üretilmiştir; üzerine yazmanız yeterli.

---

## 7. Testler (isteğe bağlı, geliştirme için)

```bash
node test/simule_test.js      # eşleştirme çekirdeği (Node yeter)
npm install playwright        # tarayıcı testi için bir kez
node test/tarayici_test.js    # uçtan uca: 219 adım, ses, çevrimdışı, devam etme
```

`simule_test.js` rotayı farklı hızlarda, GPS gürültüsüyle, heading olmadan ve
kötü sinyalle sürer; 219 adımın sırayla ve atlanmadan tamamlandığını,
çıkmaz sokakta erken ilerlemediğini ve rotadan çıkışın algılandığını doğrular.

---

## 8. Bilinen sınırlar

- Mahalle içi tek yön bilgisi sahada doğrulanmamıştır (veri dosyasının notu).
- OpenStreetMap'te sokak isimleri çoğunlukla yok; sesli komutlarda sokak adı
  kullanılmaz.
- Rota değişirse yalnızca `veri/rota_adimlari.json` değiştirilir; kod içinde
  gömülü rota yoktur. (Dosya değişince kaydedilmiş ilerleme otomatik sıfırlanır.)

Harita verisi © OpenStreetMap katkıcıları. Leaflet BSD-2-Clause lisanslıdır
(`vendor/LEAFLET-LICENSE.txt`).
