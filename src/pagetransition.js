// Page transitions: going from one page of the site to another slides, like an app. The new page comes in from
// the right while the old one moves off to the left and dims; going back (the browser's back button, or any
// link to the home page, like the "← Research" links) slides the other way. The nav bar stays put.
// A link clicked on the site first plays the flight down a dendrite (src/dive.js); the next page then emerges
// out of it (the 'dive' type), and where the flight stopped stays behind the page, blurred: the page's own 3D
// background fades in over it (slowly), and pages without one keep it.
//
// - This is the browser's own cross-document View Transitions (Chrome and Edge 126+, Safari 18.2+). Other
//   browsers, and anyone with reduced motion turned on, simply change pages as before.
// - The plugin in vite.config.js writes both parts into every page's <head>, inline: the browser decides how
//   to animate as the new page first paints, before any stylesheet or module from Vite would have loaded.

const EASE = 'cubic-bezier(0.65, 0, 0.15, 1)';
const DURATION = '0.7s';

export const TRANSITION_CSS = `
@view-transition { navigation: auto; }
@media (prefers-reduced-motion: reduce) { @view-transition { navigation: none; } }
.nav { view-transition-name: site-nav; }
::view-transition-group(root) { animation-duration: ${DURATION}; }
::view-transition-old(root), ::view-transition-new(root) {
  animation-duration: ${DURATION}; animation-timing-function: ${EASE}; animation-fill-mode: both; mix-blend-mode: normal;
}
::view-transition-old(root) { animation-name: vt-under-out; }
::view-transition-new(root) { animation-name: vt-sheet-in; box-shadow: -40px 0 80px rgba(0, 0, 0, 0.55); }
html:active-view-transition-type(back)::view-transition-old(root) { animation-name: vt-sheet-out; z-index: 1; box-shadow: -40px 0 80px rgba(0, 0, 0, 0.55); }
html:active-view-transition-type(back)::view-transition-new(root) { animation-name: vt-under-in; box-shadow: none; }
html:active-view-transition-type(dive)::view-transition-old(root) { animation: vt-fade-out 1.4s ease both; box-shadow: none; }
html:active-view-transition-type(dive)::view-transition-new(root) { animation: vt-emerge 1.1s cubic-bezier(0.25, 0.6, 0.3, 1) both; box-shadow: none; }
html:active-view-transition-type(dive)::view-transition-group(site-nav) { animation: none; }
html:active-view-transition-type(dive)::view-transition-old(site-nav) { animation: none; opacity: 0; }
html:active-view-transition-type(dive)::view-transition-new(site-nav) { animation: vt-fade-in 0.9s ease 0.25s both; }
html[data-backdrop] body::before {
  content: ''; position: fixed; inset: 0; z-index: -3; pointer-events: none;
  background: #05070d var(--dive-backdrop) center / cover no-repeat;
  filter: blur(14px) brightness(0.5) saturate(1.1); transform: scale(1.1);
}
html[data-backdrop] #neuron, html[data-backdrop] #sb-bg { transition-duration: 3s; }
@keyframes vt-fade-out { to { opacity: 0; } }
@keyframes vt-fade-in { from { opacity: 0; } }
@keyframes vt-emerge { from { transform: scale(1.03); opacity: 0; filter: brightness(0.25); } }
@keyframes vt-sheet-in { from { transform: translateX(100%); } }
@keyframes vt-sheet-out { to { transform: translateX(100%); } }
@keyframes vt-under-out { to { transform: translateX(-30%); filter: brightness(0.45); } }
@keyframes vt-under-in { from { transform: translateX(-30%); filter: brightness(0.45); } }
`.replace(/\n\s*/g, ' ').trim();

// runs in the new page, before it first paints: which way to slide
function pickDirection() {
  // arriving from a flight: where it stopped stays behind the page, blurred, from the first frame on
  try {
    const shot = sessionStorage.getItem('dive-backdrop');
    if (shot) {
      sessionStorage.removeItem('dive-backdrop');
      document.documentElement.dataset.backdrop = '';
      document.documentElement.style.setProperty('--dive-backdrop', `url("${shot}")`);
    }
  } catch (err) { /* no storage */ }
  addEventListener('pagereveal', (e) => {
    if (!e.viewTransition) return;
    const a = window.navigation && navigation.activation;
    // arriving from the dendrite flight (src/dive.js): the page emerges out of it
    let dive = false;
    try { dive = sessionStorage.getItem('vt-dive') === '1'; sessionStorage.removeItem('vt-dive'); } catch (err) { /* no storage */ }
    if (dive && !(a && a.navigationType === 'traverse')) { e.viewTransition.types.add('dive'); return; }
    let back = false;
    if (a && a.navigationType === 'traverse' && a.from && a.entry) back = a.entry.index < a.from.index;
    else if (a && a.from) back = /\/(index\.html)?$/.test(location.pathname);   // to the home page
    e.viewTransition.types.add(back ? 'back' : 'forward');
  });
}

export const TRANSITION_JS = `(${pickDirection.toString()})();`;
