// Réécrit le CSS de jarvis-giulietta pour un vieux WebView Android (Chrome ~58-78) :
// pas de `inset`, pas de `gap` en flexbox, pas de min()/max()/clamp(), pas de aspect-ratio.
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';

const SIDES = ['top', 'right', 'bottom', 'left'];

// Découpe "a, b" en sélecteurs simples (sans tenir compte des virgules entre parenthèses)
const splitSel = s => {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++; if (ch === ')') depth--;
    if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};
// Sélecteur sans les préfixes de mode (":root[data-dna=...] .x" -> ".x") pour retrouver le display de base
const baseSel = s => s.replace(/^(:root|html|body)(\[[^\]]*\]|\.[\w-]+)*\s+/, '').trim();

export function portCss(css, report) {
  const root = postcss.parse(css);
  const exprs = []; // expressions min/max/clamp calculées au lancement, en px
  const info = {}; // sélecteur -> { display, dir, wrap }
  const note = (sel, k, v) => { for (const s of splitSel(sel)) for (const key of new Set([s, baseSel(s)])) (info[key] = info[key] || {})[k] = v; };

  root.walkDecls(d => {
    if (d.parent.type !== 'rule') return;
    const sel = d.parent.selector;
    if (d.prop === 'display') note(sel, 'display', d.value.replace(/\s*!important/, ''));
    if (d.prop === 'flex-direction') note(sel, 'dir', d.value);
    if (d.prop === 'flex-wrap') note(sel, 'wrap', d.value);
    if (d.prop === 'flex-flow') { if (/column/.test(d.value)) note(sel, 'dir', 'column'); if (/wrap/.test(d.value)) note(sel, 'wrap', 'wrap'); }
  });
  const lookup = (sel, k, own) => {
    if (own[k]) return own[k];
    for (const s of splitSel(sel)) for (const key of [s, baseSel(s)]) if (info[key] && info[key][k]) return info[key][k];
    // à défaut : le dernier élément du sélecteur (".navp .turn" -> ".turn", "label.chk" -> ".chk")
    for (const s of splitSel(sel)) {
      const last = s.split(/[\s>+~]+/).pop();
      for (const key of [last, last.replace(/^[a-z]+(?=[.#])/, '')]) if (info[key] && info[key][k]) return info[key][k];
    }
    return null;
  };

  root.walkRules(rule => {
    if (rule._gen) return; // règle ajoutée par ce script
    const own = {};
    rule.each(d => {
      if (d.type !== 'decl') return;
      if (d.prop === 'display') own.display = d.value;
      if (d.prop === 'flex-direction') own.dir = d.value;
      if (d.prop === 'flex-wrap') own.wrap = d.value;
    });
    const extra = [];
    rule.each(d => {
      if (d.type !== 'decl') return;

      // inset: a b c d
      if (d.prop === 'inset') {
        const v = postcss.list.space(d.value);
        const [t, r = t, b = t, l = r] = v;
        [t, r, b, l].forEach((x, i) => d.cloneBefore({ prop: SIDES[i], value: x }));
        d.remove(); return;
      }
      // max(16px, env(...)) : pas d'encoche sur l'autoradio
      d.value = d.value.replace(/max\((\d+px),\s*env\([^()]*\)\)/g, '$1');
      d.value = d.value.replace(/env\(([^,()]+),\s*([^()]+)\)/g, '$2');

      // min()/max()/clamp() -> variable calculée au lancement
      if (/(^|[^a-z-])(min|max|clamp)\(/.test(d.value)) {
        const pv = valueParser(d.value);
        pv.walk(n => {
          if (n.type !== 'function' || !['min', 'max', 'clamp'].includes(n.value)) return;
          const src = valueParser.stringify(n);
          if (/%|em\b|fr\b/.test(src.replace(/rem/g, ''))) { report.push(`MANUEL ${rule.selector} { ${d.prop}: ${d.value} }`); return false; }
          let i = exprs.indexOf(src); if (i < 0) i = exprs.push(src) - 1;
          n.type = 'word'; n.value = `var(--jx${i})`;
          return false;
        });
        d.value = pv.toString();
      }

      // gap
      if (['gap', 'row-gap', 'column-gap'].includes(d.prop)) {
        const disp = lookup(rule.selector, 'display', own) || '';
        if (/grid/.test(disp)) { d.cloneBefore({ prop: 'grid-' + d.prop, value: d.value }); return; }
        if (!/flex/.test(disp)) { report.push(`GAP sans display connu : ${rule.selector} { ${d.prop}: ${d.value} }`); return; }
        const dir = lookup(rule.selector, 'dir', own) || 'row', wrap = lookup(rule.selector, 'wrap', own) || 'nowrap';
        const [rg, cg = rg] = postcss.list.space(d.value);
        const col = /column/.test(dir);
        const sels = splitSel(rule.selector);
        // .top : barre du haut, déclarée "wrap" mais qui tient sur une ligne en paysage
        if (/wrap/.test(wrap) && !/nowrap/.test(wrap) && !/(^|\s)\.top$/.test(rule.selector)) {
          // flex qui passe à la ligne : marge à droite et en bas de chaque enfant
          // (compensée par une marge négative sur le conteneur, pour ne pas décaler ce qui suit)
          extra.push(postcss.rule({ selector: sels.map(s => `${s}>*`).join(','), nodes: [postcss.decl({ prop: 'margin-right', value: cg }), postcss.decl({ prop: 'margin-bottom', value: rg })] }));
          d.cloneBefore({ prop: 'margin-right', value: '-' + cg }); d.cloneBefore({ prop: 'margin-bottom', value: '-' + rg });
        } else {
          const g = d.prop === 'row-gap' ? (col ? rg : null) : d.prop === 'column-gap' ? (col ? null : rg) : (col ? rg : cg);
          // !important : sinon un simple "margin:0" sur l'enfant annule l'espacement (un vrai gap s'ajoute toujours)
          if (g) {
            const side = col ? 'margin-top' : 'margin-left';
            extra.push(postcss.rule({ selector: sels.map(s => `${s}>*+*`).join(','), nodes: [postcss.decl({ prop: side, value: g, important: true })] }));
            extra.push(postcss.rule({ selector: sels.map(s => `${s}>[hidden]:first-child+*`).join(','), nodes: [postcss.decl({ prop: side, value: '0', important: true })] }));
          }
        }
        d.remove();
      }
    });
    // Les marges "auto" voulues par la page (pousser un bouton à droite...) doivent gagner sur l'espacement émulé
    rule.each(d => {
      if (d.type !== 'decl' || !/^margin(-(top|left))?$/.test(d.prop) || !/auto/.test(d.value)) return;
      const sels = splitSel(rule.selector).filter(s => !/::|:before|:after/.test(s));
      if (sels.length) extra.push(postcss.rule({ selector: sels.map(s => `${s}:not(#\\9)`).join(','), nodes: [postcss.decl({ prop: d.prop, value: d.value.replace(/\s*!important/, ''), important: true })] }));
    });
    let at = rule;
    for (const e of extra) { e._gen = true; at.after(e); at = e; }
  });

  return { css: root.toString(), exprs };
}

// Code embarqué dans la page : calcule les expressions en px et les publie en variables CSS
export const runtimeVars = exprs => `(function () {
  var E = ${JSON.stringify(exprs)};
  function px(t) {
    var m = /^(-?[\\d.]+)(px|vw|vh|vmin|vmax|rem)?$/.exec(t.trim()), w = innerWidth, h = innerHeight;
    if (!m) return NaN;
    var v = parseFloat(m[1]);
    return m[2] === 'vw' ? v * w / 100 : m[2] === 'vh' ? v * h / 100 : m[2] === 'vmin' ? v * Math.min(w, h) / 100
      : m[2] === 'vmax' ? v * Math.max(w, h) / 100 : m[2] === 'rem' ? v * 16 : v;
  }
  function calc(e) {
    var m = /^(min|max|clamp)\\((.*)\\)$/.exec(e), a = m[2].split(',').map(px);
    return m[1] === 'min' ? Math.min.apply(null, a) : m[1] === 'max' ? Math.max.apply(null, a) : Math.max(a[0], Math.min(a[1], a[2]));
  }
  function apply() { for (var i = 0; i < E.length; i++) document.documentElement.style.setProperty('--jx' + i, calc(E[i]).toFixed(2) + 'px'); }
  apply(); addEventListener('resize', apply);
})();`;
