// The typeset math of the sub pages: every .tex (inline) and .tex-block (display) element holds TeX as its
// text, rendered by KaTeX (loaded only on pages that have math). A display formula wider than its card is scaled
// down to fit (not below MIN_SCALE); one that still doesn't fit scrolls, with a visible scrollbar.
const MIN_SCALE = 0.7;

function fit(block) {
  const k = block.querySelector('.katex-display > .katex');
  if (!k) return;
  k.style.fontSize = '';
  block.classList.remove('tex-scroll');
  const avail = block.clientWidth, need = k.scrollWidth;
  if (!avail || need <= avail) return;
  const scale = Math.max(MIN_SCALE, (avail * 0.97) / need);
  k.style.fontSize = `${scale}em`;
  if (k.scrollWidth > block.clientWidth + 1) block.classList.add('tex-scroll');
}

export function renderMath(root = document) {
  const els = root.querySelectorAll('.tex, .tex-block');
  if (!els.length) return;
  Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([{ default: katex }]) => {
    els.forEach((el) => {
      try {
        katex.render(el.textContent, el, { displayMode: el.classList.contains('tex-block'), throwOnError: false });
      } catch (e) { console.error(e); }
    });
    const blocks = [...root.querySelectorAll('.tex-block')];
    const refit = () => blocks.forEach(fit);
    document.fonts.ready.then(refit);
    const ro = new ResizeObserver(refit);
    blocks.forEach((b) => ro.observe(b));
  });
}

/** Typeset TeX into an element now (for formulas that change with the page's controls) */
let katexLoad = null;
export function texInto(el, src, display = false) {
  katexLoad ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => m.default);
  return katexLoad.then((katex) => {
    katex.render(src, el, { displayMode: display, throwOnError: false });
    if (display && el.classList.contains('tex-block')) fit(el);
  });
}
