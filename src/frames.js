// The frames page (frames.html): my master's thesis and the LAA paper, with everything computed live.
//
// - "A harmonic frame in the plane": m evenly spaced vectors of norm sqrt(2/m); dragging x shows that the squared
//   inner products always add up to 1 (a Parseval frame).
// - "Choose the split": the thesis' exact norm of a run of n consecutive vectors, against the MSS bound for r = 2.
// - "Partition an ETF": the paper's frame from the recursive skew-symmetric conference matrix C(k). A subset's outer
//   Gramian norm is ||F_S|| = (1 + alpha * sigma_max(C_S)) / 2 (the subset's block of R = I + i alpha C, halved),
//   computed here by power iteration, for Algorithm 1's diagonal partition, a random one, or the paper's
//   counterexample.
// - The bounds chart (the paper's Fig. 2, with the diagonal partition's actual norms for n = 64).
import { renderMath } from './math.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const COLOR = { mss: '#d95926', ours: '#3987e5', triple: '#199e70', actual: '#9085e9', run: '#ffa53a', rest: '#3987e5' };
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};
const mss = (r, delta) => (1 / Math.sqrt(r) + Math.sqrt(delta)) ** 2;

// ---------- the ETF of the paper ----------
function conference(k) {
  let M = [[0, -1], [1, 0]];
  for (let s = 1; s < k; s++) {
    const h = M.length, N = Array.from({ length: 2 * h }, () => new Array(2 * h).fill(0));
    for (let i = 0; i < h; i++)
      for (let j = 0; j < h; j++) {
        const I = i === j ? 1 : 0;
        N[i][j] = M[i][j]; N[i][j + h] = M[i][j] - I; N[i + h][j] = M[i][j] + I; N[i + h][j + h] = -M[i][j];
      }
    M = N;
  }
  return M;
}

/** ||F_S|| = (1 + alpha sigma_max(C_S)) / 2, sigma_max by power iteration on C_S^T C_S */
function subsetNorm(C, S) {
  const q = S.length, n = C.length, alpha = 1 / Math.sqrt(n - 1);
  if (q === 1) return 0.5;
  let v = S.map((_, i) => 1 + 0.01 * i), lam = 0;
  for (let it = 0; it < 300; it++) {
    const w = S.map((a) => S.reduce((s, b, j) => s + C[a][b] * v[j], 0));            // C_S v
    const u = S.map((_, i) => S.reduce((s, b, j) => s + C[b][S[i]] * w[j], 0));       // C_S^T w
    const nrm = Math.hypot(...u);
    if (!nrm) break;
    v = u.map((x) => x / nrm);
    if (Math.abs(nrm - lam) < 1e-12 * nrm) { lam = nrm; break; }
    lam = nrm;
  }
  return 0.5 * (1 + alpha * Math.sqrt(lam));
}

/** Algorithm 1: the diagonal partition of [2^k] into r runs of consecutive indices */
function diagonalPartition(k, r) {
  const d = Math.floor(Math.log2(r)), rp = 2 ** d, P = [];
  let start = 0;
  const run = (size) => { P.push(Array.from({ length: size }, (_, i) => start + i)); start += size; };
  for (let i = 0; i < 2 * (r - rp); i++) run(2 ** (k - d - 1));
  for (let i = r - rp; i < rp; i++) run(2 ** (k - d));
  return P;
}

function randomPartition(n, r) {
  const idx = [...Array(n).keys()].sort(() => Math.random() - 0.5), P = Array.from({ length: r }, () => []);
  idx.forEach((v, i) => P[i < r ? i : Math.floor(Math.random() * r)].push(v));
  return P.map((s) => s.sort((a, b) => a - b));
}

