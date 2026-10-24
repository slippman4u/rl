import { events } from '@dropins/tools/event-bus.js';
import { readBlockConfig } from '../../scripts/aem.js';

import '../../scripts/initializers/cart.js';

/*
 * Cart intelligence (demo): minimum order, season budget and order mix.
 * Thresholds come from the block table in da.live. Prices are the cart's own prices.
 * Checkout is greyed out while the minimum is not met (demo enforcement only; real
 * enforcement is a Commerce minimum-order rule).
 */

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-US');
const toNum = (v, d) => {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : d;
};

const COLORS = ['#0d1b3a', '#3b5b92', '#8aa6d6', '#c9a24b', '#6b8e6b', '#9aa0a6'];

const TYPES = [
  ['Tops', /polo|shirt|sweater|tee|top|knit|henley|blouse/i],
  ['Bottoms', /pant|chino|jean|short|trouser|skirt/i],
  ['Outerwear', /jacket|vest|coat|parka|blazer/i],
  ['Dresses', /dress/i],
  ['Accessories', /belt|cap|hat|sock|card case|wallet|bag|tie|scarf/i],
];

function typeOf(item) {
  const name = String(item?.name || '');
  const hit = TYPES.find(([, re]) => re.test(name));
  if (hit) return hit[0];
  const cat = item?.url?.categories?.[0];
  if (typeof cat === 'string' && cat) {
    const top = cat.split('/')[0].replace(/-/g, ' ');
    return top.charAt(0).toUpperCase() + top.slice(1);
  }
  return 'Other';
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v === false || v === null || v === undefined) return;
    if (k === 'class') n.className = v;
    else n.setAttribute(k, v === true ? '' : v);
  });
  kids.flat().forEach((c) => {
    if (c === null || c === undefined || c === false) return;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  });
  return n;
}

function seg(width, color, label) {
  const s = el('span', { class: 'ci-seg', title: label });
  s.style.width = `${Math.max(0, Math.min(100, width))}%`;
  s.style.backgroundColor = color;
  return s;
}

function bar(label, now, parts) {
  const b = el('div', {
    class: 'ci-bar', role: 'img', 'aria-label': label, 'data-now': Math.round(now),
  }, parts);
  return b;
}

/** Pure calculation, exported for tests. */
export function analyse(cart, cfg) {
  const items = Array.isArray(cart?.items) ? cart.items : [];
  const lines = items.map((it) => {
    const qty = Number(it.quantity) || 0;
    const total = Number(it.total?.value) || (Number(it.price?.value) || 0) * qty;
    return {
      name: String(it.name || ''), qty, total, type: typeOf(it),
    };
  });
  const subtotal = Number(cart?.subtotal?.excludingTax?.value) || lines.reduce((s, l) => s + l.total, 0);
  const units = lines.reduce((s, l) => s + l.qty, 0);
  const styles = new Set(lines.map((l) => l.name)).size;
  const mix = new Map();
  lines.forEach((l) => mix.set(l.type, (mix.get(l.type) || 0) + l.total));
  const mixList = [...mix.entries()].map(([type, value]) => ({ type, value })).sort((a, b) => b.value - a.value);
  const minMet = subtotal >= cfg.minimum;
  const used = cfg.booked + subtotal;
  return {
    subtotal, units, styles, mixList, minMet,
    toMinimum: Math.max(0, cfg.minimum - subtotal),
    minPct: cfg.minimum ? Math.min(100, (subtotal / cfg.minimum) * 100) : 100,
    used,
    remaining: Math.max(0, cfg.budget - used),
    over: Math.max(0, used - cfg.budget),
    usedPct: cfg.budget ? (used / cfg.budget) * 100 : 0,
    avg: units ? subtotal / units : 0,
  };
}

