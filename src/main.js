import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import './style.css';

document.getElementById('year').textContent = new Date().getFullYear();

// in development (npm run dev) placeholders to fill in are outlined; the built site never shows that
if (import.meta.env.DEV) document.body.classList.add('show-todo');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('neuron');

import('./neuron.js')
  .then(({ startNeuron }) => startNeuron(canvas, {
    reducedMotion,
    stillTime: new URLSearchParams(location.search).has('t') ? Number(new URLSearchParams(location.search).get('t')) : null,
  }))
  .then((neuron) => {
    if (!neuron) {
      document.body.classList.add('no-webgl');
      return;
    }
    document.body.classList.add('neuron-ready');
    // ?scroll=0.5: jump half way down the page (to check the scrolled views)
    const sc = new URLSearchParams(location.search).get('scroll');
    if (sc != null) {
      document.documentElement.style.scrollBehavior = 'auto';
      const el = document.getElementById(sc);   // ?scroll=spine-gallery: jump to that element
      if (el) el.scrollIntoView();
      else window.scrollTo(0, Number(sc) * (document.documentElement.scrollHeight - window.innerHeight));
      document.querySelectorAll('.section').forEach((s) => s.classList.add('in'));
    }
    document.getElementById('fire').addEventListener('click', () => neuron.fire());
  })
  .catch((e) => {
    console.error(e);
    document.body.classList.add('no-webgl');
  });

// the spine gallery: loaded when it comes near the screen
const gallery = document.getElementById('spine-gallery');
if (gallery) {
  const near = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    near.disconnect();
    import('./spines.js')
      .then(({ startSpineGallery }) => startSpineGallery(gallery, { reducedMotion }))
      .catch((e) => { console.error(e); gallery.classList.add('sg-failed'); });
  }, { rootMargin: '600px 0px' });
  near.observe(gallery);
}

// the videos (spines page): each plays while on screen, never on its own for reduced motion
document.querySelectorAll('.film').forEach((box) => {
  const film = box.querySelector('video');
  const toggle = box.querySelector('.film-toggle');
  let userPaused = reducedMotion;
  const label = () => {
    toggle.textContent = film.paused ? 'Play' : 'Pause';
    toggle.setAttribute('aria-label', film.paused ? 'Play the video' : 'Pause the video');
  };
  film.addEventListener('play', label);
  film.addEventListener('pause', label);
  label();
  toggle.addEventListener('click', () => {
    userPaused = !film.paused;
    if (film.paused) film.play().catch(() => {});
    else film.pause();
  });
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !userPaused) film.play().catch(() => {});
    else if (!e.isIntersecting) film.pause();
  }, { threshold: 0.25 }).observe(film);

  // steps that follow the video (data-from / data-to in seconds of the video); clicking one jumps there
  const steps = [...document.querySelectorAll(`[data-video="${box.id}"] [data-from]`)];
  if (!steps.length) return;
  const mark = () => {
    const t = film.currentTime;
    steps.forEach((s) => s.classList.toggle('active', t >= +s.dataset.from && t < +s.dataset.to));
  };
  ['timeupdate', 'seeked', 'play'].forEach((ev) => film.addEventListener(ev, mark));
  steps.forEach((s) => {
    s.addEventListener('click', () => {
      film.currentTime = +s.dataset.from + 0.05;
      if (film.paused && !userPaused) film.play().catch(() => {});
    });
  });
});

// sections fade in as they come into view
const io = new IntersectionObserver(
  (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('in')),
  { threshold: 0.12 },
);
document.querySelectorAll('.section').forEach((s) => io.observe(s));