// ---------- 1. a harmonic frame in the plane ----------
function startFrameDemo(root) {
  const svg = root.querySelector('.fr-svg'), mIn = root.querySelector('[data-m]'), bars = root.querySelector('.fr-bars');
  const sumOut = root.querySelector('[data-sum]');
  let m = +mIn.value, phi = 0.6;
  el('circle', { cx: 0, cy: 0, r: 1, class: 'fr-circle' }, svg);
  const vecs = el('g', {}, svg), xg = el('g', { class: 'fr-x' }, svg);
  const xLine = el('line', { x1: 0, y1: 0, class: 'fr-xline' }, xg);
  const xHead = el('circle', { r: 0.07, class: 'fr-xhead' }, xg);
  el('text', { class: 'fr-xlabel' }, xg).textContent = 'x';
  function draw() {
    mIn.parentElement.querySelector('output').textContent = m;
    vecs.innerHTML = '';
    const L = Math.sqrt(2 / m) / Math.sqrt(2 / 3) * 0.9;     // the m = 3 vectors drawn 0.9 long
    const vals = [];
    for (let j = 0; j < m; j++) {
      const a = (2 * Math.PI * j) / m, x = Math.cos(a), y = Math.sin(a);
      el('line', { x1: 0, y1: 0, x2: x * L, y2: -y * L, class: 'fr-vec' }, vecs);
      el('circle', { cx: x * L, cy: -y * L, r: 0.03, class: 'fr-vecdot' }, vecs);
      vals.push((2 / m) * Math.cos(phi - a) ** 2);
    }
    const tx = Math.cos(phi), ty = Math.sin(phi);
    xLine.setAttribute('x2', tx); xLine.setAttribute('y2', -ty);
    xHead.setAttribute('cx', tx); xHead.setAttribute('cy', -ty);
    const lab = xg.querySelector('text'); lab.setAttribute('x', tx * 1.13 - 0.03); lab.setAttribute('y', -ty * 1.13 + 0.04);
    bars.innerHTML = vals.map((v, j) => `<span style="flex:${v}" title="|⟨x,f${j}⟩|² = ${v.toFixed(3)}"></span>`).join('');
    sumOut.textContent = vals.reduce((a, b) => a + b, 0).toFixed(3);
  }
  const toPhi = (e) => {
    const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    phi = Math.atan2(-y, x); draw();
  };
  let dragging = false;
  svg.addEventListener('pointerdown', (e) => { dragging = true; svg.setPointerCapture(e.pointerId); toPhi(e); });
  svg.addEventListener('pointermove', (e) => dragging && toPhi(e));
  svg.addEventListener('pointerup', () => { dragging = false; });
  mIn.addEventListener('input', () => { m = +mIn.value; draw(); });
  draw();
}

// ---------- 2. splitting the circle in two ----------
const runNorm = (m, n) => n / m + Math.sin((2 * Math.PI * n) / m) / (m * Math.sin((2 * Math.PI) / m));
function nmax(m) {
  const b = mss(2, 2 / m);
  let n = 0;
  while (n + 1 < m && runNorm(m, n + 1) <= b) n++;
  return n;
}
function startSplitDemo(root) {
  const svg = root.querySelector('.fr-svg'), curve = root.querySelector('.fr-curve');
  const mIn = root.querySelector('[data-m]'), nIn = root.querySelector('[data-n]'), verdict = root.querySelector('.fr-verdict');
  el('circle', { cx: 0, cy: 0, r: 1, class: 'fr-circle' }, svg);
  const g = el('g', {}, svg);
  function draw() {
    const m = +mIn.value;
    nIn.max = m - 1;
    if (+nIn.value > m - 1) nIn.value = m - 1;
    const n = +nIn.value;
    mIn.parentElement.querySelector('output').textContent = m;
    nIn.parentElement.querySelector('output').textContent = n;
    g.innerHTML = '';
    for (let j = 0; j < m; j++) {
      const a = (2 * Math.PI * j) / m, inRun = j < n;
      el('line', { x1: 0, y1: 0, x2: Math.cos(a) * 0.95, y2: -Math.sin(a) * 0.95, class: 'fr-vec', stroke: inRun ? COLOR.run : COLOR.rest, 'stroke-opacity': m > 60 ? 0.65 : 0.9 }, g);
    }
    const n1 = runNorm(m, n), n2 = runNorm(m, m - n), b = mss(2, 2 / m), nm = nmax(m);
    root.querySelector('[data-n1]').textContent = n1.toFixed(4);
    root.querySelector('[data-n2]').textContent = n2.toFixed(4);
    root.querySelector('[data-b]').textContent = b.toFixed(4);
    root.querySelector('[data-nmax]').textContent = `${nm} (${(nm / m).toFixed(3)} m)`;
    const ok = Math.max(n1, n2) <= b;
    verdict.className = `fr-verdict ${ok ? 'pass' : 'fail'}`;
    verdict.textContent = ok ? '✓ Both pieces are within the MSS bound: a valid partition.' : '✗ A piece exceeds the MSS bound: not a valid MSS partition.';
    // the curve: max(||F_S1||, ||F_S2||) against n, the bound, the current n
    curve.innerHTML = '';
    const W = 320, H = 120, pad = { l: 34, r: 8, t: 8, b: 22 }, ys = [0.3, Math.max(1.05, b + 0.05)];
    const X = (k) => pad.l + ((k - 1) / Math.max(1, m - 2)) * (W - pad.l - pad.r), Y = (v) => H - pad.b - ((v - ys[0]) / (ys[1] - ys[0])) * (H - pad.t - pad.b);
    for (const v of [0.5, 1]) {
      el('line', { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), class: 'fr-grid' }, curve);
      el('text', { x: pad.l - 5, y: Y(v) + 3, class: 'fr-axis', 'text-anchor': 'end' }, curve).textContent = v.toFixed(1);
    }
    el('text', { x: W - pad.r, y: H - 5, class: 'fr-axis', 'text-anchor': 'end' }, curve).textContent = 'run length n →';
    let d = '';
    for (let k = 1; k < m; k++) d += `${k === 1 ? 'M' : 'L'}${X(k).toFixed(1)},${Y(Math.max(runNorm(m, k), runNorm(m, m - k))).toFixed(1)}`;
    el('path', { d, class: 'fr-line', stroke: COLOR.ours }, curve);
    el('line', { x1: pad.l, x2: W - pad.r, y1: Y(b), y2: Y(b), class: 'fr-bound', stroke: COLOR.mss }, curve);
    el('text', { x: W - pad.r, y: Y(b) - 4, class: 'fr-axis', 'text-anchor': 'end' }, curve).textContent = 'MSS bound';
    el('circle', { cx: X(n), cy: Y(Math.max(n1, n2)), r: 4.5, class: 'fr-dot', fill: ok ? COLOR.ours : COLOR.mss }, curve);
  }
  mIn.addEventListener('input', draw);
  nIn.addEventListener('input', draw);
  draw();
}

