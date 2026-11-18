/* Couche de compatibilité pour l'autoradio TopWay (vieux WebView Android).
   Chargée avant le code de jarvis-giulietta, puis convertie par Babel avec lui. */
window.JARVIS_HOSTED = !/[?&]apercu/.test(location.search); // ?apercu : simulateur, pour comparer avec l'original
window.JARVIS_TOPWAY = !!window.Android;

/* ---------- erreurs visibles à l'écran (pour pouvoir les photographier) ---------- */
window.addEventListener('error', e => {
  let b = document.getElementById('jxErr');
  if (!b) {
    b = document.createElement('div'); b.id = 'jxErr';
    b.setAttribute('style', 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#700;color:#fff;font:12px monospace;padding:4px 8px;white-space:pre-wrap');
    b.addEventListener('click', () => b.remove());
    (document.body || document.documentElement).appendChild(b);
  }
  if (b.textContent.length < 600) b.textContent += (e.message || 'erreur') + ' @' + (e.lineno || '?') + ':' + (e.colno || '?') + '\n';
});

/* ---------- fonctions absentes des vieux moteurs ---------- */
if (!Promise.allSettled) Promise.allSettled = list => Promise.all(Array.from(list).map(p =>
  Promise.resolve(p).then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }))));
if (!Promise.prototype.finally) Promise.prototype.finally = function (fn) {
  return this.then(v => Promise.resolve(fn()).then(() => v), e => Promise.resolve(fn()).then(() => { throw e; }));
};
if (!Array.prototype.flatMap) Object.defineProperty(Array.prototype, 'flatMap', { configurable: true, writable: true,
  value(fn, self) { return this.reduce((acc, x, i, arr) => acc.concat(fn.call(self, x, i, arr)), []); } });
if (!Array.prototype.flat) Object.defineProperty(Array.prototype, 'flat', { configurable: true, writable: true,
  value() { return this.reduce((acc, x) => acc.concat(x), []); } });
if (!Object.fromEntries) Object.fromEntries = it => { const o = {}; Array.from(it).forEach(([k, v]) => { o[k] = v; }); return o; };
if (!window.AbortController) { // fetch ne sait pas s'interrompre ici : abort() fait échouer la promesse côté appelant
  window.AbortController = function () { this.signal = { aborted: false, _l: [], addEventListener(t, f) { this._l.push(f); } }; };
  window.AbortController.prototype.abort = function () { this.signal.aborted = true; this.signal._l.forEach(f => f()); };
  const realFetch = window.fetch;
  window.fetch = (url, opt) => {
    if (!opt || !opt.signal) return realFetch(url, opt);
    const sig = opt.signal, o = Object.assign({}, opt); delete o.signal;
    return new Promise((res, rej) => {
      const err = () => { const e = new Error('Aborted'); e.name = 'AbortError'; rej(e); };
      if (sig.aborted) return err();
      sig.addEventListener('abort', err);
      realFetch(url, o).then(res, rej);
    });
  };
}

/* ---------- voix : synthèse et reconnaissance vocales d'Android derrière l'API du navigateur ----------
   Le WebView d'Android expose bien window.speechSynthesis, mais il reste muet : on le remplace
   toujours dans l'appli, et on ajoute la reconnaissance vocale, absente du WebView. */
