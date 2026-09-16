/* =========================================================
 * Su Rotası — sürüş ekranı uygulaması
 *
 * Bölümler:
 *   1. Yardımcılar ve kalıcı depo (localStorage)
 *   2. Sesli yönlendirme
 *   3. Manevra okları (SVG)
 *   4. Harita
 *   5. Konum kaynakları (GPS ve simülasyon)
 *   6. Ana döngü ve arayüz
 *   7. Notlar, sürüş kaydı (GPX) ve menü
 *   8. Başlangıç
 * ========================================================= */
(function () {
  'use strict';

  /* =======================================================
     1. YARDIMCILAR VE DEPO
     ======================================================= */

  var $ = function (id) { return document.getElementById(id); };

  var DEPO_ONEK = 'suRotasi.';
  var Depo = {
    yaz: function (anahtar, deger) {
      try { localStorage.setItem(DEPO_ONEK + anahtar, JSON.stringify(deger)); return true; }
      catch (e) { return false; }
    },
    oku: function (anahtar, varsayilan) {
      try {
        var h = localStorage.getItem(DEPO_ONEK + anahtar);
        if (h === null || h === undefined) return varsayilan;
        return JSON.parse(h);
      } catch (e) { return varsayilan; }
    },
    sil: function (anahtar) {
      try { localStorage.removeItem(DEPO_ONEK + anahtar); } catch (e) { /* yoksay */ }
    }
  };

  function sayiTr(sayi, basamak) {
    return sayi.toFixed(basamak === undefined ? 1 : basamak).replace('.', ',');
  }

  function bicimMesafe(m) {
    if (m === null || m === undefined || !isFinite(m)) return '—';
    if (m >= 1000) return sayiTr(m / 1000, 1) + ' km';
    if (m >= 100) return Math.round(m / 10) * 10 + ' m';
    if (m >= 20) return Math.round(m / 5) * 5 + ' m';
    return Math.max(0, Math.round(m)) + ' m';
  }

  function saatBicim(zamanDamgasi) {
    var d = new Date(zamanDamgasi);
    var iki = function (n) { return (n < 10 ? '0' : '') + n; };
    return iki(d.getHours()) + ':' + iki(d.getMinutes());
  }

  var bildirimZaman = null;
  function bildir(metin, sure) {
    var el = $('bildirim');
    el.textContent = metin;
    el.hidden = false;
    if (bildirimZaman) clearTimeout(bildirimZaman);
    bildirimZaman = setTimeout(function () { el.hidden = true; }, sure || 2600);
  }

  var onayGeriCagri = null;
  function onaySor(metin, geriCagri) {
    $('onayMetin').textContent = metin;
    onayGeriCagri = geriCagri;
    $('onay').hidden = false;
  }

  /* =======================================================
     2. SESLİ YÖNLENDİRME
     ======================================================= */

  var Ses = {
    acik: true,
    hazir: false,
    kuyruk: [],
    aktif: false,
    sesi: null,
    destek: (typeof window.speechSynthesis !== 'undefined'),

    sesleriYukle: function () {
      if (!this.destek) return;
      try {
        var liste = window.speechSynthesis.getVoices() || [];
        for (var i = 0; i < liste.length; i++) {
          if (/^tr/i.test(liste[i].lang)) { this.sesi = liste[i]; return; }
        }
      } catch (e) { /* yoksay */ }
    },

    // Android Chrome sesi ilk kez ancak kullanıcı dokunuşuyla açar.
    kilidiAc: function () {
      if (!this.destek || this.hazir) return;
      try {
        var u = new SpeechSynthesisUtterance(' ');
        u.lang = 'tr-TR'; u.volume = 0;
        window.speechSynthesis.speak(u);
        this.hazir = true;
      } catch (e) { /* yoksay */ }
      this.sesleriYukle();
    },

    soyle: function (metin, acil) {
      if (!this.acik || !this.destek || !metin) return;
      if (acil) {
        this.kuyruk.length = 0;
        try { window.speechSynthesis.cancel(); } catch (e) { /* yoksay */ }
        this.aktif = false;
      }
      // Hızlı simülasyonda kuyruğun şişmesini engelle
      while (this.kuyruk.length > 2) this.kuyruk.shift();
      this.kuyruk.push(metin);
      this._isle();
    },

    _isle: function () {
      if (this.aktif || !this.kuyruk.length) return;
      var metin = this.kuyruk.shift();
      var self = this;
      try {
        if (!this.sesi) this.sesleriYukle();
        var u = new SpeechSynthesisUtterance(metin);
        u.lang = 'tr-TR';
        if (this.sesi) u.voice = this.sesi;
        u.rate = 1.0; u.pitch = 1.0; u.volume = 1.0;
        var bitti = function () {
          self.aktif = false;
          setTimeout(function () { self._isle(); }, 80);
        };
        u.onend = bitti;
        u.onerror = bitti;
        this.aktif = true;
        window.speechSynthesis.speak(u);
      } catch (e) {
        this.aktif = false;
      }
    },

    sustur: function () {
      this.kuyruk.length = 0;
      this.aktif = false;
      try { window.speechSynthesis.cancel(); } catch (e) { /* yoksay */ }
    }
  };

  // Chrome uzun süre sessiz kalınca konuşmayı askıya alabiliyor.
  setInterval(function () {
    if (!Ses.destek || !Ses.acik) return;
    try {
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    } catch (e) { /* yoksay */ }
  }, 5000);

  if (Ses.destek && typeof window.speechSynthesis.addEventListener === 'function') {
    window.speechSynthesis.addEventListener('voiceschanged', function () { Ses.sesleriYukle(); });
  }

  /* =======================================================
     3. MANEVRA OKLARI
     ======================================================= */

  function okSvg(tip) {
    var govde, bas, donus = '';
    switch (tip) {
      case 'saga_don':
        govde = 'M50,92 L50,58 Q50,42 66,42 L76,42'; bas = '74,22 74,62 98,42'; break;
      case 'sola_don':
        govde = 'M50,92 L50,58 Q50,42 34,42 L24,42'; bas = '26,22 26,62 2,42'; break;
      case 'geri_don':
        govde = 'M70,90 L70,50 A20,20 0 0 0 30,50 L30,58'; bas = '12,54 48,54 30,88'; break;
      case 'hafif_saga':
        donus = 'rotate(38 50 50)'; govde = 'M50,92 L50,38'; bas = '30,44 70,44 50,10'; break;
      case 'hafif_sola':
        donus = 'rotate(-38 50 50)'; govde = 'M50,92 L50,38'; bas = '30,44 70,44 50,10'; break;
      case 'bitis':
        govde = 'M50,92 L50,52'; bas = '26,52 74,52 50,14'; break;
      case 'tamamlandi':
        govde = 'M16,54 L40,78 L86,24'; bas = '40,78 40,78 40,78'; break;
      default: // duz_devam
        govde = 'M50,92 L50,38'; bas = '30,44 70,44 50,10';
    }
    return '<g transform="' + donus + '">' +
      '<path class="govde" d="' + govde + '"/>' +
      '<polygon class="bas" points="' + bas + '"/></g>';
  }

  /* =======================================================
     4. HARİTA
     ======================================================= */

  var Harita = {
    map: null,
    karo: null,
    hazir: false,
    gosterilenAci: 0,
    yonYukari: true,
    katman: {},
    okIsaretleri: [],
    donusCizgi: null,
    cevrimdisi: false,

    kur: function (rota) {
      var self = this;
      this.map = L.map('harita', {
        zoomControl: false, attributionControl: false,
        dragging: false, touchZoom: false, scrollWheelZoom: false,
        doubleClickZoom: false, boxZoom: false, keyboard: false,
        tap: false, inertia: false, zoomAnimation: true, fadeAnimation: false
      });
      this.map.setView([rota.baslangic[0], rota.baslangic[1]], 17);

      this.karo = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, minZoom: 13, crossOrigin: true, keepBuffer: 4,
        attribution: '© OpenStreetMap'
      });
      this.karo.on('tileerror', function () { self.cevrimdisiGoster(true); });
      this.karo.on('tileload', function () { self.cevrimdisiGoster(false); });
      this.karo.addTo(this.map);

      // Rota katmanları (üsttekiler sonra eklenir)
      var tum = [];
      rota.adimlar.forEach(function (a) {
        a.pts.forEach(function (p, i) { if (i || !tum.length) tum.push(p); });
      });
      this.katman.tum = L.polyline(tum, { color: '#39414f', weight: 5, opacity: 0.95 }).addTo(this.map);
      this.katman.kalan = L.polyline([], { color: '#8b97a9', weight: 5, opacity: 0.95 }).addTo(this.map);
      this.katman.sonraki = L.polyline([], { color: '#4ea3ff', weight: 8, opacity: 0.95 }).addTo(this.map);
      this.katman.suAnki = L.polyline([], { color: '#ffd11a', weight: 14, opacity: 1 }).addTo(this.map);

      this.hazir = true;
      setTimeout(function () { self.map.invalidateSize(); }, 120);
      window.addEventListener('resize', function () { self.map.invalidateSize(); });
      return this;
    },

    cevrimdisiGoster: function (durum) {
      if (this.cevrimdisi === durum) return;
      this.cevrimdisi = durum;
      $('haritaRozet').hidden = !durum;
    },

    /** Adım değiştiğinde rota katmanlarını yeniden çizer. */
    adimlariCiz: function (rota, index) {
      if (!this.hazir) return;
      var adimlar = rota.adimlar;

      this.katman.suAnki.setLatLngs(adimlar[index].pts);
      this.katman.suAnki.setStyle({
        color: adimlar[index].tur === 'dagit' ? '#ffd11a' : '#ffffff'
      });

      var sonraki = [];
      for (var k = 1; k <= 3; k++) {
        var a = adimlar[index + k];
        if (!a) break;
        a.pts.forEach(function (p, i) { if (i || !sonraki.length) sonraki.push(p); });
      }
      this.katman.sonraki.setLatLngs(sonraki);

      var kalan = [];
      for (var j = index; j < adimlar.length; j++) {
        adimlar[j].pts.forEach(function (p, i) { if (i || !kalan.length) kalan.push(p); });
      }
      this.katman.kalan.setLatLngs(kalan);

      this._oklariCiz(adimlar[index], adimlar[index + 1]);
    },

    _oklariCiz: function (adim, sonrakiAdim) {
      var self = this;
      this.okIsaretleri.forEach(function (m) { self.map.removeLayer(m); });
      this.okIsaretleri = [];

      var ekle = function (a, renk) {
        if (!a) return;
        for (var i = 0; i < a.pts.length - 1; i++) {
          if (a.parcaUzunluk[i] < 18) continue;
          var orta = [
            (a.pts[i][0] + a.pts[i + 1][0]) / 2,
            (a.pts[i][1] + a.pts[i + 1][1]) / 2
          ];
          var ikon = L.divIcon({
            className: 'rota-ok',
            html: '<div style="transform:rotate(' + (a.parcaYon[i] - 90) + 'deg);color:' + renk + '">&#10148;</div>',
            iconSize: [20, 20], iconAnchor: [10, 10]
          });
          self.okIsaretleri.push(L.marker(orta, { icon: ikon, interactive: false }).addTo(self.map));
        }
      };
      ekle(adim, '#0b0c0e');
      ekle(sonrakiAdim, '#0b2038');
    },

    /** Her konum güncellemesinde: merkez ve dönüş. */
    konumGuncelle: function (lat, lon, yon) {
      if (!this.hazir) return;
      this.map.setView([lat, lon], this.map.getZoom(), { animate: false });

      var hedefAci = (this.yonYukari && yon !== null && yon !== undefined) ? yon : 0;
      var fark = Rota.aciFarki(hedefAci, ((this.gosterilenAci % 360) + 360) % 360);
      this.gosterilenAci += fark;
      $('harita').style.transform = 'rotate(' + (-this.gosterilenAci) + 'deg)';

      var aracAci = (yon === null || yon === undefined) ? 0 : (yon - this.gosterilenAci);
      $('arac').style.transform = 'translate(-50%,-50%) rotate(' + aracAci + 'deg)';
    },

    donusCizgisiGoster: function (baslangic, bitis) {
      if (!this.hazir) return;
      if (!bitis) {
        if (this.donusCizgi) { this.map.removeLayer(this.donusCizgi); this.donusCizgi = null; }
        return;
      }
      if (!this.donusCizgi) {
        this.donusCizgi = L.polyline([], { color: '#ff4d4d', weight: 6, dashArray: '10 10' }).addTo(this.map);
      }
      this.donusCizgi.setLatLngs([baslangic, bitis]);
    }
  };

  /* =======================================================
     5. DURUM
     ======================================================= */

  var rota = null;
  var takipci = null;
  var calisiyor = false;
  var izleyiciId = null;
  var wakeLock = null;

  var sim = { hiz: 0, aktif: false, m: 0, sonKare: 0, id: null };
  var TABAN_HIZ_MS = 6.9;   // ~25 km/sa

  var soylenen = { uzak: {}, yakin: {} };
  var sonManevraMetni = '';
  var rotaDisiSoylendi = false;
  var bitisSoylendi = false;

  var notlar = [];
  var iz = [];
  var sonIzNokta = null;
  var kayitZamani = 0;

  var sonKonum = null;   // ham GPS/simülasyon konumu
  var gpsVar = false;

  /* =======================================================
     6. SES KARARLARI
     ======================================================= */

  function uzakMetin(metin, mesafe) {
    var yuvarlak = Math.max(50, Math.round(mesafe / 50) * 50);
    var parcalar = String(metin).split('. ');
    var ilk = parcalar[0].replace(/\.$/, '');
    var kalan = parcalar.slice(1).join('. ');
    var kucuk = ilk.charAt(0).toLocaleLowerCase('tr') + ilk.slice(1);
    var s = yuvarlak + ' metre sonra ' + kucuk;
    if (kalan) s += '. ' + kalan;
    return s;
  }

  function manevraSoyle(manevra, uzakMi, mesafe) {
    var metin = manevra.sesli_metin || '';
    // "Düz devam edin" cümlesini art arda tekrar etme
    // (içinde su dağıtma uyarısı varsa her zaman söylenir)
    if (manevra.manevra === 'duz_devam' &&
        metin === sonManevraMetni &&
        metin.indexOf('dağıt') === -1) {
      return;
    }
    Ses.soyle(uzakMi ? uzakMetin(metin, mesafe) : metin);
    sonManevraMetni = metin;
  }

  function sesKontrol(eskiIndex) {
    // a) Geçilen adımların manevraları söylenmediyse yetiş
    for (var e = eskiIndex + 1; e <= takipci.adimIndex; e++) {
      var adim = rota.adimlar[e];
      if (adim && adim.girisManevra && !soylenen.yakin[e]) {
        soylenen.yakin[e] = true;
        soylenen.uzak[e] = true;
        manevraSoyle(adim.girisManevra, false, 0);
      }
    }

    // b) Yaklaşılan manevra
    var sm = takipci.siradakiManevra();
    if (sm) {
      var i = sm.adimIndex;
      // Adıma yeni girildiyse ve manevra zaten yakınsa uzak anonsu atla
      if (soylenen.uzak[i] === undefined && sm.mesafe < 170) soylenen.uzak[i] = true;

      if (!soylenen.uzak[i] && sm.mesafe <= 150) {
        soylenen.uzak[i] = true;
        if (sm.manevra.manevra !== 'duz_devam') {
          manevraSoyle(sm.manevra, true, sm.mesafe);
        }
      }
      if (!soylenen.yakin[i] && sm.mesafe <= 30) {
        soylenen.yakin[i] = true;
        manevraSoyle(sm.manevra, false, sm.mesafe);
      }
    }

    // c) Rotadan çıkış
    if (takipci.rotaDisi && !rotaDisiSoylendi) {
      rotaDisiSoylendi = true;
      Ses.soyle('Rotadan çıktınız', true);
    } else if (!takipci.rotaDisi && rotaDisiSoylendi) {
      rotaDisiSoylendi = false;
      Ses.soyle('Rotaya döndünüz');
    }

    // d) Bitiş
    if (takipci.bitti && !bitisSoylendi) {
      bitisSoylendi = true;
      Ses.soyle('Rota tamamlandı', true);
      bildir('Rota tamamlandı 🎉', 6000);
      durdur();
    }
  }

  /* =======================================================
     7. ARAYÜZ
     ======================================================= */

  function arayuzGuncelle() {
    var adim = takipci.adim();

    // Rozet
    var rozet = $('rozet');
    if (adim.tur === 'dagit') {
      rozet.textContent = 'SU DAĞIT';
      rozet.className = 'rozet rozet-dagit';
    } else {
      rozet.textContent = 'SADECE GEÇİŞ';
      rozet.className = 'rozet rozet-gecis';
    }

    // Durum ikonu
    var ikon = $('durumIkon');
    if (sim.aktif) { ikon.textContent = '⏵ SİM ' + sim.hiz + 'x'; ikon.className = 'durum-ikon sim'; }
    else if (!calisiyor) { ikon.textContent = '● DURAKLADI'; ikon.className = 'durum-ikon'; }
    else if (!gpsVar) { ikon.textContent = '● GPS BEKLENİYOR'; ikon.className = 'durum-ikon yok'; }
    else if (takipci.zayifSinyal) { ikon.textContent = '● GPS ZAYIF'; ikon.className = 'durum-ikon zayif'; }
    else { ikon.textContent = '● GPS'; ikon.className = 'durum-ikon iyi'; }

    // Manevra
    var sm = takipci.siradakiManevra();
    var ok = $('ok');
    if (takipci.bitti) {
      ok.innerHTML = okSvg('tamamlandi');
      ok.setAttribute('class', 'yakin');
      $('mesafe').textContent = 'BİTTİ';
      $('talimat').textContent = 'Rota tamamlandı';
    } else if (sm) {
      ok.innerHTML = okSvg(sm.manevra.manevra);
      ok.setAttribute('class', sm.mesafe <= 60 ? 'yakin' : '');
      $('mesafe').textContent = bicimMesafe(sm.mesafe);
      $('talimat').textContent = sm.manevra.sesli_metin;
    } else {
      var kalanToplam = rota.toplamM - takipci.toplamMesafe();
      ok.innerHTML = okSvg('bitis');
      ok.setAttribute('class', '');
      $('mesafe').textContent = bicimMesafe(kalanToplam);
      $('talimat').textContent = 'Rota sonuna kadar düz devam edin';
    }

    // Uyarı bandı
    var uyari = $('uyariBant');
    if (takipci.rotaDisi && sonKonum) {
      var hedef = takipci.donusHedefi(sonKonum.lat, sonKonum.lon);
      if (hedef) {
        var yonFarki = takipci.yon === null ? null : Rota.aciFarki(hedef.yon, takipci.yon);
        var tarif = yonFarki === null ? '' :
          (Math.abs(yonFarki) < 30 ? ' — ileride' :
            (yonFarki > 0 ? ' — solda' : ' — sağda'));
        uyari.textContent = 'ROTADAN ÇIKTINIZ · ' + bicimMesafe(hedef.uzaklik) +
          tarif + ' (adım ' + rota.adimlar[hedefIndexGuvenli(hedef)].no + ')';
        Harita.donusCizgisiGoster([sonKonum.lat, sonKonum.lon], [hedef.lat, hedef.lon]);
      } else {
        uyari.textContent = 'ROTADAN ÇIKTINIZ';
      }
      uyari.className = '';
      uyari.hidden = false;
      $('arac').classList.add('rotaDisi');
    } else {
      uyari.hidden = true;
      $('arac').classList.remove('rotaDisi');
      Harita.donusCizgisiGoster(null, null);
    }

    // Alt bant
    var gidilen = takipci.toplamMesafe();
    var oran = Math.min(100, Math.max(0, (gidilen / rota.toplamM) * 100));
    $('ilerlemeDolgu').style.width = oran.toFixed(1) + '%';
    $('adimYazi').textContent = 'Adım ' + adim.no + ' / ' + rota.adimlar.length;
    $('kmYazi').textContent = sayiTr(gidilen / 1000, 1) + ' / ' + sayiTr(rota.toplamM / 1000, 1) + ' km';
  }

  function hedefIndexGuvenli(hedef) {
    return Math.min(Math.max(0, hedef.adimIndex), rota.adimlar.length - 1);
  }

  var sonCizilenAdim = -1;
  function haritaGuncelle() {
    if (takipci.adimIndex !== sonCizilenAdim) {
      sonCizilenAdim = takipci.adimIndex;
      Harita.adimlariCiz(rota, takipci.adimIndex);
    }
    if (sonKonum) Harita.konumGuncelle(sonKonum.lat, sonKonum.lon, takipci.yon);
  }

  /* =======================================================
     8. KONUM İŞLEME
     ======================================================= */

  function konumIsle(konum, kaynak) {
    var eskiIndex = takipci.adimIndex;
    sonKonum = konum;
    if (kaynak === 'gps') gpsVar = true;

    takipci.konumGuncelle(konum);
    sesKontrol(eskiIndex);

    if (kaynak === 'gps') izeEkle(konum);
    arayuzGuncelle();
    haritaGuncelle();
    durumuKaydet();
  }

  function durumuKaydet(zorla) {
    var simdi = Date.now();
    if (!zorla && simdi - kayitZamani < 3000) return;
    kayitZamani = simdi;
    Depo.yaz('durum', {
      imza: veriImzasi(),
      takip: takipci.durumAl(),
      zaman: simdi
    });
    Depo.yaz('iz', iz);
  }

  function veriImzasi() {
    return rota.adimlar.length + '_' + Math.round(rota.toplamM);
  }

  /* ---- GPS ---- */
  function gpsBaslat() {
    if (!navigator.geolocation) {
      bildir('Bu cihazda konum servisi yok', 4000);
      return;
    }
    gpsVar = false;
    izleyiciId = navigator.geolocation.watchPosition(
      function (p) {
        konumIsle({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          heading: (typeof p.coords.heading === 'number' && !isNaN(p.coords.heading)) ? p.coords.heading : undefined,
          speed: (typeof p.coords.speed === 'number' && !isNaN(p.coords.speed)) ? p.coords.speed : undefined,
          accuracy: p.coords.accuracy,
          t: p.timestamp
        }, 'gps');
      },
      function (hata) {
        gpsVar = false;
        arayuzGuncelle();
        if (hata.code === 1) bildir('Konum izni verilmedi. Ayarlardan izin verin.', 5000);
        else if (hata.code === 3) bildir('Konum alınamıyor (zaman aşımı)', 3000);
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
    );
  }

  function gpsDurdur() {
    if (izleyiciId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(izleyiciId);
    }
    izleyiciId = null;
  }

  /* ---- Simülasyon ---- */
  function simBaslat() {
    sim.aktif = true;
    sim.m = takipci.toplamMesafe();
    sim.sonKare = 0;
    if (sim.id) cancelAnimationFrame(sim.id);
    sim.id = requestAnimationFrame(simKare);
  }

  function simDurdur() {
    sim.aktif = false;
    if (sim.id) cancelAnimationFrame(sim.id);
    sim.id = null;
  }

  function simKare(zaman) {
    if (!sim.aktif) return;
    if (!sim.sonKare) sim.sonKare = zaman;
    var dt = Math.min(250, zaman - sim.sonKare);
    sim.sonKare = zaman;

    var gidilecek = TABAN_HIZ_MS * sim.hiz * (dt / 1000);
    var kareBasiAdim = takipci.adimIndex;

    // Alt adımlara böl: konum en fazla 5 m'lik sıçramalarla ilerler, böylece
    // hızlı simülasyonda bile hiçbir rota adımı atlanmaz. Bir kare içinde en
    // çok bir adım ilerlenir; kalan mesafe düşürülür, böylece her adım ekranda
    // en az bir kare görünür.
    var guvenlik = 0;
    while (gidilecek > 0.01 && guvenlik++ < 400) {
      var d = Math.min(5, gidilecek);
      gidilecek -= d;
      sim.m += d;
      if (sim.m > rota.toplamM) sim.m = rota.toplamM;
      var n = Rota.rotadaNokta(rota, sim.m);
      var eskiIndex = takipci.adimIndex;
      sonKonum = { lat: n.lat, lon: n.lon, heading: n.yon, speed: 8, accuracy: 5, t: Date.now() };
      takipci.konumGuncelle(sonKonum);
      sesKontrol(eskiIndex);
      if (takipci.bitti) break;
      if (takipci.adimIndex !== kareBasiAdim) break;
    }

    arayuzGuncelle();
    haritaGuncelle();
    durumuKaydet();

    if (sim.aktif && !takipci.bitti) sim.id = requestAnimationFrame(simKare);
  }

  /* ---- Ekran kilidi ---- */
  function ekraniAcikTut() {
    if (!('wakeLock' in navigator)) return;
    try {
      navigator.wakeLock.request('screen').then(function (kilit) {
        wakeLock = kilit;
        kilit.addEventListener('release', function () { wakeLock = null; });
      }).catch(function () { /* yoksay */ });
    } catch (e) { /* yoksay */ }
  }

  function ekranKilidiBirak() {
    try { if (wakeLock) wakeLock.release(); } catch (e) { /* yoksay */ }
    wakeLock = null;
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && calisiyor) ekraniAcikTut();
  });

  /* ---- Başlat / durdur ---- */
  function basla() {
    calisiyor = true;
    bitisSoylendi = false;
    Ses.kilidiAc();
    ekraniAcikTut();
    if (sim.hiz > 0) simBaslat(); else gpsBaslat();
    $('btnBaslat').textContent = 'DURAKLAT';
    $('btnBaslat').classList.add('duraklat');
    arayuzGuncelle();
  }

  function durdur() {
    calisiyor = false;
    gpsDurdur();
    simDurdur();
    ekranKilidiBirak();
    Ses.sustur();
    $('btnBaslat').textContent = 'BAŞLAT';
    $('btnBaslat').classList.remove('duraklat');
    durumuKaydet(true);
    arayuzGuncelle();
  }

  /* =======================================================
     9. NOTLAR VE SÜRÜŞ KAYDI
     ======================================================= */

  function notEkle() {
    var k = sonKonum;
    var not = {
      lat: k ? +k.lat.toFixed(6) : null,
      lon: k ? +k.lon.toFixed(6) : null,
      adim: takipci.adim().no,
      zaman: Date.now()
    };
    notlar.push(not);
    Depo.yaz('notlar', notlar);
    notlariCiz();
    bildir('Not alındı — adım ' + not.adim);
    Ses.soyle('Not alındı');
  }

  function notlariCiz() {
    $('notSayisi').textContent = String(notlar.length);
    var kutu = $('notListesi');
    if (!notlar.length) {
      kutu.innerHTML = '<div class="bos">Henüz not yok.</div>';
      return;
    }
    kutu.innerHTML = notlar.map(function (n, i) {
      var konum = (n.lat === null) ? 'konum yok' :
        '<a href="https://www.google.com/maps/search/?api=1&query=' + n.lat + ',' + n.lon +
        '" target="_blank" rel="noopener">' + n.lat.toFixed(5) + ', ' + n.lon.toFixed(5) + '</a>';
      return '<div class="satir"><b>' + (i + 1) + '.</b> Adım ' + n.adim +
        ' · ' + saatBicim(n.zaman) + '<br>' + konum + '</div>';
    }).join('');
  }

  function notlariPaylas() {
    if (!notlar.length) { bildir('Not yok'); return; }
    var metin = 'Su rotası notları (' + new Date().toLocaleDateString('tr-TR') + ')\n\n' +
      notlar.map(function (n, i) {
        return (i + 1) + '. Adım ' + n.adim + ' · ' + saatBicim(n.zaman) +
          (n.lat === null ? '' : ' · https://maps.google.com/?q=' + n.lat + ',' + n.lon);
      }).join('\n');
    if (navigator.share) {
      navigator.share({ title: 'Su rotası notları', text: metin }).catch(function () { /* yoksay */ });
    } else {
      metniIndir(metin, 'su-rotasi-notlari.txt', 'text/plain');
    }
  }

  function izeEkle(konum) {
    if (konum.accuracy && konum.accuracy > 40) return;
    if (sonIzNokta) {
      var d = rota.proj.mesafe([sonIzNokta.lat, sonIzNokta.lon], [konum.lat, konum.lon]);
      if (d < 5) return;
    }
    sonIzNokta = konum;
    iz.push([+konum.lat.toFixed(6), +konum.lon.toFixed(6), konum.t || Date.now()]);
    if (iz.length > 20000) iz.shift();
    $('izBilgi').textContent = iz.length + ' nokta kaydedildi.';
  }

  function gpxUret() {
    var bas = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<gpx version="1.1" creator="Su Rotasi" xmlns="http://www.topografix.com/GPX/1/1">\n' +
      '<trk><name>Su dagitim surusu ' + new Date().toISOString().slice(0, 10) + '</name><trkseg>\n';
    var orta = iz.map(function (n) {
      return '<trkpt lat="' + n[0] + '" lon="' + n[1] + '"><time>' +
        new Date(n[2]).toISOString() + '</time></trkpt>';
    }).join('\n');
    var son = '\n</trkseg></trk>\n';
    var notWpt = notlar.filter(function (n) { return n.lat !== null; }).map(function (n, i) {
      return '<wpt lat="' + n.lat + '" lon="' + n.lon + '"><name>Not ' + (i + 1) +
        ' (adim ' + n.adim + ')</name><time>' + new Date(n.zaman).toISOString() + '</time></wpt>';
    }).join('\n');
    return bas + orta + son + notWpt + '\n</gpx>\n';
  }

  function gpxPaylas() {
    if (!iz.length) { bildir('Henüz sürüş kaydı yok'); return; }
    var metin = gpxUret();
    var adi = 'su-rotasi-' + new Date().toISOString().slice(0, 10) + '.gpx';
    try {
      if (navigator.canShare && window.File) {
        var dosya = new File([metin], adi, { type: 'application/gpx+xml' });
        if (navigator.canShare({ files: [dosya] })) {
          navigator.share({ files: [dosya], title: 'Sürüş kaydı' }).catch(function () { /* yoksay */ });
          return;
        }
      }
    } catch (e) { /* yoksay */ }
    metniIndir(metin, adi, 'application/gpx+xml');
  }

  function metniIndir(metin, adi, tur) {
    try {
      var blob = new Blob([metin], { type: tur });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = adi;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
    } catch (e) {
      bildir('Dosya oluşturulamadı');
    }
  }

  /* =======================================================
     10. OLAYLAR
     ======================================================= */

  function olaylariBagla() {
    $('btnBaslat').addEventListener('click', function () {
      if (calisiyor) durdur(); else basla();
    });

    $('btnGeri').addEventListener('click', function () {
      elleAdim(-1);
    });
    $('btnIleri').addEventListener('click', function () {
      elleAdim(1);
    });

    $('btnSes').addEventListener('click', function () {
      Ses.acik = !Ses.acik;
      if (!Ses.acik) Ses.sustur(); else Ses.kilidiAc();
      $('btnSes').textContent = Ses.acik ? '🔊 SES' : '🔇 SES';
      $('btnSes').classList.toggle('btn-ses-kapali', !Ses.acik);
      Depo.yaz('ayar', { ses: Ses.acik, yonYukari: Harita.yonYukari });
      bildir(Ses.acik ? 'Ses açık' : 'Ses kapalı');
    });

    $('btnNot').addEventListener('click', notEkle);

    $('btnMenu').addEventListener('click', function () {
      notlariCiz();
      $('izBilgi').textContent = iz.length ? (iz.length + ' nokta kaydedildi.') : 'Kayıt yok.';
      $('menu').hidden = false;
    });
    $('btnMenuKapat').addEventListener('click', function () { $('menu').hidden = true; });

    $('btnKuzey').addEventListener('click', function () {
      Harita.yonYukari = !Harita.yonYukari;
      $('btnKuzey').classList.toggle('aktif', Harita.yonYukari);
      $('btnKuzey').textContent = Harita.yonYukari ? '⇧' : 'N';
      $('btnKuzey').title = Harita.yonYukari ? 'Yön yukarı' : 'Kuzey yukarı';
      Depo.yaz('ayar', { ses: Ses.acik, yonYukari: Harita.yonYukari });
      haritaGuncelle();
    });

    // Simülasyon hızı
    Array.prototype.forEach.call(document.querySelectorAll('[data-sim]'), function (b) {
      b.addEventListener('click', function () {
        sim.hiz = parseInt(b.getAttribute('data-sim'), 10);
        Array.prototype.forEach.call(document.querySelectorAll('[data-sim]'), function (o) {
          o.classList.toggle('aktif', o === b);
        });
        if (calisiyor) { durdur(); basla(); }
        bildir(sim.hiz ? ('Simülasyon ' + sim.hiz + 'x — BAŞLAT’a basın') : 'Simülasyon kapalı — gerçek GPS');
        $('menu').hidden = true;
      });
    });

    $('btnBaslangicaGit').addEventListener('click', function () {
      var b = rota.baslangic;
      window.open('https://www.google.com/maps/dir/?api=1&destination=' +
        b[0] + ',' + b[1] + '&travelmode=driving', '_blank');
    });

    $('btnSifirla').addEventListener('click', function () {
      onaySor('İlerleme sıfırlansın mı? Adım 1’e dönülür ve sürüş kaydı silinir. (Notlar kalır.)', function () {
        durdur();
        takipci.sifirla();
        soylenen = { uzak: {}, yakin: {} };
        sonManevraMetni = '';
        rotaDisiSoylendi = false;
        bitisSoylendi = false;
        iz = []; sonIzNokta = null;
        sim.m = 0;
        sonCizilenAdim = -1;
        sonKonum = { lat: rota.baslangic[0], lon: rota.baslangic[1] };
        Depo.sil('iz');
        durumuKaydet(true);
        arayuzGuncelle();
        haritaGuncelle();
        $('menu').hidden = true;
        bildir('Sıfırlandı — adım 1');
      });
    });

    $('btnNotPaylas').addEventListener('click', notlariPaylas);
    $('btnNotTemizle').addEventListener('click', function () {
      onaySor('Bütün notlar silinsin mi?', function () {
        notlar = []; Depo.yaz('notlar', notlar); notlariCiz(); bildir('Notlar silindi');
      });
    });

    $('btnGpx').addEventListener('click', gpxPaylas);
    $('btnIzTemizle').addEventListener('click', function () {
      onaySor('Sürüş kaydı silinsin mi?', function () {
        iz = []; sonIzNokta = null; Depo.sil('iz');
        $('izBilgi').textContent = 'Kayıt yok.';
        bildir('Kayıt silindi');
      });
    });

    $('btnOnayEvet').addEventListener('click', function () {
      $('onay').hidden = true;
      if (onayGeriCagri) onayGeriCagri();
      onayGeriCagri = null;
    });
    $('btnOnayHayir').addEventListener('click', function () {
      $('onay').hidden = true;
      onayGeriCagri = null;
    });

    window.addEventListener('pagehide', function () { durumuKaydet(true); });
    window.addEventListener('beforeunload', function () { durumuKaydet(true); });
    window.addEventListener('offline', function () { Harita.cevrimdisiGoster(true); });
  }

  function elleAdim(adet) {
    takipci.elleIlerle(adet);
    // Elle atlanan adımın manevrası tekrar söylenebilsin
    soylenen.uzak[takipci.adimIndex] = true;
    soylenen.yakin[takipci.adimIndex] = true;
    bitisSoylendi = false;
    if (sim.aktif) sim.m = takipci.toplamMesafe();
    if (!sonKonum || sim.aktif || !gpsVar) {
      var n = Rota.rotadaNokta(rota, takipci.toplamMesafe());
      sonKonum = { lat: n.lat, lon: n.lon };
      takipci.yon = n.yon;
    }
    arayuzGuncelle();
    haritaGuncelle();
    durumuKaydet(true);
    bildir('Adım ' + takipci.adim().no);
  }

  /* =======================================================
     11. BAŞLANGIÇ
     ======================================================= */

  function ayarlariYukle() {
    var a = Depo.oku('ayar', null);
    if (a) {
      if (typeof a.ses === 'boolean') Ses.acik = a.ses;
      if (typeof a.yonYukari === 'boolean') Harita.yonYukari = a.yonYukari;
    }
    $('btnSes').textContent = Ses.acik ? '🔊 SES' : '🔇 SES';
    $('btnSes').classList.toggle('btn-ses-kapali', !Ses.acik);
    $('btnKuzey').classList.toggle('aktif', Harita.yonYukari);
    $('btnKuzey').textContent = Harita.yonYukari ? '⇧' : 'N';

    notlar = Depo.oku('notlar', []) || [];
    iz = Depo.oku('iz', []) || [];
    if (iz.length) sonIzNokta = { lat: iz[iz.length - 1][0], lon: iz[iz.length - 1][1] };
  }

  function durumuYukle() {
    var d = Depo.oku('durum', null);
    if (d && d.imza === veriImzasi() && d.takip) {
      takipci.durumYukle(d.takip);
      // Kaldığı adımın manevrası yeniden okunmasın
      soylenen.uzak[takipci.adimIndex] = true;
      soylenen.yakin[takipci.adimIndex] = true;
      if (takipci.adimIndex > 0) {
        bildir('Kaldığınız yerden devam: adım ' + takipci.adim().no, 4000);
      }
    }
  }

  function baslat(veri) {
    rota = Rota.rotaKur(veri);
    takipci = new Rota.Takipci(rota);

    ayarlariYukle();
    durumuYukle();

    Harita.kur(rota);
    olaylariBagla();

    var n = Rota.rotadaNokta(rota, takipci.toplamMesafe());
    sonKonum = { lat: n.lat, lon: n.lon };
    takipci.yon = n.yon;

    $('bilgiMetin').innerHTML =
      rota.ad + '<br>' + rota.adimlar.length + ' adım · ' +
      sayiTr(rota.toplamM / 1000, 2) + ' km · ' + rota.manevralar.length + ' manevra<br>' +
      'Harita: © OpenStreetMap katkıcıları';

    arayuzGuncelle();
    haritaGuncelle();
    $('yukleme').style.display = 'none';

    // Simülasyon kapalı olarak başlar
    var kapaliBtn = document.querySelector('[data-sim="0"]');
    if (kapaliBtn) kapaliBtn.classList.add('aktif');
  }

  function hataGoster(metin) {
    $('yukleme').style.display = '';
    $('yukleme').classList.add('hata');
    $('yuklemeDurum').textContent = metin;
  }

  function veriYukle() {
    // Tek dosyalık önizleme sürümünde rota verisi sayfaya gömülür.
    if (window.ROTA_VERISI) {
      try { baslat(window.ROTA_VERISI); }
      catch (e) { hataGoster('Uygulama başlatılamadı: ' + e.message); }
      return;
    }
    fetch('veri/rota_adimlari.json', { cache: 'no-cache' })
      .then(function (y) {
        if (!y.ok) throw new Error('HTTP ' + y.status);
        return y.json();
      })
      .catch(function (e) {
        hataGoster('Rota dosyası yüklenemedi (' + e.message + '). ' +
          'Uygulamayı bir web sunucusundan (GitHub Pages) açtığınızdan emin olun.');
        throw e;
      })
      .then(function (veri) {
        try {
          baslat(veri);
        } catch (e) {
          hataGoster('Uygulama başlatılamadı: ' + e.message);
          throw e;
        }
      })
      .catch(function () { /* hata zaten gösterildi */ });
  }

  /* Service worker — çevrimdışı çalışma (gömülü önizlemede yok) */
  if (!window.ROTA_VERISI && 'serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* yoksay */ });
    });
  }

  veriYukle();
})();
