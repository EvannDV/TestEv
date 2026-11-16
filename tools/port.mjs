// Construit giulietta/dist/index.html : l'interface de jarvis-giulietta (giulietta/src/index.html,
// copie non modifiée du dépôt d'origine) adaptée à l'autoradio TopWay.
//   node tools/port.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import babel from '@babel/core';
import * as acorn from 'acorn';
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

// Source de données : le bus CAN de l'autoradio à la place de l'OBD Bluetooth
patch('class NoneSource {', fs.readFileSync(path.join(HERE, 'cansource.js'), 'utf8') + '\nclass NoneSource {');
patch("$('obdBtn').textContent = live ?", "$('obdBtn').textContent = source instanceof CanSource ? source.badge() : live ?");
patch("$('obdBtn').addEventListener('click', async () => {", "$('obdBtn').addEventListener('click', async () => {\n  if (window.JARVIS_TOPWAY) { window.Android.menu(); return; }");
patch("// Appli Android : reconnexion automatique au dernier adaptateur utilisé", `if (window.JARVIS_TOPWAY) {
  const can = window.JARVIS_CAN = new CanSource();
  adoptObd(can);
  can.onLost = () => { setObdUi(); say('Je ne reçois plus rien du bus CAN, monsieur.'); };
  can.onBack = () => { const first = !can.everConnected; can.everConnected = true; setObdUi(); say(first ? \`Liaison établie avec le bus CAN de l'autoradio. \${can.sup.size} données disponibles.\` : 'Liaison CAN rétablie.'); };
  setInterval(setObdUi, 2000);
}
// Appli Android : reconnexion automatique au dernier adaptateur utilisé`);
patch('source = source === sim ? none : sim; setObdUi();', 'source = source === sim ? (window.JARVIS_CAN || none) : sim; setObdUi();');

// Textes : la liaison est le CAN, plus l'OBD ; le navigateur n'est plus Chrome ; la carte vient de CARTO
const CAN_TXT = "source instanceof CanSource ? (source.connected ? 'bus CAN de l\\'autoradio connecté' : 'bus CAN de l\\'autoradio, aucune donnée reçue pour l\\'instant') : ";
patch("source: source === sim ? 'simulation (données de démonstration)' : source instanceof ObdSource ? ", "source: source === sim ? 'simulation (données de démonstration)' : " + CAN_TXT + "source instanceof ObdSource ? ");
patch("const src = source === sim ? 'simulation' : source instanceof ObdSource ? ", "const src = source === sim ? 'simulation' : " + CAN_TXT + "source instanceof ObdSource ? ");
patch("source === sim ? 'Démo' : source instanceof ObdSource && source.connected ? 'OBD connecté' : 'OBD en attente'", "source === sim ? 'Démo' : source instanceof CanSource ? (source.connected ? 'CAN connecté' : 'CAN en attente') : source instanceof ObdSource && source.connected ? 'OBD connecté' : 'OBD en attente'");
patch('Autorisez la position pour ce site dans Chrome, puis touchez ici.', "Autorisez la position pour Jarvis dans les réglages Android, puis touchez ici.");
patch('Autorisez-la dans Chrome, puis touchez la carte.', 'Autorisez-la dans les réglages Android, puis touchez la carte.');
const ATTRIB = '© OpenFreeMap · OpenMapTiles · contributeurs OpenStreetMap · OSRM';
if (html.split(ATTRIB).length !== 2) throw new Error('retouche : crédit de la carte introuvable');
const outHtml = html.replace(ATTRIB, '© CARTO · contributeurs OpenStreetMap · OSRM');

/* ---------- conversion pour le vieux moteur web ---------- */
const report = [];
const ported = portCss(css, report);
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
