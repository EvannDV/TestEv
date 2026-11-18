// Construit giulietta/dist/index.html : l'interface de jarvis-giulietta (giulietta/src/index.html,
// copie non modifiée du dépôt d'origine) adaptée à l'autoradio TopWay.
//   node tools/port.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import babel from '@babel/core';
import * as acorn from 'acorn';
import postcss from 'postcss';
import { portCss, runtimeVars } from './css.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.dirname(HERE);
const src = fs.readFileSync(path.join(ROOT, 'giulietta/src/index.html'), 'utf8');

const cut = (open, close) => { const a = src.indexOf(open), b = src.indexOf(close, a); if (a < 0 || b < 0) throw new Error('balise introuvable ' + open); return [a, b]; };
const [s0, s1] = cut('<style>', '</style>'), [j0, j1] = cut('<script>', '</script>');
const preamble = src.slice(0, s0), css = src.slice(s0 + 7, s1), html = src.slice(s1 + 8, j0);
let js = src.slice(j0 + 8, j1);

/* ---------- retouches du code d'origine (chaque motif doit exister exactement une fois) ---------- */
const patch = (from, to) => {
  const n = js.split(from).length - 1;
  if (n !== 1) throw new Error(`retouche : motif trouvé ${n} fois : ${from.slice(0, 70)}`);
  js = js.replace(from, () => to);
};

// Carte : toujours en 2D, avec le moteur en tuiles images de shim.js
patch('const map3d = () => AI.cfg.map3d !== false;', 'const map3d = () => false;');
patch("const hasWebGL = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } };", 'const hasWebGL = () => true;');
patch('<label class="chk"><input type="checkbox" id="sMap3d">', '<label class="chk" hidden><input type="checkbox" id="sMap3d">');

// OBD : l'OBDLink CX en Bluetooth basse consommation, comme dans l'appli d'origine. Le code OBD
// d'origine passe par le Web Bluetooth (WebBleLink), fourni ici par Android (voir shim.js).
// Reconnexion automatique au dernier adaptateur, comme l'appli Android d'origine.
patch("// Appli Android : reconnexion automatique au dernier adaptateur utilisé", `if (window.JARVIS_TOPWAY && navigator.bluetooth && navigator.bluetooth.knownDevice) {
  const saved = store.get('obdDevice', null);
  if (saved && saved.id) {
    const link = new WebBleLink(); link.dev = navigator.bluetooth.knownDevice(saved.id, saved.name);
    link.id = saved.id; link.name = saved.name || 'OBD';
    link.dev.addEventListener('gattserverdisconnected', () => link.onLost && link.onLost());
    const obd = new ObdSource(link); obd.label = saved.name || 'OBD';
    adoptObd(obd); obd.startAuto();
  }
}
// Appli Android : reconnexion automatique au dernier adaptateur utilisé`);
patch(`say(hello() + (NATIVE ? " Je m'y reconnecterai tout seul aux prochains démarrages." : ''));`, `say(hello() + (NATIVE || window.JARVIS_TOPWAY ? " Je m'y reconnecterai tout seul aux prochains démarrages." : ''));`);
patch("'Le Bluetooth est bloqué dans cette prévisualisation. Il fonctionnera depuis la version installée sur la tablette.'", "(window.JARVIS_TOPWAY ? \"J'ai besoin de l'autorisation Bluetooth et de la localisation, monsieur. Acceptez-les quand Android les demande.\" : 'Le Bluetooth est bloqué dans cette prévisualisation. Il fonctionnera depuis la version installée sur la tablette.')");

// Textes : le navigateur n'est plus Chrome ; la carte vient d'Esri
patch('Autorisez la position pour ce site dans Chrome, puis touchez ici.', "Autorisez la position pour Jarvis dans les réglages Android, puis touchez ici.");
patch('Autorisez-la dans Chrome, puis touchez la carte.', 'Autorisez-la dans les réglages Android, puis touchez la carte.');
const ATTRIB = '© OpenFreeMap · OpenMapTiles · contributeurs OpenStreetMap · OSRM';
if (html.split(ATTRIB).length !== 2) throw new Error('retouche : crédit de la carte introuvable');
let outHtml = html.replace(ATTRIB, '© Esri · contributeurs OpenStreetMap · OSRM');
// nouveau panneau du banc de puissance
{
  const a = outHtml.indexOf('<div class="dyno" id="dynoBox">'), b = outHtml.indexOf('<div class="panel records">', a);
  if (a < 0 || b < 0) throw new Error('retouche : panneau du banc introuvable');
  const end = outHtml.lastIndexOf('</div>', outHtml.lastIndexOf('</div>', b) - 1); // fin de #dynoBox (avant la fermeture de .chrono)
  outHtml = outHtml.slice(0, a) + fs.readFileSync(path.join(HERE, 'dyno.html'), 'utf8').trim() + outHtml.slice(end + 6);
}

