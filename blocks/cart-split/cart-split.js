import { events } from '@dropins/tools/event-bus.js';
import { readBlockConfig } from '../../scripts/aem.js';
import { estimateFor, addBusinessDays } from '../../scripts/shipping-mock.js';

import '../../scripts/initializers/cart.js';

/*
 * Mock: split one cart across several ship-to doors (Story 1 and 2, CHK-2.3).
 * Every product is spread over the doors by each door's share, and each door becomes
 * its own order. Doors, shares and transit days are demo values: edit DOORS below.
 * Nothing here changes the real cart or the real checkout.
 */
const DOORS = [
  {
    id: 'D01', name: 'Chicago Flagship', city: 'Chicago, IL', share: 24, transit: 3,
  },
  {
    id: 'D02', name: 'Boston Back Bay', city: 'Boston, MA', share: 18, transit: 3,
  },
  {
    id: 'D03', name: 'Dallas NorthPark', city: 'Dallas, TX', share: 16, transit: 4,
  },
  {
    id: 'D04', name: 'Atlanta Lenox', city: 'Atlanta, GA', share: 14, transit: 2,
  },
  {
    id: 'D05', name: 'Seattle Downtown', city: 'Seattle, WA', share: 12, transit: 5,
  },
];
const MODES = [1, 3, 5];

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const num = new Intl.NumberFormat('en-US');
const fmtDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const range = (a, b) => (a.getMonth() === b.getMonth()
  ? `${fmtDate.format(a)} to ${b.getDate()}`
  : `${fmtDate.format(a)} to ${fmtDate.format(b)}`);

/** Split an integer total by weights so the parts add up exactly (largest remainder). */
export function apportion(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const quotas = weights.map((w) => (total * w) / sum);
  const parts = quotas.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  quotas
    .map((q, i) => ({ i, frac: q - Math.floor(q) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
    .forEach(({ i }) => {
      if (left > 0) { parts[i] += 1; left -= 1; }
    });
  return parts;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Pure calculation, exported for tests. */
export function splitCart(cart, count, today = new Date()) {
  const items = Array.isArray(cart?.items) ? cart.items : [];
  const doors = DOORS.slice(0, count);
  const weights = doors.map((d) => d.share);
  const result = doors.map((door) => ({
    door, lines: [], units: 0, value: 0, readyShip: null, backShip: null,
  }));

  items.forEach((item) => {
    const qty = Math.max(0, Number(item.quantity) || 0);
    if (!qty) return;
    const lineValue = Number(item.total?.value) || (Number(item.price?.value) || 0) * qty;
    const unitValue = lineValue / qty;
    const est = estimateFor({ name: item.name, quantity: qty }, today);
    const readyTotal = est.shipments.filter((s) => s.status === 'ready').reduce((a, s) => a + s.units, 0);
    const readyShip = est.shipments.find((s) => s.status === 'ready')?.ships || null;
    const backShip = est.shipments.find((s) => s.status === 'backorder')?.ships || null;

    const perDoor = apportion(qty, weights);
    const readyPerDoor = apportion(readyTotal, perDoor);
    perDoor.forEach((units, i) => {
      if (!units) return;
      const row = result[i];
      const ready = Math.min(units, readyPerDoor[i]);
      row.lines.push({
        name: String(item.name || ''), units, ready, back: units - ready,
      });
      row.units += units;
      row.value += units * unitValue;
      if (ready && readyShip && (!row.readyShip || readyShip > row.readyShip)) row.readyShip = readyShip;
      if (units - ready && backShip && (!row.backShip || backShip > row.backShip)) row.backShip = backShip;
    });
  });

  return result.filter((r) => r.units > 0);
}

function arrival(label, ship, transit) {
  const from = addBusinessDays(ship, transit);
  const to = addBusinessDays(ship, transit + 2);
  return `${label} ships ${fmtDate.format(ship)}, arrives ${range(from, to)}`;
}

function doorCard(row, index) {
  const card = el('article', 'cs-card');
  const head = el('div', 'cs-card-head');
  head.append(
    el('span', 'cs-card-no', `Order ${index + 1}`),
    el('strong', 'cs-card-name', row.door.name),
    el('span', 'cs-card-city', `${row.door.id} · ${row.door.city}`),
  );
  card.append(head);

  const list = el('ul', 'cs-lines');
  row.lines.forEach((l) => {
    const li = el('li');
    li.append(el('span', 'cs-line-name', l.name), el('span', 'cs-line-units', `${num.format(l.units)}`));
    list.append(li);
  });
  card.append(list);

  const foot = el('div', 'cs-card-foot');
  foot.append(el('span', 'cs-card-total', `${num.format(row.units)} units · ${money.format(row.value)}`));
  card.append(foot);

  const ready = row.lines.reduce((a, l) => a + l.ready, 0);
  const back = row.lines.reduce((a, l) => a + l.back, 0);
  if (ready && row.readyShip) {
    card.append(el('p', 'cs-eta cs-eta-ok', arrival(`${num.format(ready)} in stock`, row.readyShip, row.door.transit)));
  }
  if (back && row.backShip) {
    card.append(el('p', 'cs-eta cs-eta-late', arrival(`${num.format(back)} backordered`, row.backShip, row.door.transit)));
  }
  return card;
}

export default function decorate(block) {
  const raw = readBlockConfig(block);
  const wanted = Number(raw.doors);
  let count = MODES.includes(wanted) ? wanted : 5;
  let lastCart = null;

  block.classList.add('cs-ready');
  block.textContent = '';
  block.hidden = true;

  function paint() {
    if (!lastCart) return;
    const rows = splitCart(lastCart, count);
    const units = rows.reduce((a, r) => a + r.units, 0);
    const value = rows.reduce((a, r) => a + r.value, 0);

    const head = el('div', 'cs-head');
    const title = el('div');
    title.append(
      el('p', 'cs-label', 'Ship to multiple locations'),
      el('h2', 'cs-title', rows.length === 1 ? 'Ships as 1 order' : `Splits into ${rows.length} orders`),
      el('p', 'cs-sub', `${num.format(units)} units · ${money.format(value)} · each location gets its own order, PO and invoice`),
    );
    const seg = el('div', 'cs-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Number of locations');
    MODES.forEach((m) => {
      const b = el('button', 'cs-seg-btn', m === 1 ? '1 address' : `${m} locations`);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(m === count));
      b.addEventListener('click', () => { count = m; paint(); });
      seg.append(b);
    });
    head.append(title, seg);

    const grid = el('div', 'cs-grid');
    rows.forEach((r, i) => grid.append(doorCard(r, i)));

    block.replaceChildren(
      head,
      grid,
      el('p', 'cs-note', 'Locations, shares and dates are demo values. Prices shown are the cart prices.'),
    );
    block.hidden = false;
  }

  events.on('cart/data', (cart) => {
    const empty = !cart || !(Number(cart.totalQuantity) > 0);
    lastCart = empty ? null : cart;
    if (empty) {
      block.hidden = true;
      return;
    }
    paint();
  }, { eager: true });
}
