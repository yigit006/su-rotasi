/*
 * rota.js — Rota verisi, geometri ve konum eşleştirme çekirdeği.
 *
 * Bu dosya arayüzden ve haritadan tamamen bağımsızdır; sadece matematik yapar.
 * Böylece Node.js ile testi yapılabilir (test/simule_test.js).
 *
 * Kritik nokta: rota kendi üstünden defalarca geçtiği için konumu "rotanın en
 * yakın noktasına" bağlamak yanlış olur. Eşleştirme sadece şu anki adım ve
 * ondan sonraki birkaç adım içinde, aracın gidiş yönü de dikkate alınarak
 * yapılır.
 */
(function (global) {
  'use strict';

  /* ---------- Ayarlar ---------- */
  var VARSAYILAN = {
    ileriAdimSayisi: 5,      // eşleştirmede bakılacak ileri adım sayısı
    ileriMesafeM: 400,       // ... ve bunların toplam uzunluk sınırı (m)
    ilerletmeToleransM: 15,  // adımın sonuna bu kadar kala ilerlemeye izin ver
    yonFarkiMaks: 90,        // adım yönüyle bu kadar dereceden fazla fark varsa eşleşme yok
    dogrulukSiniriM: 30,     // GPS accuracy bundan büyükse ilerletme yok
    rotaDisiM: 35,           // şu anki adıma bu mesafeden uzaksa rota dışı sayılır
    rotaDisiSn: 10,          // ... ve bu kadar saniye sürerse uyarı verilir
    yapiskanlikM: 6,         // şu anki adıma verilen avantaj (m)
    yonIcinAsgariHizMs: 1.2, // GPS heading'e bu hızın üstünde güvenilir
    yonIcinAsgariMesafeM: 15,// heading yoksa son konumlardan hesaplamak için asgari yer değişimi
    yonYumusatma: 0.6,       // yön filtresi (0 = değişme, 1 = anında)
    takilmaSiniri: 3         // bu kadar güncellemede aday bulunamazsa yön filtresi geçici kapatılır
  };

  /* ---------- Yardımcı matematik ---------- */
  function radyan(d) { return d * Math.PI / 180; }
  function derece(r) { return r * 180 / Math.PI; }

  // İki açı arasındaki en kısa fark (-180..180)
  function aciFarki(a, b) {
    var d = ((a - b + 540) % 360) - 180;
    return d;
  }

  // Düzlem koordinatlarında yön (0 = kuzey, saat yönünde artar)
  function yonHesapla(x1, y1, x2, y2) {
    var a = derece(Math.atan2(x2 - x1, y2 - y1));
    return (a + 360) % 360;
  }

  /* ---------- Projeksiyon (yerel düzlem) ---------- */
  // Mahalle ~2 km olduğu için basit eşdikdörtgen projeksiyon yeterli (hata < %0,1).
  function Projeksiyon(lat0, lon0) {
    this.lat0 = lat0;
    this.lon0 = lon0;
    this.mLat = 111320;
    this.mLon = 111320 * Math.cos(radyan(lat0));
  }
  Projeksiyon.prototype.xy = function (lat, lon) {
    return [(lon - this.lon0) * this.mLon, (lat - this.lat0) * this.mLat];
  };
  Projeksiyon.prototype.latlon = function (x, y) {
    return [this.lat0 + y / this.mLat, this.lon0 + x / this.mLon];
  };
  Projeksiyon.prototype.mesafe = function (a, b) {
    var p = this.xy(a[0], a[1]), q = this.xy(b[0], b[1]);
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  };

  /* ---------- Rota kurulumu ---------- */
  /**
   * Ham JSON'dan hesaplanmış rota nesnesi üretir.
   * Her adım için: düzlem koordinatları, parça uzunlukları, kümülatif mesafe,
   * parça yönleri ve adıma girişteki manevra.
   */
  function rotaKur(veri) {
    var basla = veri.baslangic_ve_bitis || veri.adimlar[0].koordinatlar[0];
    var proj = new Projeksiyon(basla[0], basla[1]);

    var manevraHaritasi = {};
    (veri.manevralar || []).forEach(function (m) { manevraHaritasi[m.adim] = m; });

    var adimlar = [];
    var toplam = 0;
    veri.adimlar.forEach(function (ham, idx) {
      var pts = ham.koordinatlar;
      var xy = pts.map(function (p) { return proj.xy(p[0], p[1]); });
      var kum = [0], yonler = [], uzunluklar = [];
      for (var i = 0; i < xy.length - 1; i++) {
        var dx = xy[i + 1][0] - xy[i][0], dy = xy[i + 1][1] - xy[i][1];
        var L = Math.hypot(dx, dy);
        uzunluklar.push(L);
        kum.push(kum[i] + L);
        yonler.push(yonHesapla(xy[i][0], xy[i][1], xy[i + 1][0], xy[i + 1][1]));
      }
      var uz = kum[kum.length - 1];
      adimlar.push({
        idx: idx,
        no: ham.no,
        tur: ham.tur,
        pts: pts,
        xy: xy,
        kum: kum,
        parcaUzunluk: uzunluklar,
        parcaYon: yonler,
        uzunluk: uz,
        beyanUzunluk: ham.uzunluk_m,
        baslangicM: toplam,
        girisManevra: manevraHaritasi[ham.no] || null,
        girisYon: yonler.length ? yonler[0] : 0,
        cikisYon: yonler.length ? yonler[yonler.length - 1] : 0
      });
      toplam += uz;
    });

    return {
      ad: veri.ad || 'Rota',
      proj: proj,
      adimlar: adimlar,
      toplamM: toplam,
      baslangic: basla,
      manevralar: veri.manevralar || [],
      manevraHaritasi: manevraHaritasi
    };
  }

  /**
   * Rota başından itibaren verilen mesafedeki noktayı döndürür.
   * Simülasyon ve "rotaya dönüş" göstergesi için kullanılır.
   * @returns {{lat:number, lon:number, yon:number, adimIndex:number}}
   */
  function rotadaNokta(rota, m) {
    var adimlar = rota.adimlar;
    if (m <= 0) {
      var ilk = adimlar[0];
      return { lat: ilk.pts[0][0], lon: ilk.pts[0][1], yon: ilk.girisYon, adimIndex: 0 };
    }
    for (var i = 0; i < adimlar.length; i++) {
      var a = adimlar[i];
      if (m <= a.baslangicM + a.uzunluk || i === adimlar.length - 1) {
        var yerel = Math.min(Math.max(0, m - a.baslangicM), a.uzunluk);
        for (var j = 0; j < a.parcaUzunluk.length; j++) {
          if (yerel <= a.kum[j + 1] || j === a.parcaUzunluk.length - 1) {
            var oran = a.parcaUzunluk[j] > 0 ? (yerel - a.kum[j]) / a.parcaUzunluk[j] : 0;
            if (oran < 0) oran = 0; else if (oran > 1) oran = 1;
            var x = a.xy[j][0] + (a.xy[j + 1][0] - a.xy[j][0]) * oran;
            var y = a.xy[j][1] + (a.xy[j + 1][1] - a.xy[j][1]) * oran;
            var ll = rota.proj.latlon(x, y);
            return { lat: ll[0], lon: ll[1], yon: a.parcaYon[j], adimIndex: i };
          }
        }
      }
    }
    var son = adimlar[adimlar.length - 1];
    var sp = son.pts[son.pts.length - 1];
    return { lat: sp[0], lon: sp[1], yon: son.cikisYon, adimIndex: adimlar.length - 1 };
  }

  /**
   * Bir noktayı tek bir adımın çizgisine izdüşürür.
   * Yön filtresi verilirse, yönü uymayan parçalar elenir.
   * @returns {{mesafe:number, uzaklik:number, yon:number, x:number, y:number}|null}
   */
  function adimaIzdusur(adim, px, py, aracYon, yonFarkiMaks) {
    var enIyi = null;
    for (var i = 0; i < adim.xy.length - 1; i++) {
      var L = adim.parcaUzunluk[i];
      if (L <= 0.01) continue;
      if (aracYon !== null && Math.abs(aciFarki(aracYon, adim.parcaYon[i])) > yonFarkiMaks) continue;

      var ax = adim.xy[i][0], ay = adim.xy[i][1];
      var bx = adim.xy[i + 1][0], by = adim.xy[i + 1][1];
      var t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / (L * L);
      if (t < 0) t = 0; else if (t > 1) t = 1;
      var qx = ax + (bx - ax) * t, qy = ay + (by - ay) * t;
      var d = Math.hypot(px - qx, py - qy);
      if (!enIyi || d < enIyi.uzaklik) {
        enIyi = {
          mesafe: adim.kum[i] + L * t, // adım başından itibaren m
          uzaklik: d,                  // çizgiye dik uzaklık m
          yon: adim.parcaYon[i],
          x: qx, y: qy
        };
      }
    }
    return enIyi;
  }

  /* ---------- Takipçi ---------- */
  function Takipci(rota, ayar) {
    this.rota = rota;
    this.ayar = Object.assign({}, VARSAYILAN, ayar || {});
    this.sifirla();
  }

  Takipci.prototype.sifirla = function () {
    this.adimIndex = 0;
    this.mesafe = 0;           // şu anki adım içinde katedilen m
    this.uzaklik = 0;          // rotaya dik uzaklık m
    this.yon = null;           // aracın yönü (derece)
    this.sonKonum = null;      // {lat, lon, t}
    this.sonYonKonum = null;   // yön hesabı için referans konum
    this.rotaDisi = false;
    this.rotaDisiBaslangic = null;
    this.zayifSinyal = false;
    this.bitti = false;
    this.snapXY = null;        // rotaya oturtulmuş konum (düzlem)
    this.takilmaSayaci = 0;    // üst üste aday bulunamayan güncelleme sayısı
    this.yonFiltresiKapali = false;
  };

  Takipci.prototype.adim = function () { return this.rota.adimlar[this.adimIndex]; };

  /** Rota başından itibaren katedilen mesafe (m) */
  Takipci.prototype.toplamMesafe = function () {
    if (this.bitti) return this.rota.toplamM;
    return this.adim().baslangicM + this.mesafe;
  };

  /** Şu anki adımda kalan mesafe (m) */
  Takipci.prototype.adimdaKalan = function () {
    return Math.max(0, this.adim().uzunluk - this.mesafe);
  };

  /**
   * Sıradaki manevrayı ve ona kalan mesafeyi bulur.
   * Bazı adımların girişinde manevra yoktur (1, 51, 69, 75, 84) — o zaman
   * bir sonraki manevralı adıma kadar bakılır.
   */
  Takipci.prototype.siradakiManevra = function () {
    var kalan = this.adimdaKalan();
    for (var j = this.adimIndex + 1; j < this.rota.adimlar.length; j++) {
      var a = this.rota.adimlar[j];
      if (a.girisManevra) {
        return { manevra: a.girisManevra, adimIndex: j, mesafe: kalan, hedefAdim: a };
      }
      kalan += a.uzunluk;
    }
    return null; // rota sonu
  };

  /** Yönü yumuşatarak günceller (GPS gürültüsüne karşı). */
  Takipci.prototype._yonUygula = function (yeni, agirlik) {
    if (this.yon === null) { this.yon = yeni; return; }
    var d = aciFarki(yeni, this.yon);
    this.yon = (this.yon + agirlik * d + 360) % 360;
  };

  /** Aracın yönünü GPS heading veya son konumlardan tahmin eder. */
  Takipci.prototype._yonGuncelle = function (konum) {
    var a = this.ayar;
    var h = konum.heading;
    var hiz = (typeof konum.speed === 'number' && isFinite(konum.speed)) ? konum.speed : null;

    if (typeof h === 'number' && isFinite(h) && h >= 0 &&
        (hiz === null || hiz >= a.yonIcinAsgariHizMs)) {
      this._yonUygula(h, 0.85);
      this.sonYonKonum = { lat: konum.lat, lon: konum.lon };
      return;
    }
    // heading yok (ör. duran araç, bazı cihazlar): son konumlardan hesapla
    if (this.sonYonKonum) {
      var p = this.rota.proj.xy(this.sonYonKonum.lat, this.sonYonKonum.lon);
      var q = this.rota.proj.xy(konum.lat, konum.lon);
      var d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d >= a.yonIcinAsgariMesafeM) {
        this._yonUygula(yonHesapla(p[0], p[1], q[0], q[1]), a.yonYumusatma);
        this.sonYonKonum = { lat: konum.lat, lon: konum.lon };
      }
    } else {
      this.sonYonKonum = { lat: konum.lat, lon: konum.lon };
    }
  };

  /**
   * Yeni konum işler.
   * @param {{lat:number, lon:number, heading?:number, speed?:number, accuracy?:number, t?:number}} konum
   * @returns {{ilerletilenAdimlar:Array<number>, rotaDisi:boolean, bitti:boolean}}
   */
  Takipci.prototype.konumGuncelle = function (konum) {
    var a = this.ayar;
    var zaman = (typeof konum.t === 'number') ? konum.t : Date.now();
    var sonuc = { ilerletilenAdimlar: [], rotaDisi: false, bitti: false, yeniAdim: false };

    this._yonGuncelle(konum);
    this.sonKonum = { lat: konum.lat, lon: konum.lon, t: zaman };

    var dogruluk = (typeof konum.accuracy === 'number') ? konum.accuracy : 0;
    this.zayifSinyal = dogruluk > a.dogrulukSiniriM;

    var p = this.rota.proj.xy(konum.lat, konum.lon);
    var px = p[0], py = p[1];

    if (this.bitti) { sonuc.bitti = true; return sonuc; }

    // --- Aday adımlar: şu anki adım + ileri pencere (yön filtreli) ---
    var yonFiltreli = this.yon !== null;
    var adaylar = this._adaylar(px, py, yonFiltreli);

    // Üst üste aday bulunamıyorsa (gürültülü/yanlış yön tahmini) filtreyi
    // geçici olarak kapat; yoksa araç sonsuza kadar takılı kalır.
    if (!adaylar.length) {
      this.takilmaSayaci++;
      if (this.takilmaSayaci >= a.takilmaSiniri) {
        yonFiltreli = false;
        adaylar = this._adaylar(px, py, false);
        this.yonFiltresiKapali = true;
      }
    } else {
      this.takilmaSayaci = 0;
      this.yonFiltresiKapali = false;
    }

    var enIyi = null;
    adaylar.forEach(function (c) {
      var puan = c.uzaklik - (c.adimIndex === this.adimIndex ? a.yapiskanlikM : 0);
      if (!enIyi || puan < enIyi.puan) { c.puan = puan; enIyi = c; }
    }, this);

    if (!enIyi) {
      // Hiçbir aday yön filtresini geçemedi (ör. çıkmaz sokakta araç henüz
      // dönmemiş). Konumu koru, ilerletme yapma.
      this._rotaDisiKontrol(zaman, null);
      sonuc.rotaDisi = this.rotaDisi;
      return sonuc;
    }

    this.uzaklik = enIyi.uzaklik;
    this.snapXY = [enIyi.x, enIyi.y];

    // Zayıf sinyalde veya rotadan uzaktayken ilerletme yok.
    var ilerletilebilir = !this.zayifSinyal && enIyi.uzaklik <= a.rotaDisiM;

    if (enIyi.adimIndex === this.adimIndex) {
      // Aynı adım: geriye doğru büyük sıçramaları engelle
      if (!this.zayifSinyal) {
        if (enIyi.mesafe > this.mesafe - 25) this.mesafe = enIyi.mesafe;
      }
    } else if (ilerletilebilir && enIyi.adimIndex > this.adimIndex) {
      // Adımı teker teker ilerlet — hiçbir adım atlanmaz, hepsi raporlanır.
      var guvenlik = 0;
      while (this.adimIndex < enIyi.adimIndex && guvenlik++ < 25) {
        var suAnki = this._tekAday(this.adimIndex, px, py, yonFiltreli);
        // Şu anki adım hâlâ geçerliyse ve sonuna gelinmediyse ilerleme.
        // (Araç çıkmaz sokakta geri döndüyse bu adım yön filtresini geçemez
        //  ve aday null olur — o zaman mesafe şartı aranmadan ilerletilir.)
        if (suAnki && suAnki.uzaklik <= a.rotaDisiM) {
          var kalan = this.adim().uzunluk - suAnki.mesafe;
          if (kalan > a.ilerletmeToleransM) break;
        }
        var eski = this.adimIndex;
        this.adimIndex++;
        sonuc.ilerletilenAdimlar.push(this.rota.adimlar[eski].no);
        sonuc.yeniAdim = true;
        var iz = adimaIzdusur(this.adim(), px, py, null, 180);
        this.mesafe = iz ? iz.mesafe : 0;
      }
      if (this.adimIndex === enIyi.adimIndex) {
        this.mesafe = enIyi.mesafe;
        this.uzaklik = enIyi.uzaklik;
      }
    }

    // --- Rota bitişi ---
    var son = this.rota.adimlar[this.rota.adimlar.length - 1];
    if (this.adimIndex === son.idx && this.adimdaKalan() <= a.ilerletmeToleransM && ilerletilebilir) {
      this.bitti = true;
      this.mesafe = son.uzunluk;
      sonuc.bitti = true;
    }

    this._rotaDisiKontrol(zaman, this.uzaklik);
    sonuc.rotaDisi = this.rotaDisi;
    return sonuc;
  };

  /** Tek bir adım için izdüşüm (yön filtresi isteğe bağlı). */
  Takipci.prototype._tekAday = function (i, px, py, yonFiltreli) {
    if (i < 0 || i >= this.rota.adimlar.length) return null;
    var iz = adimaIzdusur(
      this.rota.adimlar[i], px, py,
      yonFiltreli ? this.yon : null,
      this.ayar.yonFarkiMaks
    );
    if (!iz) return null;
    return { adimIndex: i, mesafe: iz.mesafe, uzaklik: iz.uzaklik, yon: iz.yon, x: iz.x, y: iz.y };
  };

  Takipci.prototype._adaylar = function (px, py, yonFiltreli) {
    var a = this.ayar;
    var liste = [];
    var toplam = 0;
    for (var k = 0; k <= a.ileriAdimSayisi; k++) {
      var i = this.adimIndex + k;
      if (i >= this.rota.adimlar.length) break;
      if (k > 1 && toplam > a.ileriMesafeM) break;
      var aday = this._tekAday(i, px, py, yonFiltreli);
      if (aday) liste.push(aday);
      toplam += this.rota.adimlar[i].uzunluk;
    }
    return liste;
  };

  Takipci.prototype._rotaDisiKontrol = function (zaman, uzaklik) {
    var a = this.ayar;
    var uzak = (uzaklik === null) ? false : uzaklik > a.rotaDisiM;
    if (uzak) {
      if (this.rotaDisiBaslangic === null) this.rotaDisiBaslangic = zaman;
      if (zaman - this.rotaDisiBaslangic >= a.rotaDisiSn * 1000) this.rotaDisi = true;
    } else {
      this.rotaDisiBaslangic = null;
      this.rotaDisi = false;
    }
  };

  /** Elle bir adım ileri/geri (GPS yanılırsa) */
  Takipci.prototype.elleIlerle = function (adet) {
    var yeni = this.adimIndex + adet;
    if (yeni < 0) yeni = 0;
    if (yeni > this.rota.adimlar.length - 1) yeni = this.rota.adimlar.length - 1;
    this.adimIndex = yeni;
    this.mesafe = 0;
    this.bitti = false;
    this.rotaDisi = false;
    this.rotaDisiBaslangic = null;
    return this.adimIndex;
  };

  Takipci.prototype.adimaGit = function (index) {
    return this.elleIlerle(index - this.adimIndex);
  };

  /**
   * Rota dışındayken: ileri yöndeki en yakın rota noktası (dönüş hedefi).
   * Otomatik yeniden rota hesaplama YAPILMAZ; sadece yön ve mesafe gösterilir.
   */
  Takipci.prototype.donusHedefi = function (lat, lon) {
    var p = this.rota.proj.xy(lat, lon);
    var enIyi = null;
    var sinir = Math.min(this.rota.adimlar.length, this.adimIndex + 15);
    for (var i = this.adimIndex; i < sinir; i++) {
      var iz = adimaIzdusur(this.rota.adimlar[i], p[0], p[1], null, 180);
      if (iz && (!enIyi || iz.uzaklik < enIyi.uzaklik)) {
        enIyi = { adimIndex: i, uzaklik: iz.uzaklik, x: iz.x, y: iz.y, mesafe: iz.mesafe };
      }
    }
    if (!enIyi) return null;
    var ll = this.rota.proj.latlon(enIyi.x, enIyi.y);
    return {
      adimIndex: enIyi.adimIndex,
      lat: ll[0], lon: ll[1],
      uzaklik: enIyi.uzaklik,
      yon: yonHesapla(p[0], p[1], enIyi.x, enIyi.y)
    };
  };

  /** Kaydedilebilir durum */
  Takipci.prototype.durumAl = function () {
    return {
      adimIndex: this.adimIndex,
      mesafe: this.mesafe,
      bitti: this.bitti
    };
  };
  Takipci.prototype.durumYukle = function (d) {
    if (!d) return;
    if (typeof d.adimIndex === 'number' &&
        d.adimIndex >= 0 && d.adimIndex < this.rota.adimlar.length) {
      this.adimIndex = d.adimIndex;
      this.mesafe = Math.min(Math.max(0, d.mesafe || 0), this.adim().uzunluk);
      this.bitti = !!d.bitti;
    }
  };

  /* ---------- Dışa aktarım ---------- */
  var API = {
    VARSAYILAN: VARSAYILAN,
    Projeksiyon: Projeksiyon,
    Takipci: Takipci,
    rotaKur: rotaKur,
    rotadaNokta: rotadaNokta,
    adimaIzdusur: adimaIzdusur,
    aciFarki: aciFarki,
    yonHesapla: yonHesapla,
    radyan: radyan,
    derece: derece
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.Rota = API;
})(typeof self !== 'undefined' ? self : this);
