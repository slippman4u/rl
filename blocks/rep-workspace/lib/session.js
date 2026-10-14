/**
 * sessionStorage-backed shell state. Every access is wrapped in try/catch so the
 * workspace still runs (statelessly) when storage is blocked.
 */

const KEYS = {
  persona: 'rep-workspace-persona',
  done: 'rep-workspace-done',
  presentation: 'rep-workspace-presentation',
};

function read(key, fallback) {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // storage unavailable: state lasts for this page view only
  }
}

// storage can be blocked, so keep an in-memory copy to stay consistent within a page view
const memory = {};

function get(name, fallback) {
  const stored = read(KEYS[name], undefined);
  return stored === undefined ? (memory[name] ?? fallback) : stored;
}

function set(name, value) {
  memory[name] = value;
  write(KEYS[name], value);
}

/** The signed-in persona (`{ name, title }`) or null. No credentials are ever stored. */
export const getPersona = () => get('persona', null);
export const setPersona = (persona) => set('persona', persona);
export const clearPersona = () => { memory.persona = null; write(KEYS.persona, null); };

/** Ids of completed stages. */
export const getDone = () => get('done', []);
export const setDone = (ids) => set('done', ids);

export const isPresentation = () => get('presentation', false) === true;
export const setPresentation = (on) => set('presentation', on === true);
