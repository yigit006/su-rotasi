/*
 * Tarayıcı testi (Playwright):  node test/tarayici_test.js
 * Uygulamayı gerçek bir tarayıcıda açar, simülasyonu 20x çalıştırır ve
 * 219 adımın tamamının sırayla geçildiğini, hata olmadığını doğrular.
 */
var { chromium } = require('playwright');
var http = require('http');
var fs = require('fs');
var path = require('path');

var KOK = path.join(__dirname, '..');
var TURLER = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.gpx': 'application/gpx+xml', '.geojson': 'application/json'
};

function sunucu(port) {
  return new Promise(function (coz) {
    var s = http.createServer(function (istek, cevap) {
      var yol = decodeURIComponent(istek.url.split('?')[0]);
      if (yol === '/') yol = '/index.html';
      var dosya = path.join(KOK, yol);
      if (!dosya.startsWith(KOK) || !fs.existsSync(dosya) || fs.statSync(dosya).isDirectory()) {
        cevap.writeHead(404); cevap.end('yok'); return;
      }
      cevap.writeHead(200, { 'Content-Type': TURLER[path.extname(dosya)] || 'application/octet-stream' });
      fs.createReadStream(dosya).pipe(cevap);
    });
    s.listen(port, function () { coz(s); });
  });
}

