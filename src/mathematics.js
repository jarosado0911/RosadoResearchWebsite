// The series & analysis page (mathematics.html). "Integrate without integrating": the method of the Rosado-Osler
// paper, live. For g(z) = sum c_n z^n on the circle z = r e^{i theta}, u = Re g and v = Im g are Fourier series
// in theta, so  int u dtheta = 2 pi c_0  and  int u cos(n theta) = int v sin(n theta) = pi c_n r^n.
// The page integrates numerically (Simpson) and compares with the Taylor coefficient, for the 12 functions of the
// paper's Table 1, and draws the integrand and the matching Fourier/Taylor coefficients.
import { renderMath, texInto } from './math.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

// ---- a little complex arithmetic: [re, im] ----
const C = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  mul: (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]],
  div: (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; },
  exp: (a) => { const e = Math.exp(a[0]); return [e * Math.cos(a[1]), e * Math.sin(a[1])]; },
  log: (a) => [Math.log(Math.hypot(a[0], a[1])), Math.atan2(a[1], a[0])],
  sin: (a) => [Math.sin(a[0]) * Math.cosh(a[1]), Math.cos(a[0]) * Math.sinh(a[1])],
  cos: (a) => [Math.cos(a[0]) * Math.cosh(a[1]), -Math.sin(a[0]) * Math.sinh(a[1])],
  sinh: (a) => [Math.sinh(a[0]) * Math.cos(a[1]), Math.cosh(a[0]) * Math.sin(a[1])],
  sqrt: (a) => { const m = Math.sqrt(Math.hypot(a[0], a[1])), t = Math.atan2(a[1], a[0]) / 2; return [m * Math.cos(t), m * Math.sin(t)]; },
};
C.tan = (a) => C.div(C.sin(a), C.cos(a));
C.atan = (a) => {                       // arctan z = (i/2) log((1 - iz)/(1 + iz))
  const iz = [-a[1], a[0]], w = C.log(C.div(C.sub([1, 0], iz), C.add([1, 0], iz)));
  return [-w[1] / 2, w[0] / 2];
};
const ONE = [1, 0];
const fact = (n) => { let f = 1; for (let k = 2; k <= n; k++) f *= k; return f; };
const BERN = { 2: 1 / 6, 4: -1 / 30, 6: 1 / 42, 8: -1 / 30, 10: 5 / 66, 12: -691 / 2730, 14: 7 / 6, 16: -3617 / 510, 18: 43867 / 798 };
const binomHalf = (n) => { let c = 1; for (let k = 0; k < n; k++) c *= (0.5 - k) / (k + 1); return c; };

