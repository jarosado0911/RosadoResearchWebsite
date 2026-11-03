// The CalcSim page: its equations, and the 2D diagram of the model ("Two compartments"): a cut along a dendrite,
// the plasma membrane on both sides, the ER tube inside, and every flux of the equations drawn as its pump, channel
// or leak, with Ca²⁺ streaming in its direction. Hovering (or tapping) a part names it and shows its term.
// Colors are those of the spines page's 3D card (src/calcium3d.js).
import { renderMath, texInto } from './math.js';

const NS = 'http://www.w3.org/2000/svg';
const C = {
  membrane: '#7f8de8', er: '#7fe0a0', ca: '#ff5a4a', calb: '#3fcf6f', synapse: '#e86aa6', ryr: '#b455c8',
  pump: '#e8de5a', ncx: '#f0a030', vdcc: '#5f86ff', leak: '#9aa6bc', soc: '#4fd1e0', na: '#8fa3c4',
  text: '#e9eef7', muted: '#9aa6bc',
};
const Y = { pm: 100, erTop: 215, erBot: 305, pmBot: 420 };   // the membranes; the dendrite's axis is at 260

// name, what it does, its term in the equations
const INFO = {
  syn: ['Synapse', 'Calcium enters at the synapse as a 10 ms pulse that ramps down, five times a second.',
    'J_{\\mathrm{syn}}=a\\Big(1-\\frac{\\tilde t-t_0}{t_1-t_0}\\Big)'],
  vdcc: ['Voltage-dependent Ca²⁺ channel (VDCC)', 'Opens when the membrane depolarizes. Calcium rushes in down a 20,000-fold gradient (GHK flux).',
    'J_{\\mathrm{VDCC}}=-\\rho_V s_1s_2^2P_{Ca}\\frac{zFV}{RT}\\frac{c-c_oe^{-zFV/RT}}{1-e^{-zFV/RT}}'],
  lp: ['Plasma membrane leak', 'A small steady inflow, sized so that everything balances at rest.', 'J_{\\mathrm{leak}}=v_{lp}(c_o-c)'],
  pmca: ['PMCA pump', 'Plasma membrane Ca²⁺-ATPase: high affinity (60 nM), uses ATP to pump calcium out of the cell.',
    'J_{\\mathrm{PMCA}}=\\rho_PI_P\\frac{c^2}{K_P^2+c^2}'],
  ncx: ['Na⁺/Ca²⁺ exchanger (NCX)', 'High capacity, low affinity (1.8 µM): one Ca²⁺ out for every three Na⁺ in.',
    'J_{\\mathrm{NCX}}=\\rho_NI_N\\frac{c}{K_N+c}'],
  ryr: ['Ryanodine receptor (RyR)', 'Opened by calcium itself (4 states, cooperative binding): calcium-induced calcium release, the engine of the wave.',
    'J_{\\mathrm{RyR}}=\\rho_R(o_1+o_2)I_{\\mathrm{ref}}\\frac{c_e-c}{c_{e,\\mathrm{ref}}}'],
  serca: ['SERCA pump', 'Uses ATP to pump calcium from the cytosol back into the ER, refilling the store.',
    'J_{\\mathrm{SERCA}}=\\rho_SI_S\\frac{c}{(K_S+c)\\,c_e}'],
  le: ['ER leak', 'A slow leak out of the ER, sized so that SERCA, RyR and leak balance at rest.', 'J_{\\mathrm{leak},e}=v_{le}(c_e-c)'],
  soc: ['Store-operated calcium entry (SOC)', 'When the ER runs low, its sensor STIM opens Orai channels in the plasma membrane and outside calcium refills the ER.',
    'J_{\\mathrm{SOC}}=\\rho_{\\mathrm{SOC}}(c_e)\\frac{I_{\\mathrm{SOC}}}{zFA_o}\\ln\\frac{10\\,c_o}{c_e}'],
  dc: ['Diffusion in the cytosol', 'Free calcium spreads along the dendrite (220 µm²/s); calbindin moves too, ten times slower.',
    'D_c\\,\\partial_x^2c,\\quad D_b\\,\\partial_x^2b'],
  de: ['Diffusion in the ER', 'Calcium also travels inside the ER tube (10 µm²/s), with its buffer calreticulin.',
    'D_e\\,\\partial_x^2c_e,\\quad D_{be}\\,\\partial_x^2b_e'],
  calb: ['Calbindin, the cytosol\'s buffer', 'Catches free calcium in the cytosol (40 µM in total) and lets it go again: it slows and shapes the signal.',
    'k_b^-(b_{\\mathrm{tot}}-b)-k_b^+\\,b\\,c'],
  calr: ['Calreticulin, the ER\'s buffer', 'Holds most of the ER\'s calcium bound (3.6 mM in total), so the store is large.',
    'k_{be}^-(b_{e,\\mathrm{tot}}-b_e)-k_{be}^+\\,b_e\\,c_e'],
  cyt: ['Cytosol', 'Between the plasma membrane and the ER. Membrane fluxes change c in proportion to the area-to-volume ratio of the shell.',
    '\\frac{2r}{r^2-r_e^2}J_{\\mathrm{PM}}+\\frac{2r_e}{r^2-r_e^2}J_{\\mathrm{ER}}'],
  erl: ['ER lumen', 'The calcium store inside the ER tube, about 250 µM at rest. It loses what it releases, scaled by 2/r_e.',
    '-\\frac{2}{r_e}J_{\\mathrm{ER}}+\\frac{2}{r_e}J_{\\mathrm{SOC}}'],
};

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
}
/** text with an italic symbol and a subscript: sym(g, x, y, 'J', 'PMCA') */
function sym(g, x, y, s, sub, { size = 17, anchor = 'start', color = C.text } = {}) {
  const t = el('text', { x, y, 'font-size': size, fill: color, 'text-anchor': anchor, class: 'csd-sym' }, g);
  el('tspan', { 'font-style': 'italic', 'font-family': 'Fraunces Variable, Georgia, serif' }, t).textContent = s;
  if (sub) el('tspan', { dy: 5, 'font-size': size * 0.66 }, t).textContent = sub;
  return t;
}
function note(g, x, y, s, { size = 12.5, anchor = 'start', color = C.muted } = {}) {
  const t = el('text', { x, y, 'font-size': size, fill: color, 'text-anchor': anchor }, g);
  t.textContent = s;
  return t;
}
/** a stream of Ca²⁺ from y0 to y1 at x (dashes that move, an arrowhead at the end) */
function flow(g, x, y0, y1, color = C.ca, { path } = {}) {
  el('path', { d: path ?? `M${x} ${y0} L${x} ${y1}`, stroke: color, 'stroke-width': 3.2, fill: 'none', 'stroke-linecap': 'round',
    'stroke-dasharray': '0.1 9', class: 'csd-flow', 'marker-end': `url(#csd-head-${color === C.ca ? 'ca' : 'na'})` }, g);
}
const part = (svg, key) => el('g', { class: 'csd-part', 'data-key': key, tabindex: 0, role: 'button', 'aria-label': INFO[key][0] }, svg);

