/*
 * Node ile eşleştirme testi:  node test/simule_test.js
 * Rota boyunca sanal bir araç sürer ve 219 adımın tamamının sırayla,
 * atlanmadan ve yanlış adıma sıçramadan ilerlediğini doğrular.
 */
var fs = require('fs');
var path = require('path');
var Rota = require(path.join(__dirname, '..', 'rota.js'));

var veri = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'veri', 'rota_adimlari.json'), 'utf8'));
var rota = Rota.rotaKur(veri);

function rasgele(tohum) {           // tekrarlanabilir gürültü
  var s = tohum;
  return function () {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Rota üzerinde toplam mesafeye karşılık gelen konumu üretir. */
function rotadaKonum(m) {
  var t = 0;
  for (var i = 0; i < rota.adimlar.length; i++) {
    var a = rota.adimlar[i];
    if (m <= a.baslangicM + a.uzunluk || i === rota.adimlar.length - 1) {
      var yerel = Math.min(Math.max(0, m - a.baslangicM), a.uzunluk);
      for (var j = 0; j < a.parcaUzunluk.length; j++) {
        if (yerel <= a.kum[j + 1] || j === a.parcaUzunluk.length - 1) {
          var oran = a.parcaUzunluk[j] > 0 ? (yerel - a.kum[j]) / a.parcaUzunluk[j] : 0;
          oran = Math.min(Math.max(0, oran), 1);
          var x = a.xy[j][0] + (a.xy[j + 1][0] - a.xy[j][0]) * oran;
          var y = a.xy[j][1] + (a.xy[j + 1][1] - a.xy[j][1]) * oran;
          var ll = rota.proj.latlon(x, y);
          return { lat: ll[0], lon: ll[1], yon: a.parcaYon[j], adimIndex: i };
        }
      }
    }
  }
  return null;
}

function kosu(opts) {
  var ad = opts.ad;
  var adimM = opts.adimM;            // her tik'te ilerlenen mesafe (m)
  var gurultuM = opts.gurultuM || 0; // yanal + boyuna GPS gürültüsü
  var heading = opts.heading;        // 'gps' | 'yok'
  var dogruluk = opts.dogruluk || 6;

  var t = new Rota.Takipci(rota);
  var rnd = rasgele(opts.tohum || 12345);

  var gorulen = [];
  var oncekiIndex = -1;
  var zaman = 0;
  var sicrama = [];
  var beklenen = 1;      // tamamlanması beklenen sıradaki adım no
  var sirasiz = [];      // sıra dışı tamamlanan adımlar

  for (var m = 0; m <= rota.toplamM + 20; m += adimM) {
    var k = rotadaKonum(Math.min(m, rota.toplamM));
    var lat = k.lat, lon = k.lon;
    if (gurultuM > 0) {
      var dx = (rnd() - 0.5) * 2 * gurultuM;
      var dy = (rnd() - 0.5) * 2 * gurultuM;
      var p = rota.proj.xy(lat, lon);
      var ll = rota.proj.latlon(p[0] + dx, p[1] + dy);
      lat = ll[0]; lon = ll[1];
    }
    zaman += (adimM / 8) * 1000;
    var r = t.konumGuncelle({
      lat: lat, lon: lon,
      heading: heading === 'gps' ? k.yon : undefined,
      speed: heading === 'gps' ? 8 : undefined,
      accuracy: dogruluk,
      t: zaman
    });
    // Tamamlanan adımlar sırayla ve eksiksiz raporlanmalı
    r.ilerletilenAdimlar.forEach(function (no) {
      if (no !== beklenen) sirasiz.push('beklenen ' + beklenen + ', gelen ' + no);
      beklenen = no + 1;
    });
    if (t.adimIndex !== oncekiIndex) {
      if (oncekiIndex >= 0 && t.adimIndex !== oncekiIndex + 1) {
        sicrama.push((oncekiIndex + 1) + ' -> ' + (t.adimIndex + 1));
      }
      gorulen.push(t.adimIndex);
      oncekiIndex = t.adimIndex;
    }
  }

  // beklenen = 219 demek: 1..218 tamamlandı ve 219. adımda duruluyor
  var tamamlandi = (beklenen === rota.adimlar.length) && t.bitti;
  var ekrandaGorunmeyen = rota.adimlar.length - gorulen.length;
  var basarili = tamamlandi && sirasiz.length === 0;

  console.log(
    (basarili ? '  GECTI  ' : '  KALDI  ') + ad +
    ' | tamamlanan: ' + (beklenen - 1) + '/' + (rota.adimlar.length - 1) +
    ' | sirasiz: ' + sirasiz.length +
    ' | ekranda gorunmeyen: ' + ekrandaGorunmeyen +
    ' | bitti: ' + t.bitti
  );
  if (sirasiz.length) console.log('      sirasiz: ' + sirasiz.slice(0, 10).join(' , '));
  if (sicrama.length) console.log('      ekranda atlanan gecisler: ' + sicrama.slice(0, 8).join(' , '));
  return basarili;
}

console.log('Rota: ' + rota.adimlar.length + ' adim, ' +
  (rota.toplamM / 1000).toFixed(2) + ' km, ' + rota.manevralar.length + ' manevra');
console.log('En kisa adim: ' + Math.min.apply(null, rota.adimlar.map(function (a) { return a.uzunluk; })).toFixed(1) + ' m');

var hepsi = 1;
hepsi &= kosu({ ad: '1x  (2 m/tik, gurultusuz, GPS yonu)     ', adimM: 2, heading: 'gps' });
hepsi &= kosu({ ad: '5x  (7 m/tik, gurultusuz, GPS yonu)     ', adimM: 7, heading: 'gps' });
hepsi &= kosu({ ad: '20x (14 m/tik, gurultusuz, GPS yonu)    ', adimM: 14, heading: 'gps' });
hepsi &= kosu({ ad: '1x  (2 m/tik, heading yok - hesaplanan) ', adimM: 2, heading: 'yok' });
hepsi &= kosu({ ad: 'gercekci (5 m/tik, 6 m gurultu, heading)', adimM: 5, gurultuM: 6, heading: 'gps', tohum: 777 });
hepsi &= kosu({ ad: 'kotu GPS (5 m/tik, 12 m gurultu)        ', adimM: 5, gurultuM: 12, heading: 'gps', tohum: 4242 });
hepsi &= kosu({ ad: 'heading yok + gurultu (3 m/tik, 6 m)    ', adimM: 3, gurultuM: 6, heading: 'yok', tohum: 99 });

/* Rota disi testi: ortada 60 m yana sap, sonra geri don */
(function rotaDisiTesti() {
  var t = new Rota.Takipci(rota);
  var zaman = 0, m = 0;
  while (m < 3000) { m += 5; zaman += 600; var k = rotadaKonum(m); t.konumGuncelle({ lat: k.lat, lon: k.lon, heading: k.yon, speed: 8, accuracy: 5, t: zaman }); }
  var kaydedilenAdim = t.adimIndex;
  var kk = rotadaKonum(m);
  var p = rota.proj.xy(kk.lat, kk.lon);
  var sapti = false;
  for (var s = 0; s < 30; s++) {
    zaman += 1000;
    var ll = rota.proj.latlon(p[0] + 80, p[1] + 40);
    t.konumGuncelle({ lat: ll[0], lon: ll[1], accuracy: 5, t: zaman });
    if (t.rotaDisi) sapti = true;
  }
  var hedef = t.donusHedefi(rota.proj.latlon(p[0] + 80, p[1] + 40)[0], rota.proj.latlon(p[0] + 80, p[1] + 40)[1]);
  // geri don
  for (var s2 = 0; s2 < 10; s2++) { zaman += 1000; t.konumGuncelle({ lat: kk.lat, lon: kk.lon, heading: kk.yon, speed: 8, accuracy: 5, t: zaman }); }
  var iyilesti = !t.rotaDisi && t.adimIndex === kaydedilenAdim;
  console.log((sapti && iyilesti && hedef ? '  GECTI  ' : '  KALDI  ') +
    'rota disi: uyari=' + sapti + ', donus hedefi=' + (hedef ? ('adim ' + (hedef.adimIndex + 1) + ' / ' + hedef.uzaklik.toFixed(0) + ' m') : 'yok') +
    ', rotaya donunce ayni adim=' + iyilesti);
  hepsi &= !!(sapti && iyilesti && hedef);
})();

/* Zayif GPS testi: accuracy 50 iken ilerletme olmamali */
(function zayifTest() {
  var t = new Rota.Takipci(rota);
  var zaman = 0;
  for (var m = 0; m < 600; m += 5) {
    zaman += 600;
    var k = rotadaKonum(m);
    t.konumGuncelle({ lat: k.lat, lon: k.lon, heading: k.yon, speed: 8, accuracy: 50, t: zaman });
  }
  var ok = t.adimIndex === 0;
  console.log((ok ? '  GECTI  ' : '  KALDI  ') + 'zayif GPS (accuracy 50): adim ilerlemedi = ' + ok + ' (adim ' + (t.adimIndex + 1) + ')');
  hepsi &= ok;
})();

/* Geri don testi: geri_don manevrasinda arac donmeden ilerletme olmamali */
(function geriDonTesti() {
  var hedefManevra = rota.manevralar.filter(function (x) { return x.manevra === 'geri_don'; })[0];
  var hedefIndex = rota.adimlar.findIndex(function (a) { return a.no === hedefManevra.adim; });
  var oncekiAdim = rota.adimlar[hedefIndex - 1];
  var t = new Rota.Takipci(rota);
  t.adimaGit(hedefIndex - 1);
  var zaman = 0;
  // cikmaz sokagin sonuna kadar git
  var son = oncekiAdim.baslangicM + oncekiAdim.uzunluk;
  for (var m = oncekiAdim.baslangicM; m <= son; m += 3) {
    zaman += 500;
    var k = rotadaKonum(m);
    t.konumGuncelle({ lat: k.lat, lon: k.lon, heading: oncekiAdim.cikisYon, speed: 5, accuracy: 5, t: zaman });
  }
  var donmedenIndex = t.adimIndex;
  // simdi arac donuyor (yon tersine)
  for (var s = 0; s < 6; s++) {
    zaman += 500;
    var k2 = rotadaKonum(son + s * 3 > son ? son : son);
    t.konumGuncelle({ lat: k2.lat, lon: k2.lon, heading: rota.adimlar[hedefIndex].girisYon, speed: 5, accuracy: 5, t: zaman });
  }
  var ok = donmedenIndex === hedefIndex - 1 && t.adimIndex === hedefIndex;
  console.log((ok ? '  GECTI  ' : '  KALDI  ') + 'geri_don (adim ' + rota.adimlar[hedefIndex].no + '): donmeden ilerlemedi=' +
    (donmedenIndex === hedefIndex - 1) + ', dondukten sonra ilerledi=' + (t.adimIndex === hedefIndex));
  hepsi &= ok;
})();

console.log(hepsi ? '\nTUM TESTLER GECTI' : '\nBAZI TESTLER KALDI');
process.exit(hepsi ? 0 : 1);