// ---------- 3. partition an ETF ----------
const COUNTER = [2, 5, 7, 8, 9, 10, 11, 13, 14, 16, 17, 19, 21, 25, 27, 31];
function startRDemo(root) {
  const canvas = root.querySelector('canvas'), ctx = canvas.getContext('2d');
  const kIn = root.querySelector('[data-k]'), rIn = root.querySelector('[data-r]'), list = root.querySelector('.fr-subsets');
  const verdict = root.querySelector('.fr-verdict');
  let mode = 'diagonal', P = [], C = conference(+kIn.value);
  const HUES = ['#3987e5', '#d95926', '#199e70', '#9085e9', '#c98500', '#d55181'];
  function partition() {
    const k = +kIn.value, n = 2 ** k, r = +rIn.value;
    if (mode === 'diagonal') return diagonalPartition(k, r);
    if (mode === 'random') return randomPartition(n, r);
    const S = COUNTER.map((i) => i - 1), rest = [...Array(32).keys()].filter((i) => !S.includes(i));
    return [S, ...rest.map((i) => [i])];
  }
  function update(newPartition = true) {
    if (mode === 'counter') { kIn.value = 5; rIn.max = 32; rIn.value = 17; }
    const k = +kIn.value, n = 2 ** k;
    C = conference(k);
    rIn.max = Math.min(n, 32);
    if (+rIn.value > +rIn.max) rIn.value = rIn.max;
    const r = +rIn.value;
    kIn.parentElement.querySelector('output').textContent = `${n} (k = ${k})`;
    rIn.parentElement.querySelector('output').textContent = r;
    if (newPartition) P = partition();
    const norms = P.map((S) => subsetNorm(C, S));
    const worst = Math.max(...norms), ours = 0.5 + 1 / Math.sqrt(2 * r), bound = mss(r, 0.5);
    root.querySelector('[data-max]').textContent = worst.toFixed(4);
    root.querySelector('[data-ours]').textContent = ours.toFixed(4);
    root.querySelector('[data-mss]').textContent = bound.toFixed(4);
    const ok = worst <= bound + 1e-12;
    verdict.className = `fr-verdict ${ok ? 'pass' : 'fail'}`;
    verdict.textContent = ok
      ? (mode === 'diagonal' ? `✓ Every piece is within our sharper bound, and so within MSS.` : '✓ This partition happens to satisfy the MSS bound.')
      : '✗ A piece exceeds the MSS bound: this partition is not an MSS partition.';
    list.innerHTML = P.map((S, h) => {
      const bad = norms[h] > bound + 1e-12;
      const label = S.length <= 6 ? `{${S.map((i) => i + 1).join(', ')}}` : `{${S.slice(0, 4).map((i) => i + 1).join(', ')}, …} (${S.length})`;
      return `<li class="${bad ? 'bad' : ''}"><i style="background:${HUES[h % HUES.length]}"></i><span>${label}</span><b>${norms[h].toFixed(4)}</b></li>`;
    }).join('');
    paint();
  }
  function paint() {
    const n = C.length, size = canvas.clientWidth || 320, dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const strip = 10, cell = (size - strip - 4) / n, o = strip + 4;
    ctx.clearRect(0, 0, size, size);
    const owner = new Array(n).fill(0);
    P.forEach((S, h) => S.forEach((i) => { owner[i] = h; }));
    const focus = mode === 'counter' ? new Set(P[0]) : null;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = HUES[owner[i] % HUES.length];
      ctx.fillRect(o + i * cell, 0, Math.max(1, cell - 0.5), strip);
      ctx.fillRect(0, o + i * cell, strip, Math.max(1, cell - 0.5));
      for (let j = 0; j < n; j++) {
        const v = C[i][j];
        ctx.fillStyle = v > 0 ? '#3987e5' : v < 0 ? '#d95926' : '#383835';
        const same = owner[i] === owner[j];
        ctx.globalAlpha = focus ? (focus.has(i) && focus.has(j) ? 1 : 0.18) : (same ? 1 : 0.32);
        ctx.fillRect(o + j * cell, o + i * cell, Math.max(0.6, cell - (cell > 6 ? 1 : 0.3)), Math.max(0.6, cell - (cell > 6 ? 1 : 0.3)));
      }
    }
    ctx.globalAlpha = 1;
    if (mode === 'diagonal') {
      ctx.strokeStyle = '#e9eef7'; ctx.lineWidth = 1.5;
      P.forEach((S) => ctx.strokeRect(o + S[0] * cell, o + S[0] * cell, S.length * cell, S.length * cell));
    }
  }
  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    root.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('active', x === b));
    update(true);
  }));
  const leaveCounter = () => {
    if (mode === 'counter') { mode = 'diagonal'; root.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('active', x.dataset.mode === 'diagonal')); }
  };
  kIn.addEventListener('input', () => { leaveCounter(); update(true); });
  rIn.addEventListener('input', () => { leaveCounter(); update(true); });
  new ResizeObserver(() => paint()).observe(canvas);
  update(true);
}

