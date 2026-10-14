import { getModel } from './lib/data.js';
import { el, icon } from './lib/dom.js';
import * as session from './lib/session.js';

const STAGES = [
  { id: 'home', label: 'Home', href: '#/home' },
  { id: 'prepare', label: 'Prepare', href: '#/account/acme' },
  { id: 'visit', label: 'Visit', href: '#/appointment' },
  { id: 'present', label: 'Present', href: '#/wedge' },
  { id: 'commit', label: 'Commit', href: '#/commit' },
];

/** Hash route -> stage (for the rail) and view module. Unknown routes go to #/home. */
const ROUTES = {
  '#/signin': { stage: null, load: () => import('./views/signin.js') },
  '#/home': { stage: 'home', load: () => import('./views/home.js') },
  '#/account/acme': { stage: 'prepare', load: () => import('./views/account.js') },
  '#/plan': { stage: 'prepare', load: () => import('./views/plan.js') },
  '#/appointment': { stage: 'visit', load: () => import('./views/appointment.js') },
  '#/wedge': { stage: 'present', load: () => import('./views/wedge.js') },
  '#/order': { stage: 'present', load: () => import('./views/order.js') },
  '#/commit': { stage: 'commit', load: () => import('./views/commit.js') },
  '#/confirmation': { stage: 'commit', load: () => import('./views/confirmation.js') },
};

const SYNC_LABELS = { live: 'Live data', cached: 'Cached data', saved: 'Saved' };

function buildSkeleton() {
  const bar = (cls) => el('span', { class: `rw-skel ${cls}` });
  return el(
    'div',
    { class: 'rw-skeleton', role: 'status', 'aria-label': 'Loading the workspace' },
    el('div', { class: 'rw-skeleton-rail' }, bar('rw-skel-dot'), bar('rw-skel-dot'), bar('rw-skel-dot'), bar('rw-skel-dot'), bar('rw-skel-dot')),
    el(
      'div',
      { class: 'rw-skeleton-main' },
      el('div', { class: 'rw-skeleton-bar' }, bar('rw-skel-chip'), bar('rw-skel-chip'), bar('rw-skel-chip')),
      bar('rw-skel-title'),
      bar('rw-skel-line'),
      bar('rw-skel-line rw-skel-short'),
      el('div', { class: 'rw-skeleton-cards' }, bar('rw-skel-card'), bar('rw-skel-card'), bar('rw-skel-card')),
    ),
  );
}

const initials = (name) => name
  .split(/\s+/)
  .filter(Boolean)
  .map((part) => part[0])
  .slice(0, 2)
  .join('')
  .toUpperCase();