// the functions of Table 1: g, Taylor coefficient c_n, largest radius offered, the table's first integral number,
// and u, v and c_n in TeX (tan z: v as the true imaginary part, sinh(2r sin theta))
const FUNCS = [
  { id: 'exp', name: 'eᶻ', g: C.exp, c: (n) => 1 / fact(n), rmax: 3, no: 13,
    u: 'e^{r\\cos\\theta}\\cos(r\\sin\\theta)', v: 'e^{r\\cos\\theta}\\sin(r\\sin\\theta)', ct: '\\frac{1}{n!}' },
  { id: 'cos', name: 'cos z', g: C.cos, c: (n) => (n % 2 ? 0 : (-1) ** (n / 2) / fact(n)), rmax: 3, no: 4,
    u: '\\cos(r\\cos\\theta)\\cosh(r\\sin\\theta)', v: '-\\sin(r\\cos\\theta)\\sinh(r\\sin\\theta)', ct: '\\frac{(-1)^{n/2}}{n!}\\ (n\\text{ even})' },
  { id: 'sin', name: 'sin z', g: C.sin, c: (n) => (n % 2 ? (-1) ** ((n - 1) / 2) / fact(n) : 0), rmax: 3, no: 7,
    u: '\\sin(r\\cos\\theta)\\cosh(r\\sin\\theta)', v: '\\cos(r\\cos\\theta)\\sinh(r\\sin\\theta)', ct: '\\frac{(-1)^{(n-1)/2}}{n!}\\ (n\\text{ odd})' },
  { id: 'sinh', name: 'sinh z', g: C.sinh, c: (n) => (n % 2 ? 1 / fact(n) : 0), rmax: 3, no: 22,
    u: '\\sinh(r\\cos\\theta)\\cos(r\\sin\\theta)', v: '\\cosh(r\\cos\\theta)\\sin(r\\sin\\theta)', ct: '\\frac{1}{n!}\\ (n\\text{ odd})' },
  { id: 'exp2', name: '(eᶻ)²', g: (z) => C.exp([2 * z[0], 2 * z[1]]), c: (n) => 2 ** n / fact(n), rmax: 2, no: 28,
    u: 'e^{2r\\cos\\theta}\\cos(2r\\sin\\theta)', v: 'e^{2r\\cos\\theta}\\sin(2r\\sin\\theta)', ct: '\\frac{2^n}{n!}' },
  { id: 'inv', name: '1/(2 − z)', g: (z) => C.div(ONE, C.sub([2, 0], z)), c: (n) => 1 / 2 ** (n + 1), rmax: 1.9, no: 1,
    u: '\\frac{2-r\\cos\\theta}{4+r^2-4r\\cos\\theta}', v: '\\frac{r\\sin\\theta}{4+r^2-4r\\cos\\theta}', ct: '\\frac{1}{2^{n+1}}' },
  { id: 'sq', name: '1/(1 − z)²', g: (z) => { const w = C.sub(ONE, z); return C.div(ONE, C.mul(w, w)); }, c: (n) => n + 1, rmax: 0.9, no: 31,
    u: '\\frac{r^2\\cos2\\theta-2r\\cos\\theta+1}{(1+r^2-2r\\cos\\theta)^2}', v: '\\frac{2r\\sin\\theta-r^2\\sin2\\theta}{(1+r^2-2r\\cos\\theta)^2}', ct: 'n+1' },
  { id: 'log', name: 'log(1 + z)', g: (z) => C.log(C.add(ONE, z)), c: (n) => (n ? (-1) ** (n + 1) / n : 0), rmax: 0.95, no: 19,
    u: '\\tfrac12\\log(1+r^2+2r\\cos\\theta)', v: '\\arctan\\frac{r\\sin\\theta}{1+r\\cos\\theta}', ct: '\\frac{(-1)^{n+1}}{n}' },
  { id: 'atan', name: 'arctan z', g: C.atan, c: (n) => (n % 2 ? (-1) ** ((n - 1) / 2) / n : 0), rmax: 0.95, no: 10,
    u: '\\tfrac12\\arctan\\frac{2r\\cos\\theta}{1-r^2}', v: '\\tfrac14\\log\\frac{1+r^2+2r\\sin\\theta}{1+r^2-2r\\sin\\theta}', ct: '\\frac{(-1)^{(n-1)/2}}{n}\\ (n\\text{ odd})' },
  { id: 'tan', name: 'tan z', g: C.tan, c: (n) => (n % 2 ? (-1) ** ((n + 1) / 2 - 1) * 2 ** (n + 1) * (2 ** (n + 1) - 1) * BERN[n + 1] / fact(n + 1) : 0), rmax: 1.5, no: 16,
    u: '\\frac{\\sin(2r\\cos\\theta)}{\\cos(2r\\cos\\theta)+\\cosh(2r\\sin\\theta)}', v: '\\frac{\\sinh(2r\\sin\\theta)}{\\cos(2r\\cos\\theta)+\\cosh(2r\\sin\\theta)}', ct: '\\frac{(-1)^{k-1}2^{2k}(2^{2k}-1)B_{2k}}{(2k)!},\\ n=2k-1' },
  { id: 'expinv', name: 'eᶻ/(1 − z)', g: (z) => C.div(C.exp(z), C.sub(ONE, z)), c: (n) => { let s = 0; for (let k = 0; k <= n; k++) s += 1 / fact(k); return s; }, rmax: 0.9, no: 25,
    u: '\\frac{e^{r\\cos\\theta}(\\cos(r\\sin\\theta)(1-r\\cos\\theta)-r\\sin\\theta\\sin(r\\sin\\theta))}{1+r^2-2r\\cos\\theta}', v: '\\frac{e^{r\\cos\\theta}(\\cos(r\\sin\\theta)\\,r\\sin\\theta+(1-r\\cos\\theta)\\sin(r\\sin\\theta))}{1+r^2-2r\\cos\\theta}', ct: '\\sum_{k=0}^{n}\\frac1{k!}' },
  { id: 'sqrt', name: '√(z + 1)', g: (z) => C.sqrt(C.add(ONE, z)), c: binomHalf, rmax: 0.99, no: 34,
    u: '\\cos\\!\\big(\\tfrac12\\arctan\\tfrac{r\\sin\\theta}{1+r\\cos\\theta}\\big)\\sqrt[4]{1+r^2+2r\\cos\\theta}', v: '\\sin\\!\\big(\\tfrac12\\arctan\\tfrac{r\\sin\\theta}{1+r\\cos\\theta}\\big)\\sqrt[4]{1+r^2+2r\\cos\\theta}', ct: '\\binom{1/2}{n}' },
];
const KNOWN = new Set([1, 6, 13, 19, 25, 28, 31]), OBVIOUS = new Set([7, 10, 16, 22]);

