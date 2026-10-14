/**
 * Fixed-position layers (drawer, modal, toast). Each layer is appended directly to
 * document.body and carries the .rep-workspace class so the --rw-* tokens resolve.
 */
import { el } from './dom.js';

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), '
  + 'textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** @returns {{node: HTMLElement, remove: Function}} */
export function createLayer(extraClass) {
  const node = el('div', { class: `rep-workspace rw-overlay ${extraClass || ''}`.trim() });
  document.body.append(node);
  return { node, remove: () => node.remove() };
}

/**
 * Keep Tab inside `container` and call `onEscape` for Escape.
 * @returns {Function} release
 */
export function trapFocus(container, onEscape) {
  const focusable = () => [...container.querySelectorAll(FOCUSABLE)]
    .filter((node) => node.offsetParent !== null || node === document.activeElement);
  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
      return;
    }
    if (event.key !== 'Tab') return;
    const nodes = focusable();
    if (!nodes.length) {
      event.preventDefault();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (!container.contains(active)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKey, true);
  return () => document.removeEventListener('keydown', onKey, true);
}

let toastLayer;
let toastTimer;

export function removeToast() {
  clearTimeout(toastTimer);
  toastLayer?.remove();
  toastLayer = undefined;
}

/** A status message that removes itself after `ms`. Only one toast shows at a time. */
export function showToast(text, ms) {
  removeToast();
  toastLayer = createLayer('rw-toast-layer');
  toastLayer.node.append(el('div', { class: 'rw-toast', role: 'status', text }));
  toastTimer = setTimeout(removeToast, ms);
}