function createApp(block, model) {
  let current; // the mounted view module
  let latestRoute; // identifies the newest navigation so stale async renders can bail out
  let firstRender = true;

  const doneIds = new Set(session.getDone());
  const stageIndex = (id) => STAGES.findIndex((stage) => stage.id === id);

  // --- rail -----------------------------------------------------------------------------
  const railItems = STAGES.map((stage) => {
    const done = el('span', { class: 'rw-done' }, icon('check'), el('span', { class: 'rw-sr' }));
    const link = el(
      'a',
      { class: 'rw-rail-link', href: stage.href, 'data-stage': stage.id },
      el('span', { class: 'rw-rail-icon' }, icon(stage.id), done),
      el('span', { class: 'rw-rail-label', text: stage.label }),
    );
    return { stage, link, item: el('li', {}, link) };
  });
  const rail = el(
    'nav',
    { class: 'rw-rail', 'aria-label': 'Stages' },
    el('ul', {}, railItems.map((r) => r.item)),
  );

  // --- context bar ----------------------------------------------------------------------
  const syncText = el('span', { class: 'rw-sync-text' });
  const sync = el('span', { class: 'rw-sync', role: 'status' }, el('span', { class: 'rw-sync-dot', 'aria-hidden': 'true' }), syncText);
  const syncState = model.source.cached ? 'cached' : 'live';
  let savedTimer;
  const showSync = (state) => {
    sync.dataset.state = state;
    syncText.textContent = SYNC_LABELS[state];
  };
  showSync(syncState);
  model.subscribe(() => {
    showSync('saved');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => showSync(syncState), 1800);
  });

  const presentButton = el('button', {
    class: 'rw-ghost rw-present-toggle', type: 'button', 'aria-pressed': 'false', text: 'Present',
  });
  const exitButton = el('button', { class: 'rw-ghost rw-exit-present', type: 'button', text: 'Exit presentation' });
  const signOutButton = el('button', { class: 'rw-ghost rw-sign-out', type: 'button', text: 'Sign out' });

  const context = el(
    'div',
    { class: 'rw-context', role: 'banner' },
    el('span', { class: 'rw-brand', text: 'Showroom' }),
    el(
      'div',
      { class: 'rw-rep' },
      el('span', { class: 'rw-avatar', 'aria-hidden': 'true', text: initials(model.rep.name) }),
      el('span', { class: 'rw-rep-text' }, el('strong', { text: model.rep.name }), el('small', { text: model.rep.title })),
    ),
    el('a', { class: 'rw-chip rw-chip-account', href: '#/account/acme', text: model.account.name }),
    el('span', { class: 'rw-chip rw-chip-season', text: model.account.season }),
    el('span', { class: 'rw-spacer' }),
    sync,
    presentButton,
    exitButton,
    signOutButton,
  );

  const view = el('div', { class: 'rw-view', id: 'rw-view', tabindex: '-1' });
  const main = el('div', { class: 'rw-main' }, context, view);
  block.replaceChildren(rail, main);
  block.dataset.state = 'ready';

  // --- state helpers --------------------------------------------------------------------
  function paintRail(activeStage) {
    railItems.forEach(({ stage, link }) => {
      if (stage.id === activeStage) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
      const isDone = doneIds.has(stage.id);
      link.dataset.done = String(isDone);
      link.querySelector('.rw-sr').textContent = isDone ? ' (done)' : '';
    });
  }

  function persistDone() {
    session.setDone([...doneIds]);
  }

  /** Entering a stage completes every earlier stage. */
  function markEarlierDone(stageId) {
    const index = stageIndex(stageId);
    STAGES.slice(0, Math.max(index, 0)).forEach((stage) => doneIds.add(stage.id));
    persistDone();
  }

  function applyPresentation(on) {
    session.setPresentation(on);
    if (on) block.dataset.presentation = 'on';
    else delete block.dataset.presentation;
    presentButton.setAttribute('aria-pressed', String(on));
  }

  const ctx = {
    model,
    navigate(hash) { window.location.hash = hash; },
    completeStage(id) {
      if (stageIndex(id) < 0) return;
      doneIds.add(id);
      persistDone();
      paintRail(ROUTES[window.location.hash]?.stage);
    },
    signIn(persona) {
      session.setPersona(persona);
      window.location.hash = '#/home';
    },
    isPresentation: () => session.isPresentation(),
    setPresentation: (on) => applyPresentation(on === true),
    isDone: (id) => doneIds.has(id),
  };

  // --- router ---------------------------------------------------------------------------
  async function route() {
    const token = Symbol('route');
    latestRoute = token;
    let { hash } = window.location;
    if (!ROUTES[hash]) hash = '#/home';
    const signedIn = !!session.getPersona();
    if (!signedIn && hash !== '#/signin') hash = '#/signin';
    else if (signedIn && hash === '#/signin') hash = '#/home';
    if (hash !== window.location.hash) window.history.replaceState(null, '', hash);

    const { stage, load } = ROUTES[hash];
    let mod;
    try {
      mod = await load();
    } catch (e) {
      console.error('rep-workspace: could not load view', hash, e);
      return;
    }
    if (token !== latestRoute) return; // a newer navigation superseded this one

    if (current?.destroy) current.destroy();
    current = mod;
    view.replaceChildren();
    block.dataset.mode = hash === '#/signin' ? 'signin' : 'app';
    block.dataset.route = hash.slice(2).replace(/\//g, '-');
    if (stage) markEarlierDone(stage);
    paintRail(stage);
    try {
      await mod.render(view, model, ctx);
    } catch (e) {
      console.error('rep-workspace: view failed to render', hash, e);
      view.replaceChildren(el('p', { class: 'rw-error', role: 'alert', text: 'This screen could not be displayed.' }));
    }
    if (!firstRender && hash !== '#/signin') view.focus({ preventScroll: true });
    firstRender = false;
    window.scrollTo(0, 0);
  }

  presentButton.addEventListener('click', () => applyPresentation(true));
  exitButton.addEventListener('click', () => applyPresentation(false));
  signOutButton.addEventListener('click', () => {
    session.clearPersona();
    doneIds.clear(); // a new sign-in starts with fresh progress
    persistDone();
    applyPresentation(false);
    window.location.hash = '#/signin';
    route(); // the hash may already be #/signin, so re-evaluate explicitly
  });
  window.addEventListener('hashchange', route);

  applyPresentation(session.isPresentation());
  return route();
}

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default async function decorate(block) {
  document.body.classList.add('showroom');
  block.dataset.state = 'loading';
  block.replaceChildren(buildSkeleton());

  let model;
  try {
    model = await getModel();
  } catch (e) {
    console.error('rep-workspace: could not load the model', e);
    const retry = el('button', { class: 'rw-button', type: 'button', text: 'Try again' });
    retry.addEventListener('click', () => decorate(block));
    block.dataset.state = 'error';
    block.replaceChildren(el(
      'div',
      { class: 'rw-error-panel', role: 'alert' },
      el('h1', { text: 'Showroom is unavailable' }),
      el('p', { text: 'The showroom data could not be loaded.' }),
      retry,
    ));
    return;
  }
  await createApp(block, model);
}
