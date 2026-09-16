/* =========================================================
 * Service worker — çevrimdışı çalışma
 *
 * İki önbellek kullanılır:
 *   1. UYGULAMA : uygulama dosyaları ve rota verisi (kurulumda indirilir)
 *   2. KARO     : gezilen harita karoları (kullandıkça birikir, sınırlı)
 *
 * Uygulama dosyalarında değişiklik yaptığınızda SURUM'u artırın;
 * tarayıcı eski önbelleği silip yenisini indirir.
 * ========================================================= */

var SURUM = 'su-rotasi-v2';
var UYGULAMA_ONBELLEK = SURUM + '-uygulama';
var KARO_ONBELLEK = SURUM + '-karo';
var KARO_SINIRI = 1200;   // yaklaşık 20-30 MB

var DOSYALAR = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './rota.js',
  './manifest.json',
  './veri/rota_adimlari.json',
  './vendor/leaflet.js',
  './vendor/leaflet.css',
  './gorseller/ikon-192.png',
  './gorseller/ikon-512.png',
  './gorseller/ikon-maskable-512.png'
];

self.addEventListener('install', function (olay) {
  olay.waitUntil(
    caches.open(UYGULAMA_ONBELLEK).then(function (onbellek) {
      // Tek tek ekle: bir dosya eksikse kurulumun tamamı çökmesin
      return Promise.all(DOSYALAR.map(function (u) {
        return onbellek.add(new Request(u, { cache: 'reload' })).catch(function () { });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (olay) {
  olay.waitUntil(
    caches.keys().then(function (adlar) {
      return Promise.all(adlar.map(function (ad) {
        if (ad !== UYGULAMA_ONBELLEK && ad !== KARO_ONBELLEK) return caches.delete(ad);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function karoMu(url) {
  return /tile\.openstreetmap\.org/.test(url) || /\.(png|jpg|jpeg|webp)$/.test(url) && /\/\d+\/\d+\/\d+\./.test(url);
}

/** Önbellek çok büyürse en eskileri at. */
function karoBudama() {
  caches.open(KARO_ONBELLEK).then(function (onbellek) {
    onbellek.keys().then(function (anahtarlar) {
      if (anahtarlar.length <= KARO_SINIRI) return;
      var silinecek = anahtarlar.slice(0, anahtarlar.length - KARO_SINIRI);
      silinecek.forEach(function (a) { onbellek.delete(a); });
    });
  });
}

self.addEventListener('fetch', function (olay) {
  var istek = olay.request;
  if (istek.method !== 'GET') return;

  var url = istek.url;

  /* --- Harita karoları: önce ağ, olmazsa önbellek --- */
  if (karoMu(url)) {
    olay.respondWith(
      fetch(istek).then(function (cevap) {
        if (cevap && (cevap.ok || cevap.type === 'opaque')) {
          var kopya = cevap.clone();
          caches.open(KARO_ONBELLEK).then(function (onbellek) {
            onbellek.put(istek, kopya);
            karoBudama();
          });
        }
        return cevap;
      }).catch(function () {
        return caches.match(istek).then(function (c) {
          return c || new Response('', { status: 504, statusText: 'Karo yok' });
        });
      })
    );
    return;
  }

  /* --- Uygulama dosyaları: önce önbellek, arkada tazele --- */
  olay.respondWith(
    caches.match(istek).then(function (onbellekten) {
      var agdan = fetch(istek).then(function (cevap) {
        if (cevap && cevap.ok && cevap.type === 'basic') {
          var kopya = cevap.clone();
          caches.open(UYGULAMA_ONBELLEK).then(function (o) { o.put(istek, kopya); });
        }
        return cevap;
      }).catch(function () {
        // Çevrimdışı: gezinme isteklerinde ana sayfayı ver
        if (istek.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504 });
      });
      return onbellekten || agdan;
    })
  );
});
