// The typeset math of the sub pages: every .tex (inline) and .tex-block (display) element holds TeX as its
// text, rendered by KaTeX (loaded only on pages that have math).
export function renderMath(root = document) {
  const els = root.querySelectorAll('.tex, .tex-block');
  if (!els.length) return;
  Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([{ default: katex }]) => {
    els.forEach((el) => {
      try {
        katex.render(el.textContent, el, { displayMode: el.classList.contains('tex-block'), throwOnError: false });
      } catch (e) { console.error(e); }
    });
  });
}
