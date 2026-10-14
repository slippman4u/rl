/**
 * State for the commit flow, kept in sessionStorage (always in try/catch) with an in-memory
 * fallback: how each exception was handled, the committed order snapshot, and Reset demo.
 */

export const COMMITTED_KEY = 'rep-workspace-committed';
export const RESOLUTION_KEY = 'rep-workspace-commit';
const PERSONA_KEY = 'rep-workspace-persona';

let memory = {};

function read(key) {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(key));
    if (parsed !== null) return parsed;
  } catch (e) {
    // storage unavailable or corrupt: fall back to memory
  }
  return memory[key] ?? null;
}

function write(key, value) {
  memory[key] = value;
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // the choices last for this page view only
  }
}

/** The committed order snapshot, or null when nothing has been committed. */
export const readCommitted = () => {
  const value = read(COMMITTED_KEY);
  return value && value.committed ? value : null;
};
export const writeCommitted = (snapshot) => write(COMMITTED_KEY, { ...snapshot, committed: true });

/** How the exceptions were handled: `creditRequested`, `acks` (id to reason), `done` (notes). */
export const readResolution = () => ({
  creditRequested: false, acks: {}, done: {}, ...(read(RESOLUTION_KEY) || {}),
});
export const writeResolution = (resolution) => write(RESOLUTION_KEY, resolution);

/**
 * Clear every rep-workspace sessionStorage key except the persona, then reload so the model
 * starts again from the sheet (the plan overlay lives in memory as well as in storage).
 */
export function resetDemo() {
  memory = {};
  try {
    const keys = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      keys.push(window.sessionStorage.key(i));
    }
    keys
      .filter((key) => key.startsWith('rep-workspace-') && key !== PERSONA_KEY)
      .forEach((key) => window.sessionStorage.removeItem(key));
  } catch (e) {
    // nothing stored, or storage blocked
  }
  // replaceState fires no hashchange, so the shell cannot re-save its state before the reload
  window.history.replaceState(null, '', '#/home');
  window.location.reload();
}
