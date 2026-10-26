/**
 * Keeps "Rep Workspace 2" separate from the original rep-workspace while it reuses the
 * original code. Import this file FIRST, before anything from ../rep-workspace.
 *
 *  1. The data sheet: requests for /showroom-data/showroom-data.json go to the second sheet.
 *  2. Saved state: every sessionStorage key that starts with "rep-workspace" gets a "v2:"
 *     prefix, so persona, progress, drops and bookings in one copy never leak into the other.
 *
 * When a file is later copied into this folder and edited, this shim can stay as it is.
 */
export const ORIGINAL_DATA = '/showroom-data/showroom-data.json';
export const DATA_2 = '/showroom-data-2/showroom-data-2.json';
const STATE_PREFIX = 'rep-workspace';
const STATE_NAMESPACE = 'v2:';

if (!window.__rw2Namespaced) {
  window.__rw2Namespaced = true;

  // 1. data sheet
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === 'string' && input.includes(ORIGINAL_DATA)) {
      return realFetch(input.replace(ORIGINAL_DATA, DATA_2), init);
    }
    return realFetch(input, init);
  };

  // 3. share link: the original builds ".../showroom?share=..."; this page is /showroom-2
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (valueSetter && valueSetter.set) {
    Object.defineProperty(HTMLInputElement.prototype, 'value', {
      ...valueSetter,
      set(next) {
        const fixed = this.id === 'rw-share-link' && typeof next === 'string'
          ? next.replace('/showroom?', `${window.location.pathname.replace(/\/$/, '')}?`)
          : next;
        valueSetter.set.call(this, fixed);
      },
    });
  }

  // 2. session state
  const proto = Object.getPrototypeOf(window.sessionStorage);
  const isSession = (store) => {
    try {
      return store === window.sessionStorage;
    } catch (e) {
      return false;
    }
  };
  ['getItem', 'setItem', 'removeItem'].forEach((method) => {
    const original = proto[method];
    proto[method] = function namespaced(key, ...rest) {
      const scoped = isSession(this) && typeof key === 'string' && key.startsWith(STATE_PREFIX)
        ? `${STATE_NAMESPACE}${key}`
        : key;
      return original.call(this, scoped, ...rest);
    };
  });
}
