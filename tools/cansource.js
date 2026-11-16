/* ---------- Source CAN : données du boîtier CAN de l'autoradio TopWay ----------
   L'appli Android transmet chaque trame reçue : onCanFrame(what, type, octets en hexadécimal).
   CAN_DECODERS traduit les trames connues en valeurs ({ speed, rpm, coolant, ... }).
   Tant qu'une valeur n'arrive pas par le CAN, elle reste à NONE (rien n'est inventé).
   Hérite d'ObdSource pour que tout le reste de Jarvis (mécano, perf, banc...) la traite pareil. */
const CAN_DECODERS = {
  // '0501:26': b => ({ ... })   // clé = canal:type en hexadécimal ; à remplir d'après les captures sur la voiture
};
const CAN_PID = { speed: '0D', rpm: '0C', load: '04', boost: '0B', coolant: '05', oil: '5C', batt: '42', ext: '46', fuel: '2F', lph: '5E' };
class CanSource extends ObdSource {
  constructor() {
    super({ name: 'CAN TopWay' });
    this.label = 'CAN TopWay'; this.v = {}; this.frames = 0; this.tFeed = 0; this.everConnected = false;
    window.onCar = d => this.feed(d);
    window.onCanFrame = (what, type, hex) => {
      this.frames++;
      const dec = CAN_DECODERS[what.toString(16).toUpperCase().padStart(4, '0') + ':' + type.toString(16).toUpperCase().padStart(2, '0')];
      if (!dec) return;
      const d = dec((hex.match(/../g) || []).map(x => parseInt(x, 16)));
      if (d) this.feed(d);
    };
  }
  connect() { return Promise.resolve(); }
  open() { return Promise.resolve(); }
  startAuto() {} retry() {} lostLink() {} loop() {}
  readDtcs() { return Promise.reject(new Error("les codes défaut ne passent pas par le bus CAN de l'autoradio")); }
  badge() { return this.connected ? 'CAN · en ligne' : this.frames ? `CAN · ${this.frames} trames, non décodé` : 'CAN · en attente'; }
  feed(d) {
    const now = performance.now();
    if (d.speed != null) { if (this.tS) this.accRaw = (d.speed - this.vS) / Math.max(0.05, (now - this.tS) / 1000); this.vS = d.speed; this.tS = now; }
    Object.assign(this.v, d); this.tFeed = now;
    for (const k in d) if (CAN_PID[k] && d[k] != null) this.sup.add(CAN_PID[k]);
    if (!this.connected) { this.connected = true; this.lost = false; if (this.onBack) this.onBack(); }
  }
  step(dt) {
    const s = this.s, v = this.v, k = Math.min(1, dt * 8);
    if (this.connected && performance.now() - this.tFeed > 6000) { // plus de trames utiles : contact coupé
      this.connected = false; this.v = {}; this.accRaw = 0; this.tS = 0;
      Object.assign(s, { speed: null, rpm: null, gear: null, boost: null, coolant: null, oil: null, batt: null, soot: null, load: null, lph: null, ext: null, accel: 0, fuel: null });
      if (this.onLost) this.onLost();
    }
    if (!this.connected) return s;
    for (const f of ['speed', 'rpm']) s[f] = v[f] == null ? null : s[f] == null ? v[f] : s[f] + (v[f] - s[f]) * k;
    s.accel += (this.accRaw - s.accel) * Math.min(1, dt * 4);
    for (const f of ['boost', 'load', 'coolant', 'oil', 'batt', 'ext', 'fuel', 'soot']) s[f] = v[f] != null ? v[f] : null;
    s.lph = v.lph != null ? v.lph : null;
    if (v.gear != null) s.gear = v.gear;
    else if (s.speed == null || s.rpm == null) s.gear = null;
    else if (s.speed < 3) s.gear = 0;
    else { let best = 1; for (let g = 1; g < K.length; g++) if (Math.abs(s.rpm / s.speed - K[g]) < Math.abs(s.rpm / s.speed - K[best])) best = g; s.gear = best; }
    return s;
  }
}
