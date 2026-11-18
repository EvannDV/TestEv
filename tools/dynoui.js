/* ---------- Banc de puissance : affichage (version autoradio) ----------
   Courbes redessinées seulement quand les données changent ; pendant la mesure, seul un
   curseur (un simple trait HTML) bouge, la toile n'est pas redessinée. */
const DY = { sig: '', plot: null, cursor: null };
const DY_X0 = 1000, DY_X1 = 5000, DY_CH = 180, DY_NM = 400;
function drawDyno() {
  const c = $('dyCanvas'); if (!c || page !== 'perf' || perf.mode !== 'banc') return;
  const { ctx, w, h } = fitCanvas(c); if (!w || !h) return;
  ctx.clearRect(0, 0, w, h);
  const L = 44, R = 50, Tp = 12, B = 24, pw = w - L - R, ph = h - Tp - B;
  const X = r => L + (r - DY_X0) / (DY_X1 - DY_X0) * pw, Yc = ch => Tp + (1 - ch / DY_CH) * ph, Yn = nm => Tp + (1 - nm / DY_NM) * ph;
  DY.plot = { L, pw, w };
  // grille
  ctx.lineWidth = 1; ctx.font = '500 10px "JetBrains Mono", monospace';
  for (let r = DY_X0; r <= DY_X1; r += 500) {
    ctx.strokeStyle = r % 1000 ? 'rgba(120,190,240,.05)' : 'rgba(120,190,240,.10)';
    ctx.beginPath(); ctx.moveTo(X(r) + .5, Tp); ctx.lineTo(X(r) + .5, Tp + ph); ctx.stroke();
    if (r % 1000 === 0) { ctx.fillStyle = '#7d93a6'; ctx.textAlign = 'center'; ctx.fillText((r / 1000) + ' 000', X(r), h - 6); }
  }
  for (let k = 0; k <= 4; k++) {
    const ch = DY_CH * k / 4, y = Math.round(Yc(ch)) + .5;
    ctx.strokeStyle = 'rgba(120,190,240,.08)'; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillStyle = '#5cd0ff'; ctx.fillText(ch + ' ch', L - 6, y + 3);
    ctx.textAlign = 'left'; ctx.fillStyle = '#ffb24a'; ctx.fillText(Math.round(DY_NM * k / 4) + ' Nm', L + pw + 6, y + 3);
  }
  const line = (pts, y, col, wd, dash) => {
    ctx.strokeStyle = col; ctx.lineWidth = wd; ctx.setLineDash(dash || []); ctx.lineJoin = 'round'; ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(X(p[0]), y(p)) : ctx.moveTo(X(p[0]), y(p))); ctx.stroke(); ctx.setLineDash([]);
  };
  // courbes d'origine (approximatives) en pointillés
  const ref = []; for (let r = 1000; r <= 4800; r += 100) ref.push([r, torqueRef(r) * r * Math.PI / 30 / 735.5, torqueRef(r)]);
  line(ref, p => Yc(p[1]), 'rgba(92,208,255,.35)', 1.5, [5, 4]); line(ref, p => Yn(p[2]), 'rgba(255,178,74,.35)', 1.5, [5, 4]);
  const d = dyno.last, prev = dyno.hist[1];
  if (prev && prev.curve && d) { line(prev.curve, p => Yc(p[1]), 'rgba(231,243,251,.22)', 1.5); line(prev.curve, p => Yn(p[2]), 'rgba(231,243,251,.16)', 1.5); }
  if (!d || !d.curve) {
    ctx.fillStyle = '#7d93a6'; ctx.font = '15px "Saira Semi Condensed", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Aucune mesure pour l\'instant : armez le banc, puis faites un tirage.', L + pw / 2, Tp + ph / 2);
    return;
  }
  // puissance : surface dégradée sous la courbe, puis trait
  const g = ctx.createLinearGradient(0, Tp, 0, Tp + ph); g.addColorStop(0, 'rgba(92,208,255,.22)'); g.addColorStop(1, 'rgba(92,208,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(X(d.curve[0][0]), Tp + ph);
  d.curve.forEach(p => ctx.lineTo(X(p[0]), Yc(p[1]))); ctx.lineTo(X(d.curve[d.curve.length - 1][0]), Tp + ph); ctx.closePath(); ctx.fill();
  line(d.curve, p => Yn(p[2]), '#ffb24a', 2.5);
  line(d.curve, p => Yc(p[1]), '#5cd0ff', 3);
  // pics avec leur valeur
  const tag = (x, y, txt, col, up) => {
    ctx.font = '600 12px "Chakra Petch", sans-serif'; const tw = ctx.measureText(txt).width + 12, ty = up ? y - 26 : y + 10;
    const tx = clamp(x - tw / 2, L, L + pw - tw);
    ctx.fillStyle = 'rgba(5,8,12,.88)'; ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(tx, ty, tw, 18); ctx.fill(); ctx.stroke();
    ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.fillText(txt, tx + tw / 2, ty + 13);
    ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 7); ctx.fillStyle = '#05080c'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = col; ctx.stroke();
  };
  const xc = X(d.chRpm), yc = Yc(d.ch), xn = X(d.nmRpm), yn = Yn(d.nm);
  tag(xn, yn, `${d.nm} Nm · ${d.nmRpm.toLocaleString('fr-FR')}`, '#ffb24a', yn < yc + 30 && Math.abs(xn - xc) < 120 ? false : true);
  tag(xc, yc, `${d.ch} ch · ${d.chRpm.toLocaleString('fr-FR')}`, '#5cd0ff', true);
}
function dyFmtDate(t) { return new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }); }
function renderDyno() {
  const s = S(), d = dyno.last, st = dyno.state, busy = st === 'armed' || st === 'run';
  // 1. ce qui bouge en permanence
  const rpm = s.rpm, gear = dyno.run ? (() => { let g = 1; for (let i = 1; i < K.length; i++) if (Math.abs(dyno.run.rg - K[i]) < Math.abs(dyno.run.rg - K[g])) g = i; return g; })() : s.gear;
  $('dyChip').dataset.s = st === 'run' ? 'run' : st === 'armed' ? 'armed' : d ? 'done' : 'idle';
  $('dyChip').textContent = st === 'run' ? 'MESURE' : st === 'armed' ? 'ARMÉ' : d ? 'TERMINÉ' : 'PRÊT';
  const sources = source instanceof ObdSource && source.connected || source === sim;
  $('dyState').textContent = st === 'run' ? 'Mesure en cours : gardez le pied au plancher.'
    : st === 'armed' ? (sources ? 'Banc armé : suivez les étapes ci-dessous.' : 'Banc armé, mais l\'OBD n\'est pas connecté.')
    : d ? `Dernière mesure le ${dyFmtDate(d.d)}, en ${d.gear || 3}e.` : 'Armez le banc, puis faites un tirage en 3e.';
  $('dyArm').textContent = busy ? 'Annuler' : 'Armer le banc';
  $('dyLive').hidden = !busy; $('dyRes').hidden = busy;
  if (busy) {
    $('dyRpm').textContent = rpm == null ? '--' : (Math.round(rpm / 10) * 10).toLocaleString('fr-FR');
    $('dySpd').textContent = s.speed == null ? '--' : Math.round(s.speed);
    $('dyGear').textContent = gear == null ? '–' : gear === 0 ? 'N' : gear;
    $('dyBar').style.width = (clamp(((rpm || 0) - 1500) / 3000, 0, 1) * 100).toFixed(1) + '%';
    const ready = st === 'run' || (rpm > 1100 && rpm < 2300 && gear >= 2 && gear <= 4 && s.speed > 15);
    const steps = $('dySteps').children, cls = [
      'done',
      st === 'run' || ready ? 'done' : 'on',
      st === 'run' ? (rpm > 4000 ? 'done' : 'on') : ready ? 'on' : '',
      st === 'run' && rpm > 4000 ? 'on' : ''];
    for (let i = 0; i < 4; i++) if (steps[i].className !== cls[i]) steps[i].className = cls[i];
  }
  // curseur de régime sur le graphique pendant la mesure
  const cur = DY.cursor || (DY.cursor = (() => { const e = document.createElement('div'); e.className = 'dy-cursor'; e.hidden = true; $('dyCanvas').parentNode.appendChild(e); return e; })());
  const showCur = st === 'run' && rpm != null && DY.plot;
  cur.hidden = !showCur;
  if (showCur) cur.style.left = (DY.plot.L + clamp((rpm - DY_X0) / (DY_X1 - DY_X0), 0, 1) * DY.plot.pw).toFixed(1) + 'px';
  // 2. ce qui ne change qu'à la fin d'une mesure (et la taille de la toile)
  const c = $('dyCanvas'), sig = [d ? d.d : 0, dyno.hist.length, c.clientWidth, c.clientHeight].join('|');
  if (sig === DY.sig) return;
  DY.sig = sig;
  drawDyno();
  $('dyLgPrev').hidden = !(d && dyno.hist[1]);
  if (!d) {
    $('dyCh').innerHTML = '--'; $('dyNm').innerHTML = '--'; $('dyChAt').textContent = ''; $('dyNmAt').textContent = '';
    $('dyVerdict').hidden = true; $('dyCmp').textContent = ''; $('dyCond').innerHTML = ''; $('dyHist').innerHTML = '';
    return;
  }
  $('dyCh').innerHTML = `${d.ch}<small>ch</small>`; $('dyChAt').textContent = `à ${d.chRpm.toLocaleString('fr-FR')} tr/min`;
  $('dyNm').innerHTML = `${d.nm}<small>Nm</small>`; $('dyNmAt').textContent = `à ${d.nmRpm.toLocaleString('fr-FR')} tr/min`;
  const pct = d.ch / 140, v = pct > 1.1 ? 'high' : pct >= 0.9 ? 'ok' : pct >= 0.8 ? 'low' : 'bad';
  $('dyVerdict').hidden = false; $('dyVerdict').dataset.v = v;
  $('dyPct').textContent = Math.round(pct * 100) + ' %';
  $('dyVerdictTxt').textContent = { high: 'Au-dessus des 140 ch d\'origine : pente, vent ou moteur reprogrammé ?', ok: 'Conforme aux 140 ch d\'origine', low: 'Un peu en dessous de l\'origine : refaites un passage sur du plat', bad: 'Nettement en dessous : refaites un passage, puis faites vérifier' }[v];
  const prev = dyno.hist[1];
  if (prev) {
    const dc = d.ch - prev.ch, dn = d.nm - prev.nm, sg = x => (x > 0 ? '+' : x < 0 ? '−' : '±') + Math.abs(x);
    $('dyCmp').textContent = `${sg(dc)} ch et ${sg(dn)} Nm par rapport au ${dyFmtDate(prev.d)}`;
  } else $('dyCmp').textContent = 'Première mesure enregistrée.';
  const rel = d.spread == null ? null : d.spread < 0.015 && (d.to - d.from) >= 2500 && d.gps ? ['Bonne', 'good'] : d.spread < 0.025 && (d.to - d.from) >= 1800 ? ['Moyenne', ''] : ['Faible', 'warn'];
  const row = (k, val, cl) => `<dt>${k}</dt><dd class="${cl || ''}">${val}</dd>`;
  $('dyCond').innerHTML =
    row('Rapport', (d.gear || '?') + 'e') + row('Plage', d.from ? `${(Math.round(d.from / 100) * 100).toLocaleString('fr-FR')}–${(Math.round(d.to / 100) * 100).toLocaleString('fr-FR')}` : '--') +
    row('Air', d.ext != null ? d.ext + ' °C' : '--') + row('Mesures', d.pts || '--') +
    row('Compteur', d.gps ? `calé GPS (${d.gps > 1 ? '+' : '−'}${fr(Math.abs(d.gps - 1) * 100, 1)} %)` : 'non calé', d.gps ? 'good' : 'warn') +
    row('Fiabilité', rel ? rel[0] : '--', rel ? rel[1] : '');
  $('dyHist').innerHTML = dyno.hist.slice(0, 6).map((x, i) => `<i class="${i === 0 ? 'cur' : ''}">${dyFmtDate(x.d)} · ${x.ch} ch</i>`).join('');
}
