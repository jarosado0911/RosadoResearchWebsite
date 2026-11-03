// The résumé page (resume.html): reveals as the page scrolls, a table of contents that follows the reader,
// counting numbers in "At a glance", and long lists that open and close smoothly ("Show all").
// Printing (and the PDF made from the page by scripts/make_resume_pdf.mjs) shows everything open.

const SHOW = 3;            // items of a role shown before "Show all" (a list's data-show overrides it)

export function startResume({ reducedMotion = false } = {}) {
  // ---- reveal on scroll, children a little after their section ----
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add('in');
    io.unobserve(e.target);
  }), { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.rv').forEach((el, i) => {
    if (reducedMotion) { el.classList.add('in'); return; }
    el.style.setProperty('--d', `${Math.min(i % 4, 3) * 70}ms`);
    io.observe(el);
  });

  // ---- table of contents ----
  const toc = document.querySelector('.cv-toc ol');
  const secs = [...document.querySelectorAll('.cv-sec[data-title]')];
  const links = secs.map((s) => {
    const li = document.createElement('li');
    li.innerHTML = `<a href="#${s.id}">${s.dataset.title}</a>`;
    toc.appendChild(li);
    return li.firstChild;
  });
  const mark = () => {
    const y = window.innerHeight * 0.3;
    let k = 0;
    secs.forEach((s, i) => { if (s.getBoundingClientRect().top < y) k = i; });
    links.forEach((a, i) => a.classList.toggle('active', i === k));
  };
  window.addEventListener('scroll', mark, { passive: true });
  mark();

  // ---- counting numbers ----
  document.querySelectorAll('[data-count]').forEach((el) => {
    if (reducedMotion) return;
    const end = +el.dataset.count, suffix = el.dataset.suffix || '';
    el.textContent = `0${suffix}`;
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      obs.disconnect();
      const t0 = performance.now();
      const step = (t) => {
        const f = Math.min(1, (t - t0) / 900), v = Math.round(end * (1 - (1 - f) ** 3));
        el.textContent = `${v}${suffix}`;
        if (f < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    obs.observe(el);
  });

  // ---- long lists: the first few items, then "Show all n" (smooth height) ----
  document.querySelectorAll('.role-items').forEach((ul) => {
    const show = +(ul.dataset.show || (ul.closest('.subroles') ? 2 : SHOW));
    const items = [...ul.children];
    if (items.length <= show + 1) return;
    const rest = document.createElement('div');
    rest.className = 'more-items';
    const inner = document.createElement('ul');
    inner.className = ul.className;
    items.slice(show).forEach((li) => inner.appendChild(li));
    rest.appendChild(inner);
    ul.after(rest);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'show-all';
    const label = (open) => { btn.textContent = open ? 'Show less' : `Show all ${items.length}`; btn.setAttribute('aria-expanded', open); };
    label(false);
    rest.after(btn);
    btn.addEventListener('click', () => {
      const open = !rest.classList.contains('open');
      if (reducedMotion) { rest.classList.toggle('open', open); rest.style.height = open ? 'auto' : '0px'; label(open); return; }
      rest.style.height = `${open ? 0 : rest.scrollHeight}px`;
      requestAnimationFrame(() => {
        rest.classList.toggle('open', open);
        rest.style.height = `${open ? rest.scrollHeight : 0}px`;
      });
      label(open);
    });
    rest.addEventListener('transitionend', () => { if (rest.classList.contains('open')) rest.style.height = 'auto'; });
  });
}