/** Simpson's rule on [-pi, pi] with N (even) steps */
function simpson(f, N = 2000) {
  const h = (2 * Math.PI) / N;
  let s = f(-Math.PI) + f(Math.PI);
  for (let k = 1; k < N; k++) s += (k % 2 ? 4 : 2) * f(-Math.PI + k * h);
  return (s * h) / 3;
}
const fmt = (x) => (Math.abs(x) < 5e-13 ? '0' : Math.abs(x) >= 1e4 || Math.abs(x) < 1e-3 ? x.toExponential(6) : x.toFixed(9).replace(/0+$/, '').replace(/\.$/, ''));

function startMarriage(root) {
  const sel = root.querySelector('[data-g]'), rIn = root.querySelector('[data-r]'), nIn = root.querySelector('[data-n]');
  const plot = root.querySelector('.mx-plot'), coef = root.querySelector('.mx-coef'), integral = root.querySelector('.mx-integral');
  FUNCS.forEach((f, i) => sel.add(new Option(f.name, i)));
  let kind = 'cos';
  root.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => {
    kind = b.dataset.kind;
    root.querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('active', x === b));
    draw();
  }));
  function draw() {
    const F = FUNCS[+sel.value];
    rIn.max = F.rmax;
    if (+rIn.value > F.rmax) rIn.value = F.rmax;
    nIn.min = kind === 'sin' ? 1 : 0;
    if (+nIn.value < +nIn.min) nIn.value = nIn.min;
    const r = +rIn.value, n = +nIn.value;
    rIn.parentElement.querySelector('output').textContent = r.toFixed(2);
    nIn.parentElement.querySelector('output').textContent = n;
    const part = (t) => F.g([r * Math.cos(t), r * Math.sin(t)]);
    const integrand = kind === 'cos' ? (t) => part(t)[0] * Math.cos(n * t) : (t) => part(t)[1] * Math.sin(n * t);
    const num = simpson(integrand), cn = F.c(n), exact = n === 0 ? 2 * Math.PI * cn : Math.PI * cn * r ** n;
    root.querySelector('[data-num]').textContent = fmt(num);
    root.querySelector('[data-exact]').textContent = fmt(exact);
    root.querySelector('[data-diff]').textContent = Math.abs(num - exact).toExponential(1);
    const body = kind === 'cos' ? F.u : F.v, trig = n === 0 ? '' : kind === 'cos' ? `\\cos(${n === 1 ? '' : n}\\theta)` : `\\sin(${n === 1 ? '' : n}\\theta)`;
    const rhs = n === 0 ? `2\\pi c_0` : `\\pi c_{${n}}\\,r^{${n}}`;
    texInto(integral, `\\begin{gathered}\\int_{-\\pi}^{\\pi}${body}\\,${trig}\\,d\\theta=${rhs},\\\\ c_n=${F.ct}\\end{gathered}`, true);
    const no = F.no + (n === 0 ? 0 : kind === 'cos' ? 1 : 2);
    const status = root.querySelector('[data-status]');
    status.className = 'mx-status';
    if (cn === 0) status.textContent = `This Taylor coefficient is 0, so the integral is 0 for n = ${n}.`;
    else {
      const tag = KNOWN.has(no) ? 'known in the literature' : OBVIOUS.has(no) ? 'zero by symmetry' : 'may be new: no closed form found in the tables or by Mathematica';
      status.textContent = `Table No. ${no}: ${tag}.`;
      status.classList.add(KNOWN.has(no) || OBVIOUS.has(no) ? 'known' : 'new');
    }
    drawPlot(integrand);
    drawCoef(F, r, n, kind, part);
  }
  function drawPlot(f) {
    const W = 460, H = 190, pad = { l: 40, r: 10, t: 12, b: 26 };
    plot.setAttribute('viewBox', `0 0 ${W} ${H}`);
    plot.innerHTML = '';
    const N = 400, xs = [], ys = [];
    for (let k = 0; k <= N; k++) { const t = -Math.PI + (2 * Math.PI * k) / N; xs.push(t); ys.push(f(t)); }
    let lo = Math.min(0, ...ys), hi = Math.max(0, ...ys);
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const pr = (hi - lo) * 0.08; lo -= pr; hi += pr;
    const X = (t) => pad.l + ((t + Math.PI) / (2 * Math.PI)) * (W - pad.l - pad.r), Y = (v) => H - pad.b - ((v - lo) / (hi - lo)) * (H - pad.t - pad.b);
    const area = (clamp) => `M${X(xs[0])},${Y(0)}` + xs.map((t, i) => `L${X(t).toFixed(1)},${Y(clamp(ys[i])).toFixed(1)}`).join('') + `L${X(xs[N])},${Y(0)}Z`;
    el('path', { d: area((v) => Math.max(0, v)), class: 'mx-pos' }, plot);
    el('path', { d: area((v) => Math.min(0, v)), class: 'mx-neg' }, plot);
    el('line', { x1: pad.l, x2: W - pad.r, y1: Y(0), y2: Y(0), class: 'fr-grid mx-zero' }, plot);
    el('path', { d: xs.map((t, i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join(''), class: 'fr-line', stroke: '#e9eef7' }, plot);
    [['−π', -Math.PI], ['0', 0], ['π', Math.PI]].forEach(([l, t]) => { el('text', { x: X(t), y: H - 8, class: 'fr-axis', 'text-anchor': 'middle' }, plot).textContent = l; });
    el('text', { x: pad.l - 6, y: Y(0) + 3, class: 'fr-axis', 'text-anchor': 'end' }, plot).textContent = '0';
    el('text', { x: W - pad.r, y: pad.t + 4, class: 'fr-axis', 'text-anchor': 'end' }, plot).textContent = 'the integrand over θ (blue area minus orange area)';
  }
  function drawCoef(F, r, n, kind, part) {
    const W = 460, H = 170, pad = { l: 40, r: 10, t: 26, b: 24 }, K = 9;
    coef.setAttribute('viewBox', `0 0 ${W} ${H}`);
    coef.innerHTML = '';
    // Fourier coefficients of u (or v) by integration, and the Taylor side c_k r^k
    const four = [], tay = [];
    for (let k = 0; k < K; k++) {
      if (kind === 'cos') four.push(k === 0 ? simpson((t) => part(t)[0], 800) / (2 * Math.PI) : simpson((t) => part(t)[0] * Math.cos(k * t), 800) / Math.PI);
      else four.push(k === 0 ? 0 : simpson((t) => part(t)[1] * Math.sin(k * t), 800) / Math.PI);
      tay.push(kind === 'sin' && k === 0 ? 0 : F.c(k) * r ** k);
    }
    const m = Math.max(1e-9, ...four.map(Math.abs), ...tay.map(Math.abs)) * 1.1;
    const lo = Math.min(0, ...four, ...tay) < 0 ? -m : 0, hi = m;
    const gw = (W - pad.l - pad.r) / K, bw = Math.min(16, gw / 3);
    const Y = (v) => H - pad.b - ((v - lo) / (hi - lo)) * (H - pad.t - pad.b);
    el('line', { x1: pad.l, x2: W - pad.r, y1: Y(0), y2: Y(0), class: 'fr-grid mx-zero' }, coef);
    for (let k = 0; k < K; k++) {
      const x0 = pad.l + k * gw + gw / 2;
      if (k === n) el('rect', { x: pad.l + k * gw + 2, y: pad.t - 4, width: gw - 4, height: H - pad.t - pad.b + 4, rx: 6, class: 'mx-cur' }, coef);
      [[four[k], '#3987e5', -bw - 1, 'by integration'], [tay[k], '#d95926', 1, 'c_k r^k']].forEach(([v, col, dx, lab]) => {
        const y0 = Y(Math.max(0, v)), h = Math.max(0.5, Math.abs(Y(v) - Y(0)));
        const rect = el('rect', { x: x0 + dx, y: y0, width: bw, height: h, rx: 2, fill: col }, coef);
        el('title', {}, rect).textContent = `k = ${k}, ${lab}: ${v.toPrecision(6)}`;
      });
      el('text', { x: x0, y: H - 8, class: 'fr-axis', 'text-anchor': 'middle' }, coef).textContent = k;
    }
    const lg = el('g', { class: 'fr-axis' }, coef);
    el('rect', { x: pad.l, y: 6, width: 10, height: 10, rx: 2, fill: '#3987e5' }, lg);
    el('text', { x: pad.l + 15, y: 15, class: 'fr-axis' }, lg).textContent = `Fourier coefficient of ${kind === 'cos' ? 'u' : 'v'}, by integration`;
    el('rect', { x: pad.l + 235, y: 6, width: 10, height: 10, rx: 2, fill: '#d95926' }, lg);
    el('text', { x: pad.l + 250, y: 15, class: 'fr-axis' }, lg).textContent = 'Taylor side cₖ rᵏ';
  }
  sel.addEventListener('change', draw);
  rIn.addEventListener('input', draw);
  nIn.addEventListener('input', draw);
  draw();
}


// ---------- "Two series, one function": the four steps, animated ----------
// The highlighted card's step plays on the stage above the cards, for g(z) = e^z at r = 0.8:
// 1 the Taylor coefficients c_n r^n grow in; 2 the point z = r e^{i theta} sweeps the circle; 3 u and v are drawn
// out as the point moves; 4 the area under u cos(2 theta) fills in and its running total lands on pi c_2 r^2.
const STEP_MS = 5200;
const CAPTIONS = [
  'Step 1 · the Taylor coefficients of eᶻ, cₙ = 1/n!, scaled by rⁿ',
  'Step 2 · z = reⁱᶿ goes once around the circle |z| = r',
  'Step 3 · as it goes, the real part u (blue) and the imaginary part v (orange) are traced out',
  'Step 4 · the area under u·cos 2θ adds up to exactly π c₂ r² = 0.32 π',
];
function startFlow(root) {
  const svg = root.querySelector('.mx-stage-svg'), cap = root.querySelector('.mx-stage-cap');
  const cards = [...root.querySelectorAll('.mx-steps > li')], play = root.querySelector('.mx-play');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const R = 0.8, g = (t) => C.exp([R * Math.cos(t), R * Math.sin(t)]);
  const W = 900, H = 230;
  // the layers, one per step (cross-faded by CSS)
  const layers = [0, 1, 2, 3].map((k) => el('g', { class: 'mx-layer', 'data-k': k }, svg));
  // 1: bars of c_n r^n
  const bars = [];
  for (let n = 0; n < 9; n++) {
    const x = 210 + n * 56, b = el('rect', { x, y: 190, width: 30, height: 0, rx: 4, class: 'mx-bar' }, layers[0]);
    el('text', { x: x + 15, y: 212, class: 'mx-st-ax', 'text-anchor': 'middle' }, layers[0]).textContent = `c${'₀₁₂₃₄₅₆₇₈'[n]}r${n ? '⁰¹²³⁴⁵⁶⁷⁸'[n] : '⁰'}`;
    bars.push({ b, v: R ** n / fact(n) });
  }
  el('text', { x: 60, y: 70, class: 'mx-st-big' }, layers[0]).textContent = 'g(z) = eᶻ';
  el('text', { x: 60, y: 100, class: 'mx-st-ax' }, layers[0]).textContent = '= Σ zⁿ / n!';
  // 2: the complex plane
  const cx = 450, cy = 115, rad = 80;
  const plane = (layer, x0, y0, rr) => {
    el('line', { x1: x0 - rr - 30, x2: x0 + rr + 30, y1: y0, y2: y0, class: 'mx-st-axis' }, layer);
    el('line', { x1: x0, x2: x0, y1: y0 - rr - 20, y2: y0 + rr + 20, class: 'mx-st-axis' }, layer);
    el('circle', { cx: x0, cy: y0, r: rr, class: 'mx-st-circle' }, layer);
    const trail = el('path', { class: 'mx-st-trail' }, layer);
    const spoke = el('line', { x1: x0, y1: y0, class: 'mx-st-spoke' }, layer);
    const dot = el('circle', { r: 7, class: 'mx-st-dot' }, layer);
    return { trail, spoke, dot, x0, y0, rr };
  };
  const p2 = plane(layers[1], cx, cy, rad);
  el('text', { x: cx + rad + 40, y: cy - 40, class: 'mx-st-big' }, layers[1]).innerHTML = 'z = re<tspan dy="-9" font-size="15">iθ</tspan>';
  const thLabel = el('text', { x: cx + rad + 40, y: cy - 10, class: 'mx-st-ax' }, layers[1]);
  el('text', { x: cx + rad + 34, y: cy + 16, class: 'mx-st-ax' }, layers[1]).textContent = 'Re';
  el('text', { x: cx + 6, y: cy - rad - 8, class: 'mx-st-ax' }, layers[1]).textContent = 'Im';
  // 3: small plane on the left, u and v unrolled on the right
  const p3 = plane(layers[2], 115, 115, 62);
  const X3 = (t) => 250 + ((t + Math.PI) / (2 * Math.PI)) * 610, U3 = (v) => 115 - v * 38;
  el('line', { x1: 250, x2: 860, y1: 115, y2: 115, class: 'mx-st-axis' }, layers[2]);
  [['−π', -Math.PI], ['0', 0], ['π', Math.PI]].forEach(([l, t]) => { el('text', { x: X3(t), y: 222, class: 'mx-st-ax', 'text-anchor': 'middle' }, layers[2]).textContent = l; });
  const uPath = el('path', { class: 'mx-st-u' }, layers[2]), vPath = el('path', { class: 'mx-st-v' }, layers[2]);
  const cursor = el('line', { y1: 15, y2: 205, class: 'mx-st-cursor' }, layers[2]);
  const link = el('line', { class: 'mx-st-link' }, layers[2]);
  el('text', { x: 860, y: 30, class: 'mx-st-ax', 'text-anchor': 'end' }, layers[2]).innerHTML = '<tspan class="mx-st-ul">━ u = Re g</tspan><tspan dx="22" class="mx-st-vl">━ v = Im g</tspan>';
  // 4: the integrand u cos 2θ, its area filling in, the running total
  const X4 = (t) => 70 + ((t + Math.PI) / (2 * Math.PI)) * 560, F4 = (t) => g(t)[0] * Math.cos(2 * t);
  let lo = 0, hi = 0;
  for (let k = 0; k <= 200; k++) { const v = F4(-Math.PI + (2 * Math.PI * k) / 200); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const Y4 = (v) => 200 - ((v - lo) / (hi - lo)) * 175;
  el('line', { x1: 70, x2: 630, y1: Y4(0), y2: Y4(0), class: 'mx-st-axis' }, layers[3]);
  const pos = el('path', { class: 'mx-st-pos' }, layers[3]), neg = el('path', { class: 'mx-st-neg' }, layers[3]);
  el('path', { class: 'mx-st-curve', d: Array.from({ length: 201 }, (_, k) => { const t = -Math.PI + (2 * Math.PI * k) / 200; return `${k ? 'L' : 'M'}${X4(t).toFixed(1)},${Y4(F4(t)).toFixed(1)}`; }).join('') }, layers[3]);
  const sweep = el('line', { y1: 20, y2: 205, class: 'mx-st-cursor' }, layers[3]);
  el('text', { x: 660, y: 75, class: 'mx-st-ax' }, layers[3]).textContent = '∫ u cos 2θ dθ so far';
  const total = el('text', { x: 660, y: 110, class: 'mx-st-big mx-st-num' }, layers[3]);
  const target = el('text', { x: 660, y: 145, class: 'mx-st-ax' }, layers[3]);
  target.textContent = `π c₂ r² = ${(Math.PI * 0.5 * R * R).toFixed(4)}`;

  const arc = (p, upto) => {             // the circle's trail from -pi to upto
    let d = '';
    for (let k = 0; k <= 80; k++) { const t = -Math.PI + ((upto + Math.PI) * k) / 80; d += `${k ? 'L' : 'M'}${(p.x0 + p.rr * Math.cos(t)).toFixed(1)},${(p.y0 - p.rr * Math.sin(t)).toFixed(1)}`; }
    p.trail.setAttribute('d', d);
  };
  const point = (p, t) => {
    const x = p.x0 + p.rr * Math.cos(t), y = p.y0 - p.rr * Math.sin(t);
    p.dot.setAttribute('cx', x); p.dot.setAttribute('cy', y); p.spoke.setAttribute('x2', x); p.spoke.setAttribute('y2', y);
    arc(p, t);
    return [x, y];
  };
  const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
  function frame(k, f) {                 // draw step k at progress f in [0, 1]
    const e = ease(Math.min(1, f * 1.15));
    if (k === 0) bars.forEach(({ b, v }, n) => {
      const local = Math.max(0, Math.min(1, e * 1.6 - n * 0.07)), h = v * 150 * local;
      b.setAttribute('y', 190 - h); b.setAttribute('height', h);
    });
    const th = -Math.PI + 2 * Math.PI * e;
    if (k === 1) { point(p2, th); thLabel.textContent = `θ = ${(th / Math.PI).toFixed(2)}π`; }
    if (k === 2) {
      const [px, py] = point(p3, th);
      let du = '', dv = '';
      for (let j = 0; j <= 160; j++) {
        const t = -Math.PI + ((th + Math.PI) * j) / 160, w = g(t);
        du += `${j ? 'L' : 'M'}${X3(t).toFixed(1)},${U3(w[0]).toFixed(1)}`;
        dv += `${j ? 'L' : 'M'}${X3(t).toFixed(1)},${U3(w[1]).toFixed(1)}`;
      }
      uPath.setAttribute('d', du); vPath.setAttribute('d', dv);
      cursor.setAttribute('x1', X3(th)); cursor.setAttribute('x2', X3(th));
      link.setAttribute('x1', px); link.setAttribute('y1', py); link.setAttribute('x2', X3(th)); link.setAttribute('y2', U3(g(th)[0]));
    }
    if (k === 3) {
      let sum = 0, dp = `M${X4(-Math.PI)},${Y4(0)}`, dn = dp;
      const N = 160, h = (th + Math.PI) / N;
      for (let j = 0; j <= N; j++) {
        const t = -Math.PI + j * h, v = F4(t);
        dp += `L${X4(t).toFixed(1)},${Y4(Math.max(0, v)).toFixed(1)}`;
        dn += `L${X4(t).toFixed(1)},${Y4(Math.min(0, v)).toFixed(1)}`;
        if (j) sum += ((F4(t - h) + v) / 2) * h;
      }
      dp += `L${X4(th)},${Y4(0)}Z`; dn += `L${X4(th)},${Y4(0)}Z`;
      pos.setAttribute('d', dp); neg.setAttribute('d', dn);
      sweep.setAttribute('x1', X4(th)); sweep.setAttribute('x2', X4(th));
      total.textContent = sum.toFixed(4);
      total.classList.toggle('done', e >= 1);
    }
  }

  let active = 0, t0 = performance.now(), paused = reduced, hover = false, holdAt = 0;
  function show(k) {
    active = k; t0 = performance.now(); holdAt = 0;
    cards.forEach((c, i) => {
      c.classList.toggle('active', i === k); c.classList.toggle('done', i < k);
      c.setAttribute('aria-current', i === k ? 'step' : 'false');
    });
    frame(k, 0);                         // start the step's drawing from its first frame
    layers.forEach((l, i) => l.classList.toggle('on', i === k));
    root.classList.remove('pulse'); void root.offsetWidth; root.classList.add('pulse');
    root.style.setProperty('--from', k);
    cap.textContent = CAPTIONS[k];
    if (reduced) frame(k, 1);
  }
  cards.forEach((c, i) => {
    c.tabIndex = 0;
    c.addEventListener('click', () => show(i));
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(i); } });
  });
  root.addEventListener('pointerenter', () => { hover = true; });
  root.addEventListener('pointerleave', () => { hover = false; t0 = performance.now() - holdAt; });
  play.addEventListener('click', () => {
    paused = !paused;
    play.textContent = paused ? 'Play' : 'Pause';
    play.setAttribute('aria-pressed', String(!paused));
    t0 = performance.now() - holdAt;
  });
  if (reduced) play.hidden = true;            // reduced motion: each step's last frame, by click
  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(root);
  function loop(now) {
    requestAnimationFrame(loop);
    if (!visible) { t0 = now - holdAt; return; }
    if (paused || hover) { t0 = now - holdAt; root.style.setProperty('--p', holdAt / STEP_MS); return; }
    holdAt = now - t0;
    const f = holdAt / STEP_MS;
    root.style.setProperty('--p', Math.min(1, f));
    frame(active, Math.min(1, f / 0.8));         // the step plays in 80% of its time, then holds
    if (f >= 1) { holdAt = 0; show((active + 1) % cards.length); }
  }
  show(0);
  if (!reduced) requestAnimationFrame(loop);
  else root.style.setProperty('--p', 1);
}

/** The hero's ornament: a power series' partial sums converging, drawn as a wave on a circle */
function heroArt(svg) {
  const g = el('g', {}, svg);
  for (let N = 1; N <= 6; N++) {
    let d = '';
    for (let k = 0; k <= 300; k++) {
      const t = -Math.PI + (2 * Math.PI * k) / 300;
      let s = 0;
      for (let j = 1; j <= N; j++) s += (Math.sin(j * t) * (j % 2 ? 1 : -1) * 2) / j;   // Fourier series of theta
      d += `${k ? 'L' : 'M'}${(t).toFixed(3)},${(-s * 0.42).toFixed(3)}`;
    }
    el('path', { d, class: `mx-art mx-art-${N}` }, g);
  }
}

export function startMathPage() {
  renderMath();
  const art = document.querySelector('.mx-hero-art');
  if (art) heroArt(art);
  const flow = document.getElementById('mx-flow');
  if (flow) startFlow(flow);
  const demo = document.getElementById('marriage-demo');
  if (demo) startMarriage(demo);
}