// ---------- 4. the bounds chart ----------
function startChart(root) {
  const svg = root.querySelector('.fr-chart-svg'), tip = root.querySelector('.fr-tip'), body = root.querySelector('tbody');
  const R = Array.from({ length: 32 }, (_, i) => i + 1);
  const actual = R.map((r) => Math.max(...diagonalPartition(6, r).map((S) => 0.5 + 0.5 * Math.sqrt((S.length - 1) / 63))));
  const SERIES = [
    { key: 'mss', label: 'MSS bound', f: (r) => mss(r, 0.5) },
    { key: 'ours', label: 'Theorem 1.5 = pairs bound', short: 'Thm 1.5 = pairs', f: (r) => 0.5 + 1 / Math.sqrt(2 * r) },
    { key: 'triple', label: 'Triples bound (complex)', short: 'Triples', f: (r) => 0.5 + Math.sqrt(1.5 / r) },
    { key: 'actual', label: 'Algorithm 1, n = 64 (actual)', short: 'Algorithm 1', f: (r) => actual[r - 1] },
  ];
  root.querySelector('.fr-legend').innerHTML = SERIES.map((s) => `<span><i style="background:${COLOR[s.key]}"></i>${s.label}</span>`).join('');
  body.innerHTML = R.map((r) => `<tr><td>${r}</td>${[SERIES[0], SERIES[1], SERIES[1], SERIES[2]].map((s) => `<td>${s.f(r).toFixed(4)}</td>`).join('')}</tr>`).join('');
  function draw() {
    const W = Math.max(320, svg.clientWidth || 720), H = 300, pad = { l: 44, r: 120, t: 14, b: 34 };
    const narrow = W < 560;
    if (narrow) pad.r = 14;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = '';
    const ymin = 0.4, ymax = 3.0;
    const X = (r) => pad.l + ((r - 1) / 31) * (W - pad.l - pad.r), Y = (v) => H - pad.b - ((v - ymin) / (ymax - ymin)) * (H - pad.t - pad.b);
    for (const v of [0.5, 1, 1.5, 2, 2.5, 3]) {
      el('line', { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), class: 'fr-grid' }, svg);
      el('text', { x: pad.l - 8, y: Y(v) + 4, class: 'fr-axis', 'text-anchor': 'end' }, svg).textContent = v.toFixed(1);
    }
    for (const r of [1, 4, 8, 12, 16, 20, 24, 28, 32]) el('text', { x: X(r), y: H - 12, class: 'fr-axis', 'text-anchor': 'middle' }, svg).textContent = r;
    el('text', { x: W - pad.r, y: H - 0.5, class: 'fr-axis', 'text-anchor': 'end' }, svg).textContent = 'number of subsets r';
    el('text', { x: pad.l, y: pad.t - 2, class: 'fr-axis' }, svg).textContent = 'outer Gramian norm';
    const ends = [];
    for (const s of SERIES) {
      const d = R.map((r, i) => `${i ? 'L' : 'M'}${X(r).toFixed(1)},${Y(s.f(r)).toFixed(1)}`).join('');
      el('path', { d, class: 'fr-line', stroke: COLOR[s.key], ...(s.key === 'actual' ? { 'stroke-dasharray': '1 0' } : {}) }, svg);
      ends.push({ s, y: Y(s.f(32)) });
    }
    if (!narrow) {                                   // direct labels at the right end, pushed apart
      ends.sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 15);
      ends.forEach(({ s, y }) => { el('text', { x: X(32) + 8, y: y + 4, class: 'fr-endlabel' }, svg).textContent = s.short || s.label; });
    }
    const cross = el('line', { y1: pad.t, y2: H - pad.b, class: 'fr-cross', visibility: 'hidden' }, svg);
    const dots = SERIES.map((s) => el('circle', { r: 4.5, fill: COLOR[s.key], class: 'fr-hdot', visibility: 'hidden' }, svg));
    const hit = el('rect', { x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: H - pad.t - pad.b, fill: 'transparent' }, svg);
    const show = (e) => {
      const b = svg.getBoundingClientRect(), px = ((e.clientX - b.left) / b.width) * W;
      const r = Math.min(32, Math.max(1, Math.round(1 + ((px - pad.l) / (W - pad.l - pad.r)) * 31)));
      cross.setAttribute('x1', X(r)); cross.setAttribute('x2', X(r)); cross.setAttribute('visibility', 'visible');
      SERIES.forEach((s, i) => { dots[i].setAttribute('cx', X(r)); dots[i].setAttribute('cy', Y(s.f(r))); dots[i].setAttribute('visibility', 'visible'); });
      tip.innerHTML = `<b>r = ${r}</b>` + SERIES.map((s) => `<span><i style="background:${COLOR[s.key]}"></i>${s.label}<em>${s.f(r).toFixed(4)}</em></span>`).join('');
      tip.style.left = `${Math.min(b.width - 230, Math.max(0, (X(r) / W) * b.width + 14))}px`;
      tip.classList.add('on');
    };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', () => { tip.classList.remove('on'); cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); });
  }
  new ResizeObserver(draw).observe(svg);
  draw();
}

/** The hero's ornament: two harmonic frames turning against each other, one run of vectors highlighted */
function heroArt(svg) {
  const ring = (m, cls, len) => {
    const g = el('g', { class: cls }, svg);
    for (let j = 0; j < m; j++) {
      const a = (2 * Math.PI * j) / m;
      el('line', { x1: 0, y1: 0, x2: Math.cos(a) * len, y2: Math.sin(a) * len, class: j < m / 3 ? 'run' : '' }, g);
      el('circle', { cx: Math.cos(a) * len, cy: Math.sin(a) * len, r: 0.018 }, g);
    }
  };
  el('circle', { cx: 0, cy: 0, r: 1, class: 'fr-art-circle' }, svg);
  ring(24, 'fr-art-a', 0.98);
  ring(9, 'fr-art-b', 0.62);
}

export function startFramesPage() {
  renderMath();
  const art = document.querySelector('.fr-hero-art');
  if (art) heroArt(art);
  const on = (id, f) => { const e = document.getElementById(id); if (e) f(e); };
  on('frame-demo', startFrameDemo);
  on('split-demo', startSplitDemo);
  on('r-demo', startRDemo);
  on('bounds-chart', startChart);
}
