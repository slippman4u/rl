/*
 * Plan commit: the shared status of the buyer's planned assortment, kept in this browser so the
 * planned assortment page (buyer) and Rep Workspace 2 (rep) can see each other's actions.
 *
 *   draft -> submitted (buyer commits) -> confirmed (rep confirms)
 *                                      -> changes   (rep asks for changes) -> submitted again
 *
 * Demo grade: it lives in localStorage, so it works across tabs on one machine. A production
 * version would keep this in Commerce, for example as a negotiable quote.
 */
const KEY = 'plan-commit:v1';
const STATES = ['submitted', 'confirmed', 'changes'];

let memory = null; // used when browser storage is blocked
const listeners = new Set();

function clean(raw) {
  if (!raw || typeof raw !== 'object' || !STATES.includes(raw.status)) return null;
  return {
    status: raw.status,
    ref: String(raw.ref || '').slice(0, 40),
    season: String(raw.season || '').slice(0, 80),
    account: String(raw.account || '').slice(0, 120),
    by: String(raw.by || '').slice(0, 120),
    styles: Number(raw.styles) || 0,
    units: Number(raw.units) || 0,
    doors: Number(raw.doors) || 0,
    cost: Number(raw.cost) || 0,
    retail: Number(raw.retail) || 0,
    at: Number(raw.at) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
    note: String(raw.note || '').slice(0, 500),
  };
}

export function getCommit() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return clean(JSON.parse(raw));
    return null;
  } catch (e) {
    return clean(memory);
  }
}

function save(next) {
  memory = next;
  try {
    if (next) window.localStorage.setItem(KEY, JSON.stringify(next));
    else window.localStorage.removeItem(KEY);
  } catch (e) { /* storage blocked: memory still holds it for this page */ }
  listeners.forEach((fn) => fn(getCommit() || clean(next)));
}

/** Call `fn(commit)` whenever the status changes, here or in another tab. Returns an unsubscribe. */
export function onCommitChange(fn) {
  listeners.add(fn);
  const handler = (e) => { if (e.key === KEY) fn(getCommit()); };
  window.addEventListener('storage', handler);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', handler);
  };
}

/** Buyer commits the plan. `summary` carries the season, account, by and totals. */
export function submitCommit(summary) {
  const current = getCommit();
  const now = Date.now();
  save({
    ...summary,
    status: 'submitted',
    ref: current?.ref || `PA-${String(now).slice(-6)}`,
    at: now,
    updatedAt: now,
    note: '',
  });
}

/** Rep action: 'confirmed' or 'changes' (with a note). */
export function setStatus(status, note = '') {
  const current = getCommit();
  if (!current || !['confirmed', 'changes'].includes(status)) return;
  save({
    ...current, status, note: String(note).slice(0, 500), updatedAt: Date.now(),
  });
}

/** Back to a draft (withdraw, or reset the demo). */
export function clearCommit() {
  save(null);
}

export const dateText = (ms) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(ms || Date.now()));