function minimumCard(cfg, a) {
  return el('section', { class: 'ci-card' },
    el('p', { class: 'ci-label' }, 'Minimum order'),
    el('p', { class: 'ci-big' }, money.format(a.subtotal), el('span', { class: 'ci-of' }, ` of ${money.format(cfg.minimum)}`)),
    bar(`Minimum order progress ${a.minPct.toFixed(0)} percent`, a.minPct,
      [seg(a.minPct, a.minMet ? '#2e7d32' : '#0d1b3a', 'This cart')]),
    el('p', { class: `ci-status ${a.minMet ? 'ci-ok' : 'ci-warn'}` },
      a.minMet ? 'Minimum met. Ready to check out.' : `${money.format(a.toMinimum)} more to reach the minimum. Checkout unlocks then.`));
}

function budgetCard(cfg, a) {
  const bookedPct = cfg.budget ? Math.min(100, (cfg.booked / cfg.budget) * 100) : 0;
  const cartPct = cfg.budget ? Math.min(100 - bookedPct, (a.subtotal / cfg.budget) * 100) : 0;
  return el('section', { class: 'ci-card' },
    el('p', { class: 'ci-label' }, `${cfg.budgetLabel} budget`),
    el('p', { class: 'ci-big' }, `${a.usedPct.toFixed(0)}%`, el('span', { class: 'ci-of' }, ` of ${money.format(cfg.budget)} used`)),
    bar(`Budget used ${a.usedPct.toFixed(0)} percent`, a.usedPct, [
      seg(bookedPct, '#9aa0a6', 'Already booked'),
      seg(cartPct, a.over ? '#b3261e' : '#0d1b3a', 'This cart'),
    ]),
    el('ul', { class: 'ci-legend' },
      el('li', {}, el('i', { class: 'ci-dot', style: 'background:#9aa0a6' }), `Already booked ${money.format(cfg.booked)}`),
      el('li', {}, el('i', { class: 'ci-dot', style: `background:${a.over ? '#b3261e' : '#0d1b3a'}` }), `This cart ${money.format(a.subtotal)}`),
      el('li', {}, el('i', { class: 'ci-dot ci-dot-empty' }), `Remaining ${money.format(a.remaining)}`)),
    a.over
      ? el('p', { class: 'ci-status ci-bad' }, `Over budget by ${money.format(a.over)}. Approval may be needed.`)
      : null);
}

function mixCard(a) {
  const total = a.mixList.reduce((s, m) => s + m.value, 0) || 1;
  return el('section', { class: 'ci-card' },
    el('p', { class: 'ci-label' }, 'Order mix'),
    el('p', { class: 'ci-big' }, `${num.format(a.units)}`, el('span', { class: 'ci-of' }, ` units across ${a.styles} ${a.styles === 1 ? 'style' : 'styles'}`)),
    bar('Order mix by category', 100, a.mixList.map((m, i) => seg((m.value / total) * 100, COLORS[i % COLORS.length], m.type))),
    el('ul', { class: 'ci-legend' },
      a.mixList.map((m, i) => el('li', {},
        el('i', { class: 'ci-dot', style: `background:${COLORS[i % COLORS.length]}` }),
        `${m.type} ${((m.value / total) * 100).toFixed(0)}% (${money.format(m.value)})`))),
    el('p', { class: 'ci-sub' }, `Average unit price ${money.format(a.avg)}`));
}

export default function decorate(block) {
  const raw = readBlockConfig(block);
  const cfg = {
    minimum: toNum(raw['minimum-order'], 5000),
    budget: toNum(raw['season-budget'], 25000),
    booked: toNum(raw['already-booked'], 9000),
    budgetLabel: String(raw['budget-label'] || 'Season'),
  };

  block.classList.add('ci-ready');
  block.textContent = '';
  block.hidden = true;

  events.on('cart/data', (cart) => {
    const empty = !cart || !(Number(cart.totalQuantity) > 0);
    if (empty) {
      block.hidden = true;
      document.body.classList.remove('cart-below-minimum');
      return;
    }
    const a = analyse(cart, cfg);
    document.body.classList.toggle('cart-below-minimum', !a.minMet);
    block.replaceChildren(
      el('div', { class: 'ci-grid' }, minimumCard(cfg, a), budgetCard(cfg, a), mixCard(a)),
      el('p', { class: 'ci-note' }, 'Thresholds and booked amounts are demo values.'),
    );
    block.hidden = false;
  }, { eager: true });
}
