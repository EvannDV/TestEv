/* ---------- Banc de puissance : version autoradio (remplace celle de jarvis-giulietta) ----------
   Principe : en pleine charge sur un rapport fixe, la puissance au moteur vaut
     P = (m·λ·a + ½·ρ·SCx·v² + Crr·m·g) · v / η
   - v et a viennent du RÉGIME (précis au quart de tour) divisé par le rapport tr/min ÷ km/h
     mesuré pendant le tirage ; la vitesse OBD (km/h entiers) ne sert qu'à mesurer ce rapport.
   - chaque mesure OBD est datée à l'instant où elle a été prise (milieu question/réponse),
     pas à l'instant où l'écran s'est rafraîchi ;
   - la courbe régime(temps) est lissée par régression quadratique locale avant dérivation ;
   - λ : masses tournantes (roues, transmission, moteur), selon le rapport engagé ;
   - ρ : densité de l'air réelle (pression atmosphérique et température extérieure OBD). */
const DYNO_RW = 0.31; // rayon dynamique de roue en m (205/55 R16 ou 225/45 R17)
const DYNO_LIMIT = 4900; // fin forcée de la mesure (tr/min)
const WHEEL_RPM_PER_KMH = 1000 / 60 / (2 * Math.PI * DYNO_RW);
// Facteur de masses tournantes (formule usuelle 1,04 + 0,0025·i², i = démultiplication totale)
function dynoLambda(rg) { const i = rg / WHEEL_RPM_PER_KMH; return 1.04 + 0.0025 * i * i; }
function dynoRho() { // kg/m³
  const raw = source && source.raw ? source.raw : {}, s = S();
  const p = raw['33'] ? raw['33'][0] : 101.3, t = s && s.ext != null ? s.ext : 15;
  return p * 1000 / (287.05 * (t + 273.15));
}
const dyno = { state: 'idle', run: null, last: store.get('dynoLast', null), rpm: [], spd: [], hist: store.get('dynoHist', []) };
if (!dyno.hist.length && dyno.last && dyno.last.curve) dyno.hist = [{ d: dyno.last.d, ch: dyno.last.ch, nm: dyno.last.nm, curve: dyno.last.curve }];
const median = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
// Couple au moteur (Nm) correspondant à un régime r qui monte de dr tr/min par seconde, rapport rg
function dynoTorque(r, dr, rg, rho) {
  const v = r / rg / 3.6, a = dr / rg / 3.6;
  const Fw = DYNO_M * dynoLambda(rg) * a + 0.5 * rho * DYNO_CDA * v * v + DYNO_CRR * DYNO_M * 9.81;
  return Fw * v / DYNO_EFF / (r * Math.PI / 30);
}
// Calibration de la vitesse OBD par le GPS, en roulant à vitesse stable (en tâche de fond, jamais pendant un tirage) :
// facteur = vitesse OBD ÷ vitesse GPS. Une vitesse OBD fausse de 3 % fausserait la puissance de 6 %.
const dynoCal = { f: store.get('dynoSpeedCal', []), fix: null, hist: [], n: 0 };
function dynoCalTick(s) {
  const g = typeof nav !== 'undefined' && nav.gps; if (!g || g === dynoCal.fix) return;
  dynoCal.fix = g;
  const now = performance.now();
  dynoCal.hist.push({ t: now, v: s.speed }); while (dynoCal.hist.length && now - dynoCal.hist[0].t > 4000) dynoCal.hist.shift();
  if (dyno.state === 'run' || g.spd == null || !(g.acc <= 20) || s.speed == null || s.speed < 30 || !(source instanceof ObdSource) || !source.connected) return;
  const vs = dynoCal.hist.map(h => h.v).filter(v => v != null);
  if (vs.length < 3 || Math.max(...vs) - Math.min(...vs) > 3) return; // vitesse à peu près stable
  const f = s.speed / (g.spd * 3.6); if (!(f > 0.85 && f < 1.15)) return;
  dynoCal.f.push(+f.toFixed(4)); if (dynoCal.f.length > 300) dynoCal.f.shift();
  if (++dynoCal.n % 10 === 0) store.set('dynoSpeedCal', dynoCal.f);
}
const dynoSpeedFactor = () => dynoCal.f.length >= 10 ? median(dynoCal.f) : null;
const dynoBusy = () => dyno.state === 'armed' || dyno.state === 'run';
function dynoArm() { dyno.state = 'armed'; dyno.run = null; dyno.rpm = []; dyno.spd = []; drawDyno(); }