// Remplace le texte compris entre deux repères (chacun présent une seule fois)
const patchRange = (from, until, to) => {
  const i = js.indexOf(from), j = js.indexOf(until, i);
  if (i < 0 || j < 0 || js.indexOf(from, i + 1) >= 0) throw new Error('retouche : repères introuvables ' + from.slice(0, 50));
  js = js.slice(0, i) + to + js.slice(j);
};

/* ---------- un seul style (Natural), allégé pour le processeur de l'autoradio ---------- */
patch("let dna = store.get('dna', 'N');", "let dna = 'N';");
patchRange('function setDna(m, quiet) {', "document.querySelectorAll('.dna button').forEach(b => b.addEventListener", `function setDna(m, quiet) {
  if (m !== 'N' && !quiet) say("J'ai désormais un seul style d'affichage, monsieur. Il est taillé pour la fluidité.");
  dna = 'N';
  document.documentElement.dataset.dna = 'N';
  $('modeTag').textContent = DNA_INFO.N.tag;
  $('stat3l').textContent = 'Charge';
  refreshTokens(); if (typeof restyleMap === 'function') restyleMap();
}
`);
patch("mode_dna: async a => { setDna(a.mode, true); modeTransition(a.mode); return { ok: true, mode: a.mode }; },",
  "mode_dna: async a => { setDna(a.mode); return { ok: true, mode: 'N', note: \"un seul style d'affichage existe désormais\" }; },");
patch("function modeTransition(m) {", "function modeTransition(m) { return;");
patch('  fx.draw(dt, s);\n', ''); // fond animé plein écran : supprimé (deux toiles plein écran redessinées à chaque image)
patch("  if (page === 'motor') { tHolo += dt; drawHolo($('holoCar'), tHolo, { zones: true, labels: true }); }",
  // voiture 3D : vue de trois quarts fixe, redessinée une fois par seconde (couleurs des zones)
  "  if (page === 'motor') { holoAcc += dt; if (holoAcc >= 1 || holoFirst) { holoAcc = 0; holoFirst = false; drawHolo($('holoCar'), 0, { zones: true, labels: true }); } } else holoFirst = true;");
patch("let last = performance.now(), sparkAcc = 0,", "let holoAcc = 0, holoFirst = true;\nlet last = performance.now(), sparkAcc = 0,");
// Taille des toiles : mesurée une fois puis gardée (la mesurer à chaque image force un recalcul de toute la page)
patch(`function fitCanvas(c) {
  const dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;`, `const fitCache = new WeakMap(); let fitEpoch = 0;
addEventListener('resize', () => fitEpoch++); document.addEventListener('click', () => fitEpoch++, true);
function fitCanvas(c) {
  let fm = fitCache.get(c); const fnow = performance.now();
  if (!fm || fm.e !== fitEpoch || !fm.w || !fm.h || fnow - fm.t > 2000) { fm = { w: c.clientWidth, h: c.clientHeight, e: fitEpoch, t: fnow }; fitCache.set(c, fm); }
  const dpr = devicePixelRatio || 1, w = fm.w, h = fm.h;`);

/* ---------- banc de puissance : mesures datées, régime prioritaire, calcul revu (tools/dyno.js) ---------- */
patch("const DYNO_M = 1475, DYNO_CDA = 0.61, DYNO_CRR = 0.012, DYNO_EFF = 0.85;",
  "const DYNO_M = 1475, DYNO_CDA = 0.61, DYNO_CRR = 0.012, DYNO_EFF = 0.90; // rendement de transmission seul : roulement et masses tournantes sont comptés à part");
patch("if (dyno.run && dyno.run.pts.length) { const r = dyno.run.pts[dyno.run.pts.length - 1].rpm;", "if (dyno.run && dyno.rpm.length) { const r = dyno.rpm[dyno.rpm.length - 1].x;");
patchRange("const dyno = { state: 'idle', run: null, last: store.get('dynoLast', null) };", 'function drawDyno() {', fs.readFileSync(path.join(HERE, 'dyno.js'), 'utf8') + '\n');
patch(`    if (!this.sup.has(pid)) return;
    const b = this.parse(await this.cmd('01' + pid), pid); if (!b) return;
    this.raw[pid] = b;`, `    if (!this.sup.has(pid)) return;
    const tQ = performance.now(), b = this.parse(await this.cmd('01' + pid), pid); if (!b) return;
    this.raw[pid] = b;
    const tM = (tQ + performance.now()) / 2; // instant de la mesure : milieu entre la question et la réponse
    if (pid === '0C' && b.length >= 2) dynoSample('rpm', (b[0] * 256 + b[1]) / 4, tM);
    if (pid === '0D') dynoSample('spd', b[0], tM);`);