(async function () {
  var port = 8231;
  var s = await sunucu(port);
  var tarayici = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  var sayfa = await tarayici.newPage({ viewport: { width: 412, height: 915 } });

  var hatalar = [];
  var konusulan = [];
  sayfa.on('pageerror', function (e) { hatalar.push('pageerror: ' + e.message); });
  sayfa.on('console', function (m) {
    // Karo istekleri bilerek engellendi; onların hatalarını sayma
    if (m.type() === 'error' && !/Karo yok|ERR_FAILED|tile\.openstreetmap/.test(m.text())) {
      hatalar.push('console: ' + m.text());
    }
  });

  // Harita karolarını engelle (çevrimdışı davranışı da test edilir)
  await sayfa.route('**tile.openstreetmap.org**', function (r) { r.abort(); });

  // speechSynthesis'i yakala
  // window.speechSynthesis salt okunur bir getter — defineProperty şart
  await sayfa.addInitScript(function () {
    window.__konusulan = [];
    var sahte = {
      speaking: false, paused: false, pending: false,
      getVoices: function () { return [{ lang: 'tr-TR', name: 'Test TR' }]; },
      speak: function (u) {
        if (String(u.text).trim()) window.__konusulan.push(u.text);
        if (u.onend) setTimeout(u.onend, 1);
      },
      cancel: function () { }, resume: function () { }, pause: function () { },
      addEventListener: function () { }
    };
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true, get: function () { return sahte; }
    });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true, writable: true,
      value: function (t) { this.text = t; }
    });

    // Adım sayacındaki HER değişimi kaçırmadan kaydet (örnekleme yerine gözlem)
    window.__adimIzi = [];
    document.addEventListener('DOMContentLoaded', function () {
      var el = document.getElementById('adimYazi');
      var oku = function () {
        var m = /Adım (\d+)/.exec(el.textContent);
        if (!m) return;
        var n = +m[1];
        var iz = window.__adimIzi;
        if (!iz.length || iz[iz.length - 1] !== n) iz.push(n);
      };
      oku();
      new MutationObserver(oku).observe(el, { childList: true, characterData: true, subtree: true });
    });
  });

  await sayfa.goto('http://localhost:' + port + '/index.html');
  await sayfa.waitForFunction(function () {
    return document.getElementById('yukleme').style.display === 'none';
  }, null, { timeout: 15000 });
  console.log('  GECTI  uygulama yuklendi');

  var baslikMetni = await sayfa.textContent('#adimYazi');
  console.log('         baslangic: ' + baslikMetni);

  // 20x simülasyonu başlat
  await sayfa.click('#btnMenu');
  await sayfa.click('[data-sim="20"]');
  await sayfa.click('#btnBaslat');

  // Adım ilerlemesini izle
  var sonAdim = 0, sicrama = [], bekleme = 0;
  while (bekleme < 1400) {
    var d = await sayfa.evaluate(function () {
      var m = /Adım (\d+)/.exec(document.getElementById('adimYazi').textContent);
      return {
        adim: m ? +m[1] : 0,
        bitti: document.getElementById('talimat').textContent.indexOf('tamamland') >= 0,
        konusulan: window.__konusulan.length
      };
    });
    if (d.adim >= sonAdim) sonAdim = d.adim;
    if (d.bitti) break;
    await sayfa.waitForTimeout(120);
    bekleme++;
  }

  // MutationObserver'ın topladığı tam adım dizisini denetle
  var izDurum = await sayfa.evaluate(function () {
    var iz = window.__adimIzi || [];
    var bosluk = [], tekrar = 0;
    for (var i = 1; i < iz.length; i++) {
      if (iz[i] === iz[i - 1]) { tekrar++; continue; }
      if (iz[i] !== iz[i - 1] + 1) bosluk.push(iz[i - 1] + '->' + iz[i]);
    }
    return { uzunluk: iz.length, ilk: iz[0], son: iz[iz.length - 1], bosluk: bosluk };
  });
  sicrama = izDurum.bosluk;
  console.log('  ' + (sicrama.length === 0 ? 'GECTI' : 'KALDI') +
    '  ekranda gosterilen adim dizisi: ' + izDurum.ilk + '…' + izDurum.son +
    ' (' + izDurum.uzunluk + ' gecis, atlanan: ' + sicrama.length + ')');
  if (sicrama.length) console.log('         bosluklar: ' + sicrama.slice(0, 10).join(', '));

  var son = await sayfa.evaluate(function () {
    return {
      adimYazi: document.getElementById('adimYazi').textContent,
      km: document.getElementById('kmYazi').textContent,
      talimat: document.getElementById('talimat').textContent,
      konusulan: window.__konusulan.slice(0, 6),
      konusmaSayisi: window.__konusulan.length,
      haritaRozet: !document.getElementById('haritaRozet').hidden,
      ilerleme: document.getElementById('ilerlemeDolgu').style.width
    };
  });

  console.log('  ' + (sonAdim === 219 ? 'GECTI' : 'KALDI') + '  simulasyon sonu: ' + son.adimYazi + ' | ' + son.km);
  console.log('         talimat: "' + son.talimat + '" | ilerleme: ' + son.ilerleme);
  console.log('         seslendirme sayisi: ' + son.konusmaSayisi);
  console.log('         ilk anonslar: ' + JSON.stringify(son.konusulan, null, 0));
  console.log('  ' + (son.haritaRozet ? 'GECTI' : 'KALDI') + '  karolar engelliyken "Harita cevrimdisi" rozeti gorunuyor');

  // Yeniden yükleme: kaldığı adımdan devam
  await sayfa.reload();
  await sayfa.waitForFunction(function () {
    return document.getElementById('yukleme').style.display === 'none';
  }, null, { timeout: 15000 });
  var devam = await sayfa.textContent('#adimYazi');
  console.log('  ' + (devam === son.adimYazi ? 'GECTI' : 'KALDI') + '  yeniden acilista devam: ' + devam);

  // Ekran görüntüsü
  await sayfa.screenshot({ path: path.join(__dirname, 'ekran.png') });

  // Orta noktadan ekran görüntüsü (manevra okunu görmek için)
  await sayfa.evaluate(function () {
    try { localStorage.clear(); } catch (e) { }
  });
  await sayfa.reload();
  await sayfa.waitForFunction(function () {
    return document.getElementById('yukleme').style.display === 'none';
  }, null, { timeout: 15000 });
  await sayfa.click('#btnMenu');
  await sayfa.click('[data-sim="5"]');
  await sayfa.click('#btnBaslat');
  await sayfa.waitForTimeout(4000);
  await sayfa.screenshot({ path: path.join(__dirname, 'ekran-surus.png') });

  var okIcerik = await sayfa.innerHTML('#ok');
  console.log('  ' + (okIcerik.indexOf('polygon') >= 0 ? 'GECTI' : 'KALDI') + '  manevra oku ciziliyor');

  await tarayici.close();
  s.close();

  console.log('\nHatalar: ' + (hatalar.length ? '\n  ' + hatalar.join('\n  ') : 'yok'));
  var basarili = sonAdim === 219 && hatalar.length === 0 && sicrama.length === 0;
  console.log(basarili ? '\nTARAYICI TESTI GECTI' : '\nTARAYICI TESTI KALDI' +
    (sicrama.length ? ' (ekranda sicrama: ' + sicrama.join(', ') + ')' : ''));
  process.exit(basarili ? 0 : 1);
})();
