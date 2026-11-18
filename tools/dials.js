/* ---------- Cadrans de la page Conduite (version autoradio) ----------
   Arc lumineux qui suit la valeur + grand chiffre au centre + aiguille courte sur le bord.
   Même interface que l'original : gtDial(svg, max, pas, zone rouge, unité, ...) -> { set(v, grand, sous-titre, alerte) } */
function gtDial(svg, max, step, red, unit) {
  const ang = v => A0 + SW * v / max, P = (a, r) => [235 + r * Math.cos(a * Math.PI / 180), 235 + r * Math.sin(a * Math.PI / 180)];
  const arcD = (r, a0, a1) => { const [x0, y0] = P(a0, r), [x1, y1] = P(a1, r); return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
  const id = svg.id;
  let h = `<defs>
      <radialGradient id="${id}F" cx="50%" cy="40%" r="64%"><stop offset="0" stop-color="#122030"/><stop offset=".72" stop-color="#090f16"/><stop offset="1" stop-color="#05080c"/></radialGradient>
      <linearGradient id="${id}G" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#1c7fb8"/><stop offset="1" stop-color="#9be9ff"/></linearGradient>
    </defs>
    <circle cx="235" cy="235" r="228" fill="url(#${id}F)" stroke="rgba(120,200,255,.16)" stroke-width="1.5"/>
    <circle cx="235" cy="235" r="216" fill="none" stroke="rgba(120,200,255,.06)" stroke-width="1"/>
    <path d="${arcD(204, A0, A0 + SW)}" fill="none" stroke="#122130" stroke-width="13" stroke-linecap="round"/>`;
  if (red) h += `<path d="${arcD(204, ang(red), A0 + SW)}" fill="none" stroke="rgba(255,84,104,.45)" stroke-width="13"/>`;
  h += `<path class="gt-arc" d="${arcD(204, A0, A0 + SW)}" pathLength="1000" fill="none" stroke="url(#${id}G)" stroke-width="13" stroke-linecap="round" stroke-dasharray="0 1000"/>`;
  for (let i = 0; i <= max / step * 5; i++) {
    const v = i * step / 5, major = i % 5 === 0, [x0, y0] = P(ang(v), 186), [x1, y1] = P(ang(v), major ? 170 : 180);
    const col = red && v >= red ? '#ff5468' : major ? '#d8e7f2' : '#34495a';
    h += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="${col}" stroke-width="${major ? 3 : 1.4}" stroke-linecap="round"/>`;
    if (major) { const [tx, ty] = P(ang(v), 146); h += `<text class="gt-num" x="${tx.toFixed(1)}" y="${ty.toFixed(1)}">${max > 1000 ? v / 1000 : v}</text>`; }
  }
  h += `<text class="gt-big" x="235" y="262">–</text><text class="gt-unit" x="235" y="294">${unit}</text><text class="gt-sub" x="235" y="340"></text>
    <g class="gt-needle" style="transform:rotate(${A0}deg)"><line x1="352" y1="235" x2="414" y2="235" stroke="#f4fbff" stroke-width="5" stroke-linecap="round"/></g>`;
  svg.innerHTML = h;
  const needle = svg.querySelector('.gt-needle'), big = svg.querySelector('.gt-big'), sub = svg.querySelector('.gt-sub'), arcEl = svg.querySelector('.gt-arc');
  let lastDash = '';
  return {
    set(v, bigTxt, subTxt, over) {
      const f = clamp(v || 0, 0, max) / max, dash = (f * 1000).toFixed(0) + ' 1000';
      if (dash !== lastDash) { lastDash = dash; arcEl.setAttribute('stroke-dasharray', dash); needle.style.transform = `rotate(${ang(f * max).toFixed(1)}deg)`; }
      arcEl.classList.toggle('hot', !!(red && v >= red));
      if (big.textContent !== bigTxt) { big.textContent = bigTxt; big.classList.toggle('none', bigTxt === 'NONE' || bigTxt === '–'); }
      if (sub.textContent !== subTxt) sub.textContent = subTxt;
      sub.classList.toggle('over', !!over);
    }
  };
}
const gtRpm = gtDial($('gtRpm'), 5000, 1000, 4500, 'RAPPORT');
const gtSpd = gtDial($('gtSpd'), 220, 20, 0, 'KM/H');
function gtUpdate(s) {
  const g = s.gear;
  gtRpm.set(s.rpm, s.rpm == null ? 'NONE' : g == null ? '–' : g === 0 ? 'N' : String(g),
    s.rpm == null ? '' : (Math.round(s.rpm / 10) * 10).toLocaleString('fr-FR') + ' tr/min');
  const lim = SL.limit;
  gtSpd.set(s.speed, s.speed == null ? 'NONE' : String(Math.round(s.speed)), lim ? 'Limite ' + lim : '', lim && s.speed > lim + 3);
  $('gtCons').innerHTML = $('cons').innerHTML;
  $('gtRange').innerHTML = $('range').innerHTML;
  $('gtTemp').textContent = s.oil == null || s.coolant == null ? 'NONE' : `${fr(s.oil)}° · ${fr(s.coolant)}°`;
}