patch("while (this.connected) { for (const p of FAST) await this.read(p); await this.read(SLOW[this.slowI++ % SLOW.length]); }",
  "while (this.connected) {\n      if (dynoBusy()) { await this.read('0C'); this.dynI = (this.dynI || 0) + 1; if (this.dynI % 3 === 0) await this.read('0D'); continue; } // banc : régime en priorité\n      for (const p of FAST) await this.read(p); await this.read(SLOW[this.slowI++ % SLOW.length]);\n    }");
// Simulateur (démo) : même physique que le calcul, masses tournantes comprises
patch("const am = (Pw / v - 0.5 * 1.2 * DYNO_CDA * v * v - DYNO_CRR * DYNO_M * 9.81) / DYNO_M;",
  "const am = (Pw / v - 0.5 * 1.2 * DYNO_CDA * v * v - DYNO_CRR * DYNO_M * 9.81) / (DYNO_M * dynoLambda(K[3]));");

/* ---------- nouveau design : cadrans et banc ---------- */
patchRange('function gtDial(svg, max, step, red, unit, withBig) {', "$('spdTrack').setAttribute", fs.readFileSync(path.join(HERE, 'dials.js'), 'utf8') + '\n');
patchRange('function drawDyno() {', "$('dyArm').addEventListener", fs.readFileSync(path.join(HERE, 'dynoui.js'), 'utf8') + '\n');
// le banc occupe toute la page Perf : le G-mètre (caché) ne se dessine plus en mode banc
patch("const c = $('gcircle'); if (!c || page !== 'perf') return;", "const c = $('gcircle'); if (!c || page !== 'perf' || perf.mode === 'banc') return;");
/* ---------- conversion pour le vieux moteur web ---------- */
const report = [];
const oneStyle = postcss.parse(css);
const otherMode = sel => /\[data-dna="[DA]"\]/.test(sel.replace(/:not\([^)]*\)/g, '')) || /\.modefx|\.mf-/.test(sel);
oneStyle.walkRules(r => {
  if (r.parent && r.parent.type === 'atrule' && /keyframes/.test(r.parent.name)) return;
  const keep = r.selectors.filter(x => !otherMode(x));
  if (!keep.length) r.remove(); else if (keep.length !== r.selectors.length) r.selectors = keep;
});
oneStyle.walkDecls(/^(-webkit-)?backdrop-filter$/, d => d.remove());
oneStyle.append(fs.readFileSync(path.join(HERE, 'theme.css'), 'utf8'));
oneStyle.append('.panel,.top,.controls{contain:layout style}#fxBack,#fxFront,.dna,#modeFx{display:none!important}.ring,.core i:nth-child(1),.holo::before{animation:none!important}');
const ported = portCss(oneStyle.toString(), report);
let outCss = ported.css
  .replace('width:min(86%,340px)', 'width:86%;max-width:340px')
  .replace('.set label.chk{flex-direction:row;align-items:center;gap:10px;', '.set label.chk>*+*{margin-left:10px}.set label.chk{flex-direction:row;align-items:center;')
  .replace(/place-items:\s*([^;}]+)/g, 'align-items:$1;justify-items:$1')
  .replace(/place-content:\s*([^;}]+)/g, 'align-content:$1;justify-content:$1')
  .replace(/padding-block:\s*([^;}]+)/g, 'padding-top:$1;padding-bottom:$1');
for (const bad of ['inset:', 'place-items', 'clamp(', 'padding-block']) if (outCss.includes(bad)) report.push('RESTE dans le CSS : ' + bad);

const shim = fs.readFileSync(path.join(HERE, 'shim.js'), 'utf8');
const outJs = babel.transformSync(shim + '\n' + js, {
  babelrc: false, configFile: false, sourceType: 'script', compact: false, comments: false,
  presets: [[path.join(HERE, 'node_modules/@babel/preset-env'), { targets: { chrome: '58' }, modules: false, bugfixes: true }]]
}).code;
acorn.parse(outJs, { ecmaVersion: 2017 }); // échoue si une syntaxe trop récente a survécu

const page = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#02070c">
<style>body{margin:0}[hidden]{display:none!important}</style>
<script>
${runtimeVars(ported.exprs)}
</script>
</head>
<body>
${preamble}<style>${outCss}</style>${outHtml}<script>
${outJs.replace(/<\/script/g, '<\\/script')}
</script>
</body>
</html>
`;
fs.mkdirSync(path.join(ROOT, 'giulietta/dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'giulietta/dist/index.html'), page);
console.log(`giulietta/dist/index.html : ${(page.length / 1024).toFixed(0)} Ko`);
// Page témoin (CSS et code d'origine, même enveloppe) pour comparer la mise en page dans un navigateur récent
if (process.argv[2] === '--temoin') fs.writeFileSync(process.argv[3], `<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>\n${src}\n</body></html>`);
const ignore = /MANUEL \.map-msg|GAP sans display connu : \.set label\.chk/;
for (let i = report.length - 1; i >= 0; i--) if (ignore.test(report[i])) report.splice(i, 1); // traités à la main ci-dessus
if (report.length) console.log('À vérifier :\n  ' + report.join('\n  '));
