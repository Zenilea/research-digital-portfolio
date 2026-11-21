// All the scroll effects on the site live here.
// Every page is complete without this file: it only adds motion on top.

// Tells the page that this file arrived. If it never does, a small check in the
// page head puts the plain version back (see layouts/Base.astro).
window.__siteReady = true;

const root = document.documentElement;
const motion = root.classList.contains('motion');
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
const clamp01 = (n) => Math.min(1, Math.max(0, n));

/* ------------------------------------------------------------------
   One scroll listener for everything, run at most once per frame.
------------------------------------------------------------------- */
const scrollTasks = [];
let queued = false;

function runScrollTasks() {
  queued = false;
  for (const task of scrollTasks) task();
}

function requestScrollTasks() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(runScrollTasks);
}

/* Reading-progress bar at the top of the page. */
const progressBar = document.querySelector('.progress span');
if (progressBar) {
  scrollTasks.push(() => {
    const max = root.scrollHeight - window.innerHeight;
    progressBar.style.transform = `scaleX(${max > 0 ? clamp01(window.scrollY / max).toFixed(4) : 0})`;
  });
}

/* ------------------------------------------------------------------
   Reveal on scroll. Things already on screen are left alone.
------------------------------------------------------------------- */
const reveals = $$('[data-reveal]');
if (motion && reveals.length && 'IntersectionObserver' in window) {
  const limit = window.innerHeight * 0.94;
  for (const el of reveals) {
    if (el.getBoundingClientRect().top < limit) el.classList.add('is-in');
  }
  root.classList.add('reveal-on');

  const revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        revealObserver.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -6% 0px', threshold: 0.04 },
  );
  for (const el of reveals) {
    if (!el.classList.contains('is-in')) revealObserver.observe(el);
  }
}

/* ------------------------------------------------------------------
   Phone menu.
------------------------------------------------------------------- */
const nav = document.querySelector('[data-nav]');
const navToggle = nav && nav.querySelector('[data-nav-toggle]');
if (nav && navToggle) {
  const setOpen = (open) => {
    nav.classList.toggle('is-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
  };
  navToggle.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && nav.classList.contains('is-open')) {
      setOpen(false);
      navToggle.focus();
    }
  });
  document.addEventListener('click', (event) => {
    if (nav.classList.contains('is-open') && !nav.contains(event.target)) setOpen(false);
  });
}

/* ------------------------------------------------------------------
   Home: the pinned five-step story.
   Without this script the five steps are a plain stacked list.
------------------------------------------------------------------- */
const story = document.querySelector('[data-story]');
if (story && motion) {
  const pin = story.querySelector('.story__pin');
  const steps = $$('[data-story-step]', story);
  const ticks = $$('[data-story-tick]', story);
  const fill = story.querySelector('[data-story-fill]');
  const counter = story.querySelector('[data-story-count]');
  let live = false;
  let current = 0;

  story.style.setProperty('--steps', String(steps.length));

  // Pin the story only when a whole step fits in the pinned frame: the drawing,
  // its text and the "not results" label. On a screen too short for that
  // (a phone held sideways, a very small window) it stays a plain list.
  const fitStory = () => {
    const y = window.scrollY;
    story.classList.add('is-live', 'is-measuring');
    const fits =
      pin.scrollHeight <= pin.clientHeight + 1 && steps.every((step) => step.scrollHeight <= step.clientHeight + 1);
    story.classList.remove('is-measuring');
    if (!fits) {
      story.classList.remove('is-live');
      story.removeAttribute('data-step');
      current = 0;
    }
    live = fits;
    if (window.scrollY !== y) window.scrollTo({ top: y, behavior: 'instant' });
  };
  fitStory();

  let seenWidth = window.innerWidth;
  let seenHeight = root.clientHeight;
  window.addEventListener(
    'resize',
    () => {
      // A phone's address bar sliding away is not a new screen size.
      if (window.innerWidth === seenWidth && root.clientHeight === seenHeight) return;
      seenWidth = window.innerWidth;
      seenHeight = root.clientHeight;
      fitStory();
    },
    { passive: true },
  );

  scrollTasks.push(() => {
    if (!live) return;
    const rect = story.getBoundingClientRect();
    const travel = rect.height - window.innerHeight;
    const p = travel > 0 ? clamp01(-rect.top / travel) : 0;
    const n = Math.min(steps.length, Math.floor(p * steps.length) + 1);
    if (fill) fill.style.transform = `scaleX(${p.toFixed(4)})`;
    if (n === current) return;
    current = n;
    story.dataset.step = String(n);
    steps.forEach((step, i) => step.classList.toggle('is-active', i === n - 1));
    ticks.forEach((tick, i) => tick.classList.toggle('is-done', i < n));
    if (counter) counter.textContent = String(n).padStart(2, '0');
  });
}