function channel(g, x, y, color, gap = 7) {
  for (const s of [-1, 1]) el('rect', { x: x + s * (gap / 2 + 5) - 5, y: y - 17, width: 10, height: 34, rx: 4, fill: color, class: 'csd-body' }, g);
}
function pump(g, x, y, color) {
  el('circle', { cx: x, cy: y, r: 16, fill: '#0b1222', stroke: color, 'stroke-width': 4, class: 'csd-body' }, g);
  el('path', { d: `M${x - 7} ${y - 4} A8 8 0 1 1 ${x - 3} ${y + 7}`, stroke: color, 'stroke-width': 2, fill: 'none', class: 'csd-turn',
    style: `transform-origin:${x}px ${y}px` }, g);
}
function hit(g, x, y, w, h) { el('rect', { x, y, width: w, height: h, fill: 'transparent' }, g); }

function buildDiagram(root) {
  const svg = el('svg', { viewBox: '0 -14 1000 534', class: 'csd-svg', role: 'img',
    'aria-label': 'Diagram of the model: a cut along a dendrite with the plasma membrane, the ER inside, and the calcium fluxes between outside, cytosol and ER' });
  root.querySelector('.csd-stage').appendChild(svg);
  const defs = el('defs', {}, svg);
  for (const [id, color] of [['ca', C.ca], ['na', C.na]]) {
    const m = el('marker', { id: `csd-head-${id}`, viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0 0 L10 5 L0 10 z', fill: color }, m);
  }
  const fade = el('linearGradient', { id: 'csd-fade', x1: 0, x2: 1 }, defs);
  [[0, 0], [0.05, 1], [0.95, 1], [1, 0]].forEach(([o, a]) => el('stop', { offset: o, 'stop-color': C.membrane, 'stop-opacity': a }, fade));

  // the compartments (hover targets under everything else)
  const cyt = part(svg, 'cyt');
  el('rect', { x: 20, y: Y.pm, width: 960, height: Y.pmBot - Y.pm, fill: 'rgba(127,141,232,0.07)' }, cyt);
  const erl = part(svg, 'erl');
  el('rect', { x: 110, y: Y.erTop, width: 780, height: Y.erBot - Y.erTop, rx: 45, fill: 'rgba(127,224,160,0.13)', stroke: C.er, 'stroke-width': 5, class: 'csd-body' }, erl);
  // the dendrite's axis and the radii
  el('line', { x1: 24, y1: 260, x2: 104, y2: 260, stroke: C.muted, 'stroke-dasharray': '4 6', 'stroke-width': 1 }, svg);
  el('line', { x1: 896, y1: 260, x2: 976, y2: 260, stroke: C.muted, 'stroke-dasharray': '4 6', 'stroke-width': 1 }, svg);
  for (const [x, y, s] of [[950, Y.pm, 'r'], [915, Y.erTop, 'r']]) {
    el('line', { x1: x, y1: 260, x2: x, y2: y + 4, stroke: C.muted, 'stroke-width': 1.2, 'marker-end': 'url(#csd-head-na)' }, svg);
    sym(svg, x + 7, (260 + y) / 2 + 6, s, x === 915 ? 'e' : '', { size: 16, color: C.muted });
  }
  // the plasma membrane, top and bottom (fading at the cut ends: the dendrite goes on)
  for (const y of [Y.pm, Y.pmBot]) el('rect', { x: 20, y: y - 5, width: 960, height: 10, rx: 5, fill: 'url(#csd-fade)', opacity: 0.85 }, svg);

  // labels of the spaces
  note(svg, 400, 26, 'OUTSIDE · c', { size: 12, color: C.muted }).insertAdjacentHTML('beforeend', '<tspan dy="4" font-size="9">o</tspan><tspan dy="-4"> = 1 mM</tspan>');
  note(svg, 40, 505, 'OUTSIDE', { size: 12 });
  note(svg, 40, 398, 'CYTOSOL', { size: 12, color: C.membrane });
  sym(svg, 112, 398, 'c', '', { size: 16 }); note(svg, 124, 398, ',', { size: 16, color: C.text }); sym(svg, 132, 398, 'b', '', { size: 16, color: C.calb });
  note(svg, 150, 254, 'ER', { size: 12, color: C.er });
  sym(svg, 176, 254, 'c', 'e', { size: 16 }); note(svg, 198, 254, ',', { size: 16, color: C.text }); sym(svg, 206, 254, 'b', 'e', { size: 16, color: C.er });

  // --- plasma membrane: synapse, VDCC, leak, PMCA, NCX (top) and SOC (bottom)
  let g = part(svg, 'syn');
  el('path', { d: 'M100 6 Q150 -6 200 6 L196 52 Q150 76 104 52 Z', fill: 'rgba(232,106,166,0.18)', stroke: C.synapse, 'stroke-width': 2.5, class: 'csd-body' }, g);
  [[130, 30], [155, 20], [172, 40], [146, 46]].forEach(([x, y]) => el('circle', { cx: x, cy: y, r: 6, fill: 'none', stroke: C.synapse, 'stroke-width': 1.6 }, g));
  el('rect', { x: 110, y: Y.pm + 6, width: 80, height: 7, rx: 3, fill: C.synapse, opacity: 0.8 }, g);
  flow(g, 150, 62, 168);
  sym(g, 206, 92, 'J', 'syn');
  hit(g, 96, 0, 150, 175);

  g = part(svg, 'vdcc');
  channel(g, 330, Y.pm, C.vdcc);
  flow(g, 330, 44, 170);
  sym(g, 346, 64, 'J', 'VDCC');
  hit(g, 310, 36, 100, 140);

  g = part(svg, 'lp');
  el('rect', { x: 476, y: Y.pm - 5, width: 10, height: 10, fill: '#05070d' }, g);
  flow(g, 481, 60, 150);
  note(g, 494, 72, 'leak', { size: 12.5 });
  hit(g, 465, 50, 70, 110);

  g = part(svg, 'pmca');
  pump(g, 630, Y.pm, C.pump);
  flow(g, 630, 166, 38);
  sym(g, 652, 62, 'J', 'PMCA');
  hit(g, 605, 30, 110, 145);

  g = part(svg, 'ncx');
  el('rect', { x: 782, y: Y.pm - 15, width: 40, height: 30, rx: 9, fill: '#0b1222', stroke: C.ncx, 'stroke-width': 4, class: 'csd-body' }, g);
  flow(g, 793, 166, 38);
  flow(g, 812, 40, 162, C.na);
  note(g, 822, 150, '3Na⁺', { size: 12, color: C.na });
  sym(g, 836, 62, 'J', 'NCX');
  hit(g, 775, 30, 115, 145);

  g = part(svg, 'soc');
  channel(g, 560, Y.pmBot, C.soc);
  flow(g, 560, 500, Y.erBot + 12);
  el('path', { d: `M590 ${Y.erBot + 3} C 610 350, 600 390, 582 ${Y.pmBot - 14}`, stroke: C.soc, 'stroke-width': 1.6, fill: 'none', 'stroke-dasharray': '3 4' }, g);
  note(g, 606, 372, 'STIM', { size: 11.5, color: C.soc });
  sym(g, 576, 476, 'J', 'SOC');
  hit(g, 540, 300, 110, 215);

  // --- ER membrane: RyR, SERCA, leak (top)
  g = part(svg, 'ryr');
  channel(g, 255, Y.erTop, C.ryr, 8);
  flow(g, 255, 270, 150);
  sym(g, 271, 182, 'J', 'RyR');
  hit(g, 235, 140, 85, 140);

  g = part(svg, 'serca');
  pump(g, 520, Y.erTop, C.pump);
  flow(g, 520, 146, 268);
  sym(g, 542, 182, 'J', 'SERCA');
  hit(g, 496, 140, 115, 140);

  g = part(svg, 'le');
  el('rect', { x: 715, y: Y.erTop - 4, width: 10, height: 8, fill: '#0e1a22' }, g);
  flow(g, 720, 262, 160);
  note(g, 734, 182, 'leak', { size: 12.5 });
  hit(g, 705, 150, 70, 120);

  // --- inside: diffusion and buffers
  g = part(svg, 'dc');
  el('path', { d: 'M250 362 L470 362', stroke: C.text, 'stroke-width': 1.6, 'marker-start': 'url(#csd-head-na)', 'marker-end': 'url(#csd-head-na)', opacity: 0.8 }, g);
  sym(g, 300, 352, 'D', 'c', { size: 15 }); note(g, 324, 352, '∂²c / ∂x²', { size: 13, color: C.text });
  hit(g, 240, 330, 240, 45);

  g = part(svg, 'de');
  el('path', { d: 'M360 288 L520 288', stroke: C.text, 'stroke-width': 1.6, 'marker-start': 'url(#csd-head-na)', 'marker-end': 'url(#csd-head-na)', opacity: 0.8 }, g);
  sym(g, 380, 280, 'D', 'e', { size: 15 }); note(g, 402, 280, '∂²c', { size: 13, color: C.text });
  hit(g, 350, 262, 180, 38);

  const buffer = (g, x, y, color) => {   // a Y-shaped protein holding a Ca²⁺
    el('path', { d: `M${x} ${y + 12} L${x} ${y} L${x - 9} ${y - 10} M${x} ${y} L${x + 9} ${y - 10}`, stroke: color, 'stroke-width': 3.5, fill: 'none', 'stroke-linecap': 'round', class: 'csd-body' }, g);
    el('circle', { cx: x, cy: y - 12, r: 4.5, fill: C.ca }, g);
  };
  g = part(svg, 'calb');
  buffer(g, 700, 372, C.calb);
  sym(g, 722, 370, 'c', '', { size: 15 }); note(g, 734, 370, '+', { size: 14, color: C.text }); sym(g, 748, 370, 'b', '', { size: 15, color: C.calb });
  note(g, 763, 370, '⇌', { size: 16, color: C.text }); sym(g, 784, 370, 'cb', '', { size: 15, color: C.calb });
  hit(g, 680, 345, 140, 40);

  g = part(svg, 'calr');
  buffer(g, 760, 290, C.er);
  sym(g, 782, 288, 'c', 'e', { size: 15 }); note(g, 803, 288, '+', { size: 14, color: C.text }); sym(g, 816, 288, 'b', 'e', { size: 15, color: C.er });
  hit(g, 740, 264, 130, 36);

  // free ions drifting in the cytosol and the ER
  [[200, 140], [430, 175], [610, 330], [880, 160], [400, 400], [520, 380], [870, 390], [240, 300]].forEach(([x, y]) =>
    el('circle', { cx: x, cy: y, r: 4, fill: C.ca, opacity: 0.75, class: 'csd-ion' }, svg));
  [[190, 280], [300, 240], [470, 250], [640, 240], [620, 285], [840, 245]].forEach(([x, y]) =>
    el('circle', { cx: x, cy: y, r: 3.5, fill: C.ca, opacity: 0.9, class: 'csd-ion' }, svg));
  return svg;
}

function startDiagram(root) {
  const svg = buildDiagram(root);
  const name = root.querySelector('.csd-name'), desc = root.querySelector('.csd-desc'), tex = root.querySelector('.csd-tex');
  const parts = [...svg.querySelectorAll('.csd-part')];
  let pinned = null;
  const show = (key) => {
    parts.forEach((p) => p.classList.toggle('on', p.dataset.key === key));
    svg.classList.toggle('focus', !!key);
    if (!key) { name.textContent = 'Hover a pump, channel or buffer'; desc.textContent = 'Each one is a term of the equations below. Arrows show which way calcium goes.'; tex.textContent = ''; return; }
    const [n, d, t] = INFO[key];
    name.textContent = n; desc.textContent = d;
    texInto(tex, t, true);
  };
  show(null);
  // the innermost part under the pointer wins (compartments lie underneath)
  parts.forEach((p) => {
    p.addEventListener('pointerenter', () => { if (!pinned) show(p.dataset.key); });
    p.addEventListener('pointerleave', () => {
      if (pinned) return;
      const under = parts.find((q) => q !== p && q.matches(':hover') && !q.contains(p));
      show(under ? under.dataset.key : null);
    });
    p.addEventListener('focus', () => show(p.dataset.key));
    p.addEventListener('click', (e) => {
      e.stopPropagation();
      pinned = pinned === p.dataset.key ? null : p.dataset.key;
      show(pinned ?? p.dataset.key);
    });
  });
  svg.addEventListener('click', () => { pinned = null; show(null); });
}

export function startCalcSimPage() {
  renderMath();
  const d = document.getElementById('cs-diagram');
  if (d) startDiagram(d);
}