// Une mesure datée : kind = 'rpm' (tr/min) ou 'spd' (km/h), t = performance.now() au moment de la mesure
function dynoSample(kind, val, t) {
  if (!dynoBusy() || val == null || !isFinite(val)) return;
  const a = kind === 'rpm' ? dyno.rpm : dyno.spd;
  if (a.length && t <= a[a.length - 1].t) return;
  a.push({ t, x: val });
  while (a.length && a[0].t < t - 40000) a.shift();
  if (kind === 'rpm') dynoCheck(t);
}
function dynoSlope(pts) { // tr/min par seconde, moindres carrés
  const n = pts.length; if (n < 3) return null;
  let st = 0, sx = 0, stt = 0, stx = 0; const t0 = pts[0].t;
  pts.forEach(p => { const t = (p.t - t0) / 1000; st += t; sx += p.x; stt += t * t; stx += t * p.x; });
  const den = n * stt - st * st; return den > 0 ? (n * stx - st * sx) / den : null;
}
function rpmAt(t) { // régime interpolé à l'instant t
  const R = dyno.rpm; if (!R.length || t < R[0].t || t > R[R.length - 1].t) return null;
  let lo = 0, hi = R.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (R[m].t <= t) lo = m; else hi = m; }
  const a = R[lo], b = R[hi]; return b.t === a.t ? a.x : a.x + (b.x - a.x) * (t - a.t) / (b.t - a.t);
}
function dynoRatios(t0, t1) { // rapports tr/min ÷ km/h entre t0 et t1 (vitesses de 15 km/h et plus)
  const out = [];
  dyno.spd.forEach(s => { if (s.t >= t0 && s.t <= t1 && s.x >= 15) { const r = rpmAt(s.t); if (r) out.push(r / s.x); } });
  return out;
}
function dynoCheck(now) {
  const R = dyno.rpm, last = R[R.length - 1];
  if (dyno.state === 'armed') {
    // départ : le régime monte assez vite pour un pied au plancher, quel que soit le rapport :
    // le couple qu'il faut pour cette montée dépasse 55 % du couple d'origine à ce régime
    const slope = dynoSlope(R.filter(p => p.t >= now - 900));
    if (slope == null || slope < 80 || last.x < 1000 || last.x > 3500) return;
    const rs = dynoRatios(now - 3000, now), rg = median(rs);
    if (!rg || rs.length < 2) return;
    if (dynoTorque(last.x, slope, rg, dynoRho()) < 0.55 * torqueRef(last.x)) return;
    let i = R.length - 1; // on remonte au tout début de la montée
    while (i > 0 && R[i - 1].x <= R[i].x + 15 && now - R[i - 1].t < 4000) i--;
    dyno.state = 'run'; dyno.run = { t0: R[i].t, rg, max: last.x, tMax: last.t };
    return;
  }
  if (dyno.state !== 'run') return;
  const run = dyno.run;
  if (last.x > run.max) { run.max = last.x; run.tMax = last.t; }
  const dur = now - run.t0, slope = dynoSlope(R.filter(p => p.t >= now - 700));
  const rgNow = median(dynoRatios(now - 1200, now)), shifted = rgNow && Math.abs(rgNow / run.rg - 1) > 0.08;
  if (shifted) dynoFinish('shift');
  else if (last.x < run.max - 150 || last.x >= DYNO_LIMIT || (slope != null && slope < 60 && dur > 2500) || dur > 30000) dynoFinish('');
}
function dynoTick(s) { // appelé à chaque image
  dynoCalTick(s);
  if (!dynoBusy()) return;
  const now = performance.now();
  if (!(source instanceof ObdSource)) { // simulateur : une mesure par image
    if (s.speed != null && (!dyno.spd.length || now - dyno.spd[dyno.spd.length - 1].t > 150)) dynoSample('spd', s.speed, now);
    if (s.rpm != null) dynoSample('rpm', s.rpm, now);
  } else if (dyno.state === 'run' && (!source.connected || now - dyno.rpm[dyno.rpm.length - 1].t > 2500)) dynoFinish('lost');
}
// Régime lissé et sa dérivée à l'instant u : régression quadratique locale pondérée (tricube)
function dynoSmooth(P, u) {
  let h = 0.65, sel;
  for (;;) { sel = P.filter(p => Math.abs(p.u - u) <= h); if (sel.length >= 9 || h > 2.5) break; h += 0.15; }
  if (sel.length < 4) return null;
  let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, Y0 = 0, Y1 = 0, Y2 = 0;
  sel.forEach(p => {
    const x = p.u - u, w = Math.pow(1 - Math.pow(Math.min(1, Math.abs(x) / (h * 1.01)), 3), 3);
    S0 += w; S1 += w * x; S2 += w * x * x; S3 += w * x * x * x; S4 += w * x * x * x * x;
    Y0 += w * p.r; Y1 += w * x * p.r; Y2 += w * x * x * p.r;
  });
  // résout [S0 S1 S2; S1 S2 S3; S2 S3 S4]·[c0 c1 c2] = [Y0 Y1 Y2]
  const det = (a, b, c, d, e, f, g, i, j) => a * (e * j - f * i) - b * (d * j - f * g) + c * (d * i - e * g);
  const D = det(S0, S1, S2, S1, S2, S3, S2, S3, S4); if (Math.abs(D) < 1e-12) return null;
  return { r: det(Y0, S1, S2, Y1, S2, S3, Y2, S3, S4) / D, dr: det(S0, Y0, S2, S1, Y1, S3, S2, Y2, S4) / D };
}
function dynoFinish(reason) {
  const run = dyno.run; dyno.run = null;
  const fail = msg => { dyno.state = 'armed'; dyno.rpm = []; dyno.spd = []; renderDyno(); say(msg + ' Le banc reste armé.'); };
  if (!run) return;
  if (reason === 'lost') return fail("J'ai perdu la liaison OBD pendant la mesure.");
  const pts = dyno.rpm.filter(p => p.t >= run.t0 && p.t <= run.tMax);
  const span = pts.length ? pts[pts.length - 1].x - pts[0].x : 0, dur = pts.length ? (pts[pts.length - 1].t - pts[0].t) / 1000 : 0;
  if (pts.length < 10 || span < 1200 || dur < 2) return fail(reason === 'shift'
    ? "Embrayage ou changement de rapport détecté pendant la mesure."
    : "Mesure trop courte, monsieur. Sur un même rapport, de préférence la 3e, gardez le pied au plancher de 1 500 jusqu'à 4 500 tours.");
  const rs = dynoRatios(run.t0, run.tMax), rgObd = median(rs) || run.rg, kGps = dynoSpeedFactor();
  const rg = kGps ? rgObd * kGps : rgObd; // tr/min par km/h RÉELS
  const spread = rs.length > 3 ? median(rs.map(x => Math.abs(x / rgObd - 1))) : 0;
  const T0 = pts[0].t, P = pts.map(p => ({ u: (p.t - T0) / 1000, r: p.x })), uEnd = P[P.length - 1].u;
  const rho = dynoRho(), bins = new Map();
  let floored = false; // on ignore le début tant que le pied n'est pas vraiment au plancher
  for (let u = 0.25; u <= uEnd - 0.15; u += 0.05) {
    const e = dynoSmooth(P, u); if (!e || e.dr <= 0 || e.r < 900) continue;
    const Tq = dynoTorque(e.r, e.dr, rg, rho);
    if (!floored) { if (Tq < 0.6 * torqueRef(e.r)) continue; floored = true; }
    const Pe = Tq * e.r * Math.PI / 30;
    const k = Math.round(e.r / 250) * 250, b = bins.get(k) || { ch: 0, nm: 0, n: 0 };
    b.ch += Pe / 735.5; b.nm += Pe / (e.r * Math.PI / 30); b.n++; bins.set(k, b);
  }
  const raw = [...bins.entries()].sort((a, b) => a[0] - b[0]).filter(c => c[1].n >= 2).map(([r, b]) => [r, b.ch / b.n, b.nm / b.n]);
  // lissage 1-2-1 entre paliers voisins : sans lui, le maximum d'une courbe un peu bruitée surestime le pic
  const curve = raw.map((c, i) => {
    const a = raw[i - 1], b = raw[i + 1], ok = x => x && Math.abs(x[0] - c[0]) <= 250;
    const wa = ok(a) ? 1 : 0, wb = ok(b) ? 1 : 0, W = 2 + wa + wb;
    return [c[0], (2 * c[1] + wa * (a ? a[1] : 0) + wb * (b ? b[1] : 0)) / W, (2 * c[2] + wa * (a ? a[2] : 0) + wb * (b ? b[2] : 0)) / W];
  });
  if (curve.length < 4) return fail("Je n'ai pas assez de points pour tracer la courbe. Réessayez.");
  const pk = curve.reduce((m, c) => c[1] > m[1] ? c : m), tk = curve.reduce((m, c) => c[2] > m[2] ? c : m);
  let gear = 1; for (let i = 1; i < K.length; i++) if (Math.abs(rgObd - K[i]) < Math.abs(rgObd - K[gear])) gear = i;
  dyno.last = { d: Date.now(), ch: Math.round(pk[1]), chRpm: pk[0], nm: Math.round(tk[2]), nmRpm: tk[0], gear, rg: +rg.toFixed(2), rho: +rho.toFixed(3), pts: pts.length, gps: kGps ? +kGps.toFixed(4) : null,
    ext: S().ext != null ? Math.round(S().ext) : null, spread: +spread.toFixed(4), from: Math.round(pts[0].x), to: Math.round(run.max),
    curve: curve.map(c => [c[0], +c[1].toFixed(1), +c[2].toFixed(1)]) };
  dyno.hist.unshift({ d: dyno.last.d, ch: dyno.last.ch, nm: dyno.last.nm, curve: dyno.last.curve }); dyno.hist.splice(8); store.set('dynoHist', dyno.hist);
  store.set('dynoLast', dyno.last); dyno.state = 'done'; dyno.rpm = []; dyno.spd = []; renderDyno();
  const pct = dyno.last.ch / 140, d = dyno.last;
  let txt = `Banc terminé en ${gear}e : ${d.ch} chevaux à ${d.chRpm.toLocaleString('fr-FR')} tours, et ${d.nm} newtons-mètres à ${d.nmRpm.toLocaleString('fr-FR')} tours. `;
  txt += pct > 1.1 ? "C'est au-dessus des 140 chevaux d'origine : une descente ou un vent arrière, ou bien un moteur reprogrammé ?"
    : pct >= 0.9 ? "C'est conforme aux 140 chevaux d'origine. Le moteur est en forme, monsieur."
    : pct >= 0.8 ? "Un peu en dessous des 140 chevaux. Refaites une mesure sur du plat ; si ça se confirme, pensez au filtre à air, au débitmètre ou à la vanne EGR."
    : "Nettement en dessous des 140 chevaux. Refaites une mesure sur du plat, et si ça se confirme, faites vérifier le turbo, le débitmètre, la vanne EGR et le FAP.";
  if (spread > 0.025) txt += " Attention : le rapport a varié pendant la mesure, embrayage ou patinage ? Ce résultat est moins fiable.";
  if (!kGps) txt += " Pour plus de précision, roulez quelques minutes à vitesse stable : je calerai le compteur sur le GPS.";
  if (span < 2200) txt += " La plage mesurée est courte : pour une courbe complète, partez de 1 500 et allez jusqu'à 4 500 tours.";
  say(txt);
}