const setGlobal = (name, value) => {
  try { Object.defineProperty(window, name, { value, writable: true, configurable: true }); } catch (e) { try { window[name] = value; } catch (e2) {} }
};
if (window.Android) {
  let seq = 0; const waiting = {};
  setGlobal('SpeechSynthesisUtterance', function (text) { this.text = text; this.lang = 'fr-FR'; this.volume = 1; });
  window.__ttsDone = id => { const u = waiting[id]; delete waiting[id]; if (u && u.onend) u.onend({}); };
  setGlobal('speechSynthesis', {
    paused: false, speaking: false, onvoiceschanged: null,
    getVoices: () => [{ name: 'Android', lang: 'fr-FR', localService: true }],
    speak(u) {
      const id = ++seq;
      if (!u.text || !u.text.trim() || u.volume === 0) { setTimeout(() => u.onend && u.onend({}), 0); return; }
      waiting[id] = u; window.Android.say(String(u.text), id);
    },
    cancel() { for (const k in waiting) delete waiting[k]; window.Android.hush(); },
    resume() {}, pause() {}
  });
}
if (window.Android && window.Android.listen) {
  let srSeq = 0; const recs = {};
  const SR = function () { this.lang = 'fr-FR'; this.interimResults = false; this.continuous = false; this.maxAlternatives = 1; };
  SR.prototype.start = function () { const id = ++srSeq; recs[id] = this; window.Android.listen(id); };
  SR.prototype.stop = SR.prototype.abort = function () { window.Android.stopListen(); };
  window.__srEvent = (id, type, text) => {
    const r = recs[id]; if (!r) return;
    if (type === 'start') { if (r.onstart) r.onstart({}); }
    else if (type === 'partial' || type === 'result') {
      const res = [[{ transcript: text, confidence: 1 }]]; res[0].isFinal = type === 'result';
      if (r.onresult) r.onresult({ results: res, resultIndex: 0 });
    } else if (type === 'error') { if (r.onerror) r.onerror({ error: text }); }
    else if (type === 'end') { delete recs[id]; if (r.onend) r.onend({}); }
  };
  setGlobal('SpeechRecognition', SR); setGlobal('webkitSpeechRecognition', SR);
}

/* ---------- Bluetooth basse consommation (OBDLink CX) : le Web Bluetooth, fourni par Android ----------
   Même interface que navigator.bluetooth de Chrome, pour que le code OBD d'origine (WebBleLink)
   marche tel quel. Chaque appel part vers Android.ble(méthode, n°, arguments JSON) ; la réponse
   revient par __bleDone(n°, ok, résultat JSON), les notifications par __bleEvent(...). */
