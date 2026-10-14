import { el } from '../lib/dom.js';
import {
  formatCount, formatCurrency, formatDate,
} from '../lib/format.js';
import { readCommitted, resetDemo } from '../lib/commit-state.js';
import { fill, round2 } from '../lib/wedge-utils.js';

const STEPS = ['Received', 'Validated', 'Sent to fulfilment'];
const STEP_MS = 900;

let timers = [];
const played = new Set(); // snapshots whose status steps have already animated

const usd = (n) => formatCurrency(round2(n), 'USD');

/** A made-up but repeatable order number: RL-F27-XXXXXX from the account number and the index. */
function orderNumber(model, index) {
  const season = String(model.account.season); // e.g. "Fall 2027"
  const code = `${season.charAt(0)}${season.slice(-2)}`;
  let h = 17;
  `${model.account.number}-${index}`.split('').forEach((ch) => {
    h = (h * 31 + ch.charCodeAt(0)) % 1000003;
  });
  const digits = String(100000 + ((h * 7919) % 900000));
  return `RL-${code}-${digits}`;
}

export function render(container, model, ctx) {
  const snap = readCommitted();
  if (!snap) {
    ctx.navigate('#/commit'); // nothing has been committed yet
    return;
  }
  ctx.completeStage('commit');

  const { account } = model;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dateText = (d) => formatDate(d, { month: 'short', day: 'numeric', year: 'numeric' });

  // --- orders ---
  const orders = snap.orders.map((o, i) => ({ ...o, number: orderNumber(model, i) }));
  const orderRows = orders.map((o) => el(
    'li',
    { class: 'rw-corder' },
    el(
      'div',
      { class: 'rw-corder-main' },
      el('strong', { class: 'rw-corder-number', text: o.number }),
      el('span', { text: `${o.windowLabel} window, delivers ${dateText(o.windowDate)}` }),
    ),
    el('span', { class: 'rw-pill', 'data-tone': o.currency === 'USD' ? 'neutral' : 'plan', text: o.currency }),
    el('span', { class: 'rw-corder-units', text: `${formatCount(o.units)} units` }),
    el(
      'span',
      { class: 'rw-corder-total' },
      el('strong', { text: formatCurrency(o.native, o.currency) }),
      o.currency !== 'USD' ? el('small', { class: 'rw-corder-usd', text: `${usd(o.usd)} in USD` }) : null,
    ),
  ));

  // --- Gold ---
  const projected = account.ytdSpend + snap.totals.totalUsd;
  const crosses = projected >= account.goldThreshold;
  const gold = el(
    'section',
    { class: 'rw-gold', 'data-crossed': String(crosses), 'aria-labelledby': 'rw-gold-title' },
    el('h2', { id: 'rw-gold-title', text: crosses ? `${account.name} moves to Gold` : `${usd(account.goldThreshold - projected)} to go to Gold` }),
    el('p', {
      text: crosses
        ? `Year-to-date spend of ${usd(account.ytdSpend)} plus this ${usd(snap.totals.totalUsd)} order reaches ${usd(projected)}, past the ${usd(account.goldThreshold)} Gold threshold. Gold unlocks priority allocation on core styles and extended payment terms.`
        : `Year-to-date spend of ${usd(account.ytdSpend)} plus this ${usd(snap.totals.totalUsd)} order reaches ${usd(projected)}. That is ${usd(account.goldThreshold - projected)} short of the ${usd(account.goldThreshold)} Gold threshold.`,
    }),
  );

  // --- status steps (animate once) ---
  const stepList = el('ol', { class: 'rw-steps', 'aria-label': 'Order status' });
  const stepStates = STEPS.map(() => 'pending');
  const paintSteps = () => fill(stepList, STEPS.map((label, i) => el(
    'li',
    { class: 'rw-step-item', 'data-state': stepStates[i] },
    el('span', { class: 'rw-step-dot', 'aria-hidden': 'true', text: stepStates[i] === 'done' ? '✓' : String(i + 1) }),
    el('span', { text: label }),
    el('span', { class: 'rw-sr', text: stepStates[i] === 'done' ? ' (done)' : ' (waiting)' }),
  )));
  const firstTime = !played.has(snap.at);
  if (firstTime && !reduced) {
    played.add(snap.at);
    STEPS.forEach((label, i) => {
      timers.push(setTimeout(() => {
        stepStates[i] = 'done';
        paintSteps();
      }, STEP_MS * (i + 1)));
    });
  } else {
    stepStates.fill('done');
    played.add(snap.at);
  }
  paintSteps();

  const reset = el('button', { class: 'rw-button rw-button-outline', type: 'button', text: 'Reset demo' });
  reset.addEventListener('click', resetDemo);

  container.replaceChildren(el(
    'div',
    { class: 'rw-confirm' },
    el(
      'section',
      { class: 'rw-card rw-confirm-head', 'aria-labelledby': 'rw-confirm-title' },
      el('p', { class: 'rw-eyebrow', text: 'Order committed' }),
      el('h1', {
        id: 'rw-confirm-title', class: 'rw-confirm-title', tabindex: '-1', text: `Thank you, ${account.buyerName.split(/\s+/)[0]}`,
      }),
      el('p', { class: 'rw-confirm-sub', text: `${account.name} · ${account.season} · signed by ${snap.name} on ${formatDate(snap.at.slice(0, 10), { month: 'long', day: 'numeric', year: 'numeric' })}` }),
    ),
    el(
      'section',
      { class: 'rw-card', 'aria-labelledby': 'rw-orders-title' },
      el('h2', { id: 'rw-orders-title', text: `${orders.length} ${orders.length === 1 ? 'order' : 'orders'}` }),
      el('ul', { class: 'rw-corders' }, orderRows),
      el(
        'p',
        { class: 'rw-corder-grand' },
        el('span', { text: `${formatCount(snap.totals.units)} units in total` }),
        el('strong', { class: 'rw-corder-grandvalue', text: `Grand total ${usd(snap.totals.totalUsd)}` }),
      ),
    ),
    gold,
    el(
      'section',
      { class: 'rw-card', 'aria-labelledby': 'rw-next-title' },
      el('h2', { id: 'rw-next-title', text: 'What happens next' }),
      el('p', { text: `A confirmation email is on its way to ${account.buyerName}, with the order numbers above.` }),
      stepList,
    ),
    el(
      'div',
      { class: 'rw-actions' },
      el('a', { class: 'rw-button', href: '#/home', text: 'Return to showroom home' }),
      reset,
    ),
  ));
  container.querySelector('h1')?.focus({ preventScroll: true });
}

export function destroy() {
  timers.forEach(clearTimeout);
  timers = [];
}
