import { el } from '../lib/dom.js';
import { formatDate, isoDate } from '../lib/format.js';
import { createLayer, trapFocus } from '../lib/overlay.js';

// The tracking figures are illustrative; nothing is sent or recorded anywhere.
const SHARE_VERSION = 3;
const EXPIRY_DAYS = [7, 14, 30];
const COPIED_MS = 2000;

let current;

export function closeShareModal() {
  if (current) current.close();
}

/** A stable, made-up token for the account and season (not a real credential). */
function tokenFor(model) {
  let h = 5381;
  `${model.account.id}|${model.account.season}|v${SHARE_VERSION}`.split('').forEach((ch) => {
    h = (h * 33 + ch.charCodeAt(0)) % 2147483647;
  });
  const second = (h * 7919) % 2147483647;
  return `${h.toString(36)}${second.toString(36)}`.slice(0, 12);
}

/**
 * Modal with a made-up share link. Nothing is sent anywhere.
 * @param {{model: Object, restoreFocus: Function}} opts
 */
export function openShareModal({ model, restoreFocus }) {
  closeShareModal();
  const layer = createLayer('rw-modal-layer');
  const backdrop = el('div', { class: 'rw-backdrop' });
  const token = tokenFor(model);
  let release;
  let copiedTimer;

  const expiry = el(
    'select',
    { class: 'rw-select', id: 'rw-share-expiry' },
    EXPIRY_DAYS.map((d) => el('option', { value: String(d), text: `${d} days` })),
  );
  const link = el('input', {
    class: 'rw-share-link', id: 'rw-share-link', type: 'text', readonly: true, 'aria-label': 'Presentation link',
  });
  const expires = el('p', { class: 'rw-muted rw-share-expires' });
  const copy = el('button', { class: 'rw-button', type: 'button', text: 'Copy' });
  const copied = el('span', { class: 'rw-share-copied', role: 'status', 'aria-live': 'polite' });
  const closeButton = el('button', {
    class: 'rw-drawer-close', type: 'button', 'aria-label': 'Close', text: '×',
  });

  function paintLink() {
    const days = Number(expiry.value);
    const until = new Date(Date.now() + days * 86400000);
    link.value = `${window.location.origin}/showroom?share=${token}&expires=${isoDate(until)}`;
    expires.textContent = `Expires ${formatDate(isoDate(until), { month: 'long', day: 'numeric', year: 'numeric' })}`;
  }

  function close() {
    if (!current) return;
    current = undefined;
    clearTimeout(copiedTimer);
    if (release) release();
    layer.remove();
    if (restoreFocus) restoreFocus();
  }

  copy.addEventListener('click', async () => {
    clearTimeout(copiedTimer);
    try {
      await navigator.clipboard.writeText(link.value);
      copy.textContent = 'Copied';
      copied.textContent = 'Link copied';
    } catch (e) {
      link.select(); // no clipboard access: leave the link selected for a manual copy
      copied.textContent = 'Copy is not available here. The link is selected, press Ctrl or Cmd C.';
    }
    copiedTimer = setTimeout(() => {
      copy.textContent = 'Copy';
      copied.textContent = '';
    }, COPIED_MS);
  });
  expiry.addEventListener('change', paintLink);
  closeButton.addEventListener('click', close);
  backdrop.addEventListener('click', close);

  const dialog = el(
    'div',
    {
      class: 'rw-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rw-share-title', tabindex: '-1',
    },
    el(
      'div',
      { class: 'rw-drawer-head' },
      el('div', {}, el('p', { class: 'rw-eyebrow', text: 'Presentation' }), el('h2', { id: 'rw-share-title', text: 'Share presentation link' })),
      closeButton,
    ),
    el('p', { class: 'rw-muted', text: 'Anyone with the link can view this plan. Nothing is sent from this prototype.' }),
    el('label', { class: 'rw-share-label', for: 'rw-share-link', text: 'Link' }),
    el('div', { class: 'rw-share-row' }, link, copy),
    copied,
    el('label', { class: 'rw-share-label', for: 'rw-share-expiry', text: 'Link expires after' }),
    expiry,
    expires,
    el(
      'ul',
      { class: 'rw-share-meta' },
      el('li', { text: `Version ${SHARE_VERSION}` }),
      el('li', { text: 'Viewed by 1 person, last viewed today' }),
    ),
  );
  layer.node.append(backdrop, dialog);
  paintLink();
  current = { close };
  release = trapFocus(dialog, close);
  requestAnimationFrame(() => layer.node.classList.add('is-open'));
  closeButton.focus();
  return current;
}