if (window.Android && window.Android.ble) {
  let seq = 0; const pend = {}, devs = {}, chars = {};
  const call = (method, args) => new Promise((res, rej) => {
    const id = ++seq; pend[id] = { res, rej };
    window.Android.ble(method, id, JSON.stringify(args || []));
  });
  window.__bleDone = (id, ok, data) => {
    const p = pend[id]; delete pend[id]; if (!p) return;
    if (ok) p.res(data ? JSON.parse(data) : null);
    else { const d = data ? JSON.parse(data) : {}, e = new Error(d.message || 'Bluetooth'); e.name = d.name || 'NetworkError'; p.rej(e); }
  };
  const hexBytes = h => { const b = new Uint8Array(h.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16); return b; };
  const toHex = d => { const b = d instanceof DataView ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d.buffer || d); let h = ''; for (let i = 0; i < b.length; i++) h += (b[i] < 16 ? '0' : '') + b[i].toString(16); return h; };
  const Emitter = { addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }, removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter(x => x !== f); }, _fire(t, e) { (this._l[t] || []).slice().forEach(f => { try { f(e); } catch (err) { console.error(err); } }); } };
  const BleChar = function (dev, svc, c) {
    this._l = {}; this.service = { uuid: svc }; this.uuid = c.uuid; this._dev = dev; this.value = null;
    this.properties = { write: !!c.write, writeWithoutResponse: !!c.writeNoResp, notify: !!c.notify, indicate: !!c.indicate, read: !!c.read };
    chars[dev.id + '|' + svc + '|' + c.uuid] = this;
  };
  Object.assign(BleChar.prototype, Emitter, {
    startNotifications() { return call('notify', [this._dev.id, this.service.uuid, this.uuid]).then(() => this); },
    writeValue(d) { return call('write', [this._dev.id, this.service.uuid, this.uuid, toHex(d), false]); },
    writeValueWithoutResponse(d) { return call('write', [this._dev.id, this.service.uuid, this.uuid, toHex(d), true]); }
  });
  const BleDevice = function (id, name) {
    this._l = {}; this.id = id; this.name = name; const dev = this;
    this.gatt = {
      device: dev, connected: false, _svcs: [],
      connect() { return call('connect', [dev.id]).then(svcs => { this._svcs = svcs || []; this.connected = true; return this; }); },
      disconnect() { this.connected = false; call('disconnect', [dev.id]).catch(() => {}); },
      getPrimaryService(uuid) {
        const s = this._svcs.filter(x => x.uuid === String(uuid).toLowerCase())[0];
        if (!s) { const e = new Error('service absent'); e.name = 'NotFoundError'; return Promise.reject(e); }
        return Promise.resolve({ uuid: s.uuid, device: dev, getCharacteristics: () => Promise.resolve(s.chars.map(c => new BleChar(dev, s.uuid, c))) });
      }
    };
  };
  Object.assign(BleDevice.prototype, Emitter);
  const known = (id, name) => devs[id] || (devs[id] = new BleDevice(id, name || 'OBD'));
  window.__bleEvent = (type, devId, svc, chr, hex) => {
    const dev = devs[devId]; if (!dev) return;
    if (type === 'disconnected') { if (dev.gatt.connected) { dev.gatt.connected = false; dev._fire('gattserverdisconnected', { target: dev }); } return; }
    const c = chars[devId + '|' + svc + '|' + chr]; if (!c) return;
    c.value = new DataView(hexBytes(hex).buffer);
    c._fire('characteristicvaluechanged', { target: c });
  };
  setGlobal('bluetoothShim', true);
  try {
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: {
      requestDevice: () => call('pick', []).then(d => known(d.id, d.name)),
      getAvailability: () => Promise.resolve(true),
      knownDevice: known
    } });
  } catch (e) { console.error('Bluetooth : ' + e.message); }
}

/* ---------- GPS : lu par Android directement (la géolocalisation du WebView échoue souvent ici) ---------- */
if (window.Android && window.Android.gpsStart) {
  const watchers = {}; let wid = 0, last = null;
  window.__gpsFix = (lat, lon, acc, spd, hdg, t) => {
    last = { coords: { latitude: lat, longitude: lon, accuracy: acc, speed: spd, heading: hdg, altitude: null, altitudeAccuracy: null }, timestamp: t };
    Object.keys(watchers).forEach(k => { try { watchers[k].ok(last); } catch (e) { console.error(e); } });
  };
  window.__gpsErr = (code, msg) => Object.keys(watchers).forEach(k => { const w = watchers[k]; if (w.err) try { w.err({ code, message: msg, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); } catch (e) { console.error(e); } });
  window.__gpsSats = (seen, used) => { // pendant la recherche, la carte dit combien de satellites sont captés
    const m = document.getElementById('mapMsg');
    if (m && !m.hidden && /Recherche du signal GPS/.test(m.textContent)) m.textContent = `Recherche du signal GPS… ${used} satellite${used > 1 ? 's' : ''} utilisé${used > 1 ? 's' : ''} sur ${seen} vu${seen > 1 ? 's' : ''}`;
  };
  const geo = {
    watchPosition(ok, err) { const id = ++wid; watchers[id] = { ok, err }; window.Android.gpsStart(); if (last) setTimeout(() => watchers[id] && ok(last), 0); return id; },
    clearWatch(id) { delete watchers[id]; if (!Object.keys(watchers).length) window.Android.gpsStop(); },
    getCurrentPosition(ok, err) { const id = geo.watchPosition(p => { geo.clearWatch(id); ok(p); }, e => { geo.clearWatch(id); if (err) err(e); }); }
  };
  try { Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geo }); } catch (e) { console.error('GPS : ' + e.message); }
}