/* ------------------------------------------------------------------
   Home: the question lights up word by word.
------------------------------------------------------------------- */
const question = document.querySelector('[data-question]');
if (question && motion) {
  const words = $$('[data-w]', question);
  let lit = -1;
  question.classList.add('is-live');

  scrollTasks.push(() => {
    const rect = question.getBoundingClientRect();
    const start = window.innerHeight * 0.88;
    const end = window.innerHeight * 0.32;
    const n = Math.round(clamp01((start - rect.top) / (start - end)) * words.length);
    if (n === lit) return;
    lit = n;
    words.forEach((word, i) => word.classList.toggle('is-lit', i < n));
  });
}

/* ------------------------------------------------------------------
   Number counters. The real value is already in the HTML.
------------------------------------------------------------------- */
const counters = $$('[data-count]');
if (motion && counters.length && 'IntersectionObserver' in window) {
  const play = (el) => {
    const target = parseFloat(el.dataset.count);
    const decimals = Number(el.dataset.decimals || 0);
    const finalText = el.textContent;
    const duration = 1500;
    let startTime = 0;

    const frame = (now) => {
      if (!startTime) startTime = now;
      const k = clamp01((now - startTime) / duration);
      const eased = 1 - Math.pow(1 - k, 4);
      el.textContent = k < 1 ? (target * eased).toFixed(decimals) : finalText;
      if (k < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };

  const countObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        countObserver.unobserve(entry.target);
        play(entry.target);
      }
    },
    { threshold: 0.6 },
  );

  for (const el of counters) {
    // Hold the width so the digits do not push anything around.
    el.style.display = 'inline-block';
    el.style.minWidth = `${el.getBoundingClientRect().width}px`;
    countObserver.observe(el);
  }
}

/* ------------------------------------------------------------------
   Scroll spy: step lists, the Process sub-nav, the lit review contents.
   Marks the link for the section being read, and the section itself.
------------------------------------------------------------------- */
for (const spy of $$('[data-spy]')) {
  const links = $$('a[href^="#"]', spy);
  const pairs = [];
  for (const link of links) {
    const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
    if (target) pairs.push([target, link]);
  }
  if (!pairs.length) continue;

  let activeLink;
  scrollTasks.push(() => {
    const line = window.innerHeight * 0.38;
    let active = null;
    for (const pair of pairs) {
      if (pair[0].getBoundingClientRect().top <= line) active = pair;
    }
    const link = active ? active[1] : null;
    if (link === activeLink) return;
    activeLink = link;
    for (const [target, other] of pairs) {
      const on = other === link;
      if (on) other.setAttribute('aria-current', 'true');
      else other.removeAttribute('aria-current');
      target.classList.toggle('is-active', on);
    }
    // Keep the active item in view when the list scrolls sideways on phones.
    if (link && spy.scrollWidth > spy.clientWidth + 4) {
      const left = link.offsetLeft - (spy.clientWidth - link.offsetWidth) / 2;
      spy.scrollTo({ left, behavior: motion ? 'smooth' : 'auto' });
    }
  });
}

/* ------------------------------------------------------------------
   Research: filter chips for the source library.
------------------------------------------------------------------- */
const showAllSources = [];
for (const group of $$('[data-filter-group]')) {
  const chips = $$('[data-filter]', group);
  const items = $$('[data-cat]', group);
  const status = group.querySelector('[data-filter-status]');

  const apply = (category) => {
    let shown = 0;
    for (const item of items) {
      const show = category === 'all' || item.dataset.cat === category;
      item.hidden = !show;
      if (show) shown += 1;
    }
    for (const chip of chips) {
      chip.setAttribute('aria-pressed', String(chip.dataset.filter === category));
    }
    if (status) status.textContent = `Showing ${shown} of ${items.length} sources`;
  };

  for (const chip of chips) {
    chip.addEventListener('click', () => apply(chip.dataset.filter));
  }
  showAllSources.push(() => apply('all'));
}

/* ------------------------------------------------------------------
   A link to one source (…/research/#src-rankin-2014) opens that row.
------------------------------------------------------------------- */
function openLinkedRow() {
  if (window.location.hash.length < 2) return;
  const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
  if (!target || target.tagName !== 'DETAILS') return;
  // A filter may be hiding the row. Show every source again, then go to it.
  const filteredOut = Boolean(target.closest('[hidden]'));
  if (filteredOut) for (const showAll of showAllSources) showAll();
  target.open = true;
  if (filteredOut) target.scrollIntoView({ block: 'start' });
}
window.addEventListener('hashchange', openLinkedRow);
openLinkedRow();

/* ------------------------------------------------------------------
   Go.
------------------------------------------------------------------- */
window.addEventListener('scroll', requestScrollTasks, { passive: true });
window.addEventListener('resize', requestScrollTasks, { passive: true });
runScrollTasks();