/* ---------- menu Android : appui long sur « J.A.R.V.I.S » en haut à gauche ---------- */
if (window.Android && window.Android.menu) addEventListener('DOMContentLoaded', () => {
  const el = document.querySelector('.top .brand'); if (!el) return;
  let t = null;
  const stop = () => { clearTimeout(t); t = null; };
  el.addEventListener('touchstart', () => { stop(); t = setTimeout(() => { t = null; window.Android.menu(); }, 700); }, { passive: true });
  el.addEventListener('mousedown', () => { stop(); t = setTimeout(() => { t = null; window.Android.menu(); }, 700); });
  ['touchend', 'touchmove', 'touchcancel', 'mouseup', 'mouseleave'].forEach(n => el.addEventListener(n, stop));
});

/* ---------- carte 2D en tuiles images, avec l'interface de MapLibre utilisée par Jarvis ---------- */
(function () {
  const TILE = 256, R2D = 180 / Math.PI, MAXZ = 16; // le fond Esri s'arrête au zoom 16 : au-delà on agrandit
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
  const lon2x = (lon, z) => (lon + 180) / 360 * TILE * Math.pow(2, z);
  const lat2y = (lat, z) => { const s = Math.sin(lat / R2D); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * Math.pow(2, z); };
  const css = (el, s) => { el.setAttribute('style', s); return el; };

  function Map2D(o) {
    const box = this.box = typeof o.container === 'string' ? document.getElementById(o.container) : o.container;
    this.c = { lon: o.center[0], lat: o.center[1], zoom: o.zoom || 5, bearing: o.bearing || 0 };
    this.pad = { top: 0, bottom: 0, left: 0, right: 0 };
    this.layers = {}; (o.style && o.style.layers || []).forEach(l => { this.layers[l.id] = { paint: Object.assign({}, l.paint), source: l.source }; });
    this.data = { route: [], alts: [] }; this.markers = []; this.tiles = {}; this.ev = {};
    box.innerHTML = '';
    this.world = css(document.createElement('div'), 'position:absolute;left:0;top:0;width:0;height:0;will-change:transform');
    this.tileBox = css(document.createElement('div'), 'position:absolute;left:0;top:0');
    this.canvas = css(document.createElement('canvas'), 'position:absolute;left:0;top:0;pointer-events:none');
    this.markBox = css(document.createElement('div'), 'position:absolute;left:0;top:0;width:0;height:0');
    this.labBox = css(document.createElement('div'), 'position:absolute;left:0;top:0;opacity:.85');
    this.world.appendChild(this.tileBox); this.world.appendChild(this.labBox);
    box.appendChild(this.world); box.appendChild(this.canvas); box.appendChild(this.markBox);
    this.resize();
    setTimeout(() => { this.loaded = true; this.fire('load'); this.fire('styledata'); }, 0);
  }
  const P = Map2D.prototype;
  P.on = function (t, f) { (this.ev[t] = this.ev[t] || []).push({ f }); return this; };
  P.once = function (t, f) { (this.ev[t] = this.ev[t] || []).push({ f, once: true }); if (t === 'styledata' && this.loaded) setTimeout(() => this.fire(t), 0); return this; };
  P.fire = function (t) { const l = this.ev[t] || []; this.ev[t] = l.filter(x => !x.once); l.forEach(x => { try { x.f({}); } catch (e) { console.error(e); } }); };
  P.getLayer = function (id) { return this.layers[id] || { paint: {} }; };
  P.getSource = function (id) {
    if (!(id in this.data)) return null;
    return { setData: d => { this.data[id] = (d.features || []).map(f => f.geometry.coordinates.map(p => [lon2x(p[0], 0) / TILE, lat2y(p[1], 0) / TILE])); this.draw(); } };
  };
  P.setPaintProperty = function (id, k, v) { (this.layers[id] = this.layers[id] || { paint: {} }).paint[k] = v; if (/^(route|alts)/.test(id)) this.draw(); };
  P.setLayoutProperty = function () {};
  P.setPadding = function (p) { Object.assign(this.pad, p); this.frame(); };
  P.getCenter = function () { return { lng: this.c.lon, lat: this.c.lat }; };
  P.getZoom = function () { return this.c.zoom; };
  P.getBearing = function () { return this.c.bearing; };
  P.remove = function () { cancelAnimationFrame(this.raf); this.box.innerHTML = ''; };
  P.resize = function () {
    this.w = this.box.clientWidth || 1; this.h = this.box.clientHeight || 1;
    this.rad = Math.ceil(Math.sqrt(this.w * this.w + this.h * this.h)); // rayon couvert quelle que soit la rotation
    this.layout();
  };
  // Point de l'écran où se trouve le centre de la carte (décalé par setPadding : la voiture en bas)
  P.anchor = function () { return [this.pad.left + (this.w - this.pad.left - this.pad.right) / 2, this.pad.top + (this.h - this.pad.top - this.pad.bottom) / 2]; };

  // Pose les tuiles et le tracé pour l'état courant ; entre deux poses on ne fait que déplacer le bloc
  P.layout = function () {
    const c = this.c, z = Math.max(2, Math.min(MAXZ, Math.round(c.zoom))), n = Math.pow(2, z);
    const cx = lon2x(c.lon, z), cy = lat2y(c.lat, z);
    this.ref = { z, cx, cy, zoom: c.zoom };
    const k = Math.pow(2, c.zoom - z), reach = this.rad / k + TILE;
    const x0 = Math.floor((cx - reach) / TILE), x1 = Math.floor((cx + reach) / TILE), y0 = Math.max(0, Math.floor((cy - reach) / TILE)), y1 = Math.min(n - 1, Math.floor((cy + reach) / TILE));
    const keep = {};
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const xx = ((x % n) + n) % n, key = z + '/' + xx + '/' + y + '@' + x;
      keep[key] = 1;
      let img = this.tiles[key];
      if (!img) {
        // Fond sombre Esri (sans clé) + noms de rues par-dessus ; si Esri ne répond pas : OpenStreetMap
        img = this.tiles[key] = new Image(); img.draggable = false; img.alt = '';
        const lab = img.lab = new Image(); lab.draggable = false; lab.alt = '';
        lab.onerror = () => { lab.style.visibility = 'hidden'; };
        img.onerror = () => {
          if (!img.osm) { img.osm = true; lab.style.visibility = 'hidden'; img.src = 'https://tile.openstreetmap.org/' + z + '/' + xx + '/' + y + '.png'; }
          else img.style.visibility = 'hidden'; // hors ligne : pas d'icône d'image cassée
        };
        img.src = ESRI + 'World_Dark_Gray_Base/MapServer/tile/' + z + '/' + y + '/' + xx;
        lab.src = ESRI + 'World_Dark_Gray_Reference/MapServer/tile/' + z + '/' + y + '/' + xx;
        this.tileBox.appendChild(img); this.labBox.appendChild(lab);
      }
      const pos = 'position:absolute;width:' + (TILE + 1) + 'px;height:' + (TILE + 1) + 'px;left:' + Math.round(x * TILE - cx) + 'px;top:' + Math.round(y * TILE - cy) + 'px';
      css(img, (img.style.visibility === 'hidden' ? 'visibility:hidden;' : '') + pos);
      css(img.lab, (img.lab.style.visibility === 'hidden' ? 'visibility:hidden;' : '') + pos);
    }
    for (const key in this.tiles) if (!keep[key]) { this.tiles[key].lab.remove(); this.tiles[key].remove(); delete this.tiles[key]; }
    this.frame();
  };
  // Itinéraire dessiné à la taille de l'écran (une toile aussi grande que la carte tournée coûtait
  // très cher à l'affichage) ; redessiné seulement quand la vue bouge ou que l'itinéraire change.
  P.draw = function () {
    const cv = this.canvas, W = this.w, H = this.h;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d');
    if (!this.data.route.length && !this.data.alts.length) { if (this.drawn) { g.clearRect(0, 0, W, H); this.drawn = false; } return; }
    this.drawn = true; g.clearRect(0, 0, W, H); g.lineCap = g.lineJoin = 'round';
    const c = this.c, sc = TILE * Math.pow(2, c.zoom), a = this.anchor(), th = -c.bearing / R2D, co = Math.cos(th), si = Math.sin(th);
    const cx0 = lon2x(c.lon, 0) / TILE, cy0 = lat2y(c.lat, 0) / TILE, M = 200;
    const col = (id, d) => { const v = this.getLayer(id).paint['line-color']; return typeof v === 'string' && v ? v : d; };
    const path = line => {
      g.beginPath(); let pen = false, lx = -1e9, ly = -1e9;
      for (let i = 0; i < line.length; i++) {
        const dx = (line[i][0] - cx0) * sc, dy = (line[i][1] - cy0) * sc, x = a[0] + dx * co - dy * si, y = a[1] + dx * si + dy * co;
        if (x < -M || x > W + M || y < -M || y > H + M) { if (pen) g.lineTo(x, y); pen = false; lx = x; ly = y; continue; }
        if (pen && Math.abs(x - lx) < 1.5 && Math.abs(y - ly) < 1.5 && i < line.length - 1) continue;
        if (pen) g.lineTo(x, y); else { if (lx > -1e8) { g.moveTo(lx, ly); g.lineTo(x, y); } else g.moveTo(x, y); pen = true; }
        lx = x; ly = y;
      }
    };
    g.setLineDash([10, 10]); g.globalAlpha = 0.55; g.strokeStyle = col('alts', '#888'); g.lineWidth = 5;
    this.data.alts.forEach(l => { path(l); g.stroke(); });
    g.setLineDash([]);
    this.data.route.forEach(l => {
      path(l);
      g.globalAlpha = 0.3; g.strokeStyle = col('route', '#4fe3ff'); g.lineWidth = 18; g.stroke();
      g.globalAlpha = 1; g.lineWidth = 8; g.stroke();
      g.globalAlpha = 0.9; g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
    });
    g.globalAlpha = 1;
  };
  // Applique la position courante par une simple transformation (pas de recalcul des tuiles)
  P.frame = function () {
    const r = this.ref, c = this.c; if (!r) return;
    const k = Math.pow(2, c.zoom - r.z), dx = (lon2x(c.lon, r.z) - r.cx) * k, dy = (lat2y(c.lat, r.z) - r.cy) * k, a = this.anchor();
    this.world.style.transform = 'translate(' + a[0] + 'px,' + a[1] + 'px) rotate(' + -c.bearing + 'deg) translate(' + -dx + 'px,' + -dy + 'px) scale(' + k + ')';
    this.markers.forEach(m => m.place());
    this.draw();
    if (Math.abs(dx) > TILE * 0.75 || Math.abs(dy) > TILE * 0.75 || Math.abs(c.zoom - r.zoom) > 0.35 || Math.max(2, Math.min(MAXZ, Math.round(c.zoom))) !== r.z && !this.anim) this.layout();
  };
  P.project = function (ll) {
    const c = this.c, s = Math.pow(2, c.zoom), a = this.anchor(), t = -c.bearing / R2D;
    const x = (lon2x(ll[0], 0) - lon2x(c.lon, 0)) * s, y = (lat2y(ll[1], 0) - lat2y(c.lat, 0)) * s;
    return { x: a[0] + x * Math.cos(t) - y * Math.sin(t), y: a[1] + x * Math.sin(t) + y * Math.cos(t) };
  };
  P.jumpTo = function (o) { return this.easeTo(Object.assign({}, o, { duration: 0 })); };
  P.easeTo = function (o) {
    cancelAnimationFrame(this.raf);
    const c = this.c, from = Object.assign({}, c), to = Object.assign({}, c);
    if (o.center) { to.lon = o.center[0] != null ? o.center[0] : o.center.lng; to.lat = o.center[1] != null ? o.center[1] : o.center.lat; }
    if (o.zoom != null) to.zoom = o.zoom;
    if (o.bearing != null && !isNaN(o.bearing)) to.bearing = from.bearing + ((((o.bearing - from.bearing) % 360) + 540) % 360 - 180); // plus court chemin
    const far = Math.abs(lon2x(to.lon, to.zoom) - lon2x(from.lon, to.zoom)) + Math.abs(lat2y(to.lat, to.zoom) - lat2y(from.lat, to.zoom)) > 3000;
    const dur = far ? 0 : (o.duration || 0), t0 = performance.now();
    const step = now => {
      const f = dur ? Math.min(1, (now - t0) / dur) : 1;
      ['lon', 'lat', 'zoom', 'bearing'].forEach(key => { c[key] = from[key] + (to[key] - from[key]) * f; });
      this.anim = f < 1;
      if (f < 1) { this.frame(); this.raf = requestAnimationFrame(step); } else { c.bearing = ((c.bearing % 360) + 360) % 360; this.layout(); }
    };
    step(t0);
    return this;
  };

  function Marker(o) {
    o = o || {};
    this.el = o.element || document.createElement('div'); this.anchorAt = o.anchor || 'center';
    this.wrap = css(document.createElement('div'), 'position:absolute;left:0;top:0;will-change:transform');
    this.wrap.className = 'maplibregl-marker'; this.wrap.appendChild(this.el);
  }
  Marker.prototype.setLngLat = function (ll) { this.ll = Array.isArray(ll) ? ll : [ll.lng != null ? ll.lng : ll.lon, ll.lat]; this.place(); return this; };
  Marker.prototype.getLngLat = function () { return { lng: this.ll[0], lat: this.ll[1] }; };
  Marker.prototype.getElement = function () { return this.el; };
  Marker.prototype.addTo = function (map) { this.map = map; map.markers.push(this); map.markBox.appendChild(this.wrap); this.place(); return this; };
  Marker.prototype.remove = function () { if (this.map) this.map.markers = this.map.markers.filter(m => m !== this); this.wrap.remove(); this.map = null; return this; };
  Marker.prototype.place = function () {
    if (!this.map || !this.ll) return;
    const p = this.map.project(this.ll), a = this.anchorAt;
    const ax = /left/.test(a) ? '0' : /right/.test(a) ? '-100%' : '-50%', ay = /top/.test(a) ? '0' : /bottom/.test(a) ? '-100%' : '-50%';
    this.wrap.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px) translate(' + ax + ',' + ay + ')';
  };

  window.maplibregl = { Map: Map2D, Marker, jarvis2d: true };
})();

/* ---------- rapports d'aspect (aspect-ratio n'existe pas ici) : hauteur fixée d'après la largeur ---------- */
(function () {
  const RULES = [['.bigcover', 1], ['.himg', 16 / 9], ['.gal-body figure img', 4 / 3], ['#gcircle', 1], ['.news img', 3 / 2], ['.news .noimg', 3 / 2]];
  if (window.CSS && CSS.supports && CSS.supports('aspect-ratio', '1')) return;
  const run = () => RULES.forEach(([sel, ratio]) => Array.prototype.forEach.call(document.querySelectorAll(sel), el => {
    const w = el.offsetWidth; if (!w) return;
    let h = w / ratio; const mh = parseFloat(getComputedStyle(el).maxHeight); if (mh && h > mh) h = mh;
    const px = Math.round(h) + 'px'; if (el.style.height !== px) el.style.height = px;
  }));
  addEventListener('resize', run); setInterval(run, 800);
})();
