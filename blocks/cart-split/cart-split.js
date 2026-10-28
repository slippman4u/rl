import { events } from '@dropins/tools/event-bus.js';
import { readBlockConfig } from '../../scripts/aem.js';
import { estimateFor, addBusinessDays } from '../../scripts/shipping-mock.js';

import '../../scripts/initializers/cart.js';

/*
 * Split cart, step 1 of 2 (demo).
 * The buyer assigns every cart product to ship-to locations in an accordion, one section per
 * location. "Place split orders" is SIMULATED: it shows one order number per location and
 * changes nothing in Commerce. Step 2 replaces placeOrders() below with real order placement.
 * Locations, shares and transit days are demo values: edit DOORS.
 */
// "match" picks the customer's saved address for each location (name, street or city).
const ALL_DOORS = [
  {
    id: 'D01', name: 'Acme HQ', city: 'Cincinnati, OH', share: 40, transit: 2, match: /1500 vine|cincinnati/i,
  },
  {
    id: 'D02', name: 'Acme West Coast DC', city: 'West Coast', share: 35, transit: 5, match: /west coast/i,
  },
  {
    id: 'D03', name: 'Acme East Coast DC', city: 'East Coast', share: 25, transit: 3, match: /east coast/i,
  },
];

// The locations in use: the first N of ALL_DOORS (the "Locations" row of the block table).
let DOORS = ALL_DOORS;
export const useLocations = (n) => {
  DOORS = ALL_DOORS.slice(0, Math.max(1, Math.min(ALL_DOORS.length, Math.floor(Number(n)) || ALL_DOORS.length)));
  return DOORS;
};

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

/* ---------- pure logic (exported for tests) ---------- */

/** Cart lines in a simple shape. */
export function linesOf(cart) {
  const items = Array.isArray(cart?.items) ? cart.items : [];
  return items
    .map((it, i) => {
      const qty = Math.max(0, Math.floor(Number(it.quantity) || 0));
      const value = Number(it.total?.value) || (Number(it.price?.value) || 0) * qty;
      return {
        key: String(it.uid || it.sku || `line-${i}`) + (it.uid ? '' : `|${i}`),
        name: String(it.name || ''),
        sku: String(it.sku || ''),
        qty,
        unit: qty ? value / qty : 0,
      };
    })
    .filter((l) => l.qty > 0);
}

// How a line is assigned before the buyer touches it: spread by door share, all in the first
// location, or nothing assigned (the "Start" row of the block table).
let START = 'spread';
export const useStart = (mode) => {
  START = ['spread', 'first', 'empty'].includes(mode) ? mode : 'spread';
};

function startingSplit(qty) {
  let parts;
  if (START === 'empty') parts = DOORS.map(() => 0);
  else if (START === 'first') parts = DOORS.map((d, i) => (i === 0 ? qty : 0));
  else parts = apportion(qty, DOORS.map((d) => d.share));
  parts.qty = qty;
  return parts;
}

/**
 * Keep the buyer's assignments across cart updates. A line whose assignments still add up
 * to its quantity is kept; any other line is spread by door share.
 */
export function syncAllocation(alloc, lines) {
  const next = new Map();
  lines.forEach((l) => {
    const old = alloc.get(l.key);
    // keep the buyer's assignment while the line's quantity is unchanged
    if (old && old.qty === l.qty) {
      next.set(l.key, old);
    } else {
      next.set(l.key, startingSplit(l.qty));
    }
  });
  return next;
}

/** Orders per location from the assignments. */
export function buildPlan(lines, alloc, today = new Date()) {
  const plan = DOORS.map((door) => ({
    door, lines: [], units: 0, value: 0, readyShip: null, backShip: null,
  }));
  lines.forEach((l) => {
    const per = alloc.get(l.key) || DOORS.map(() => 0);
    const est = estimateFor({ name: l.name, quantity: l.qty }, today);
    const readyTotal = est.shipments.filter((s) => s.status === 'ready').reduce((a, s) => a + s.units, 0);
    const readyShip = est.shipments.find((s) => s.status === 'ready')?.ships || null;
    const backShip = est.shipments.find((s) => s.status === 'backorder')?.ships || null;
    const readyPer = apportion(readyTotal, per);
    per.forEach((units, i) => {
      if (!units) return;
      const row = plan[i];
      const ready = Math.min(units, readyPer[i]);
      row.lines.push({
        key: l.key, name: l.name, sku: l.sku, units, ready, back: units - ready, value: units * l.unit,
      });
      row.units += units;
      row.value += units * l.unit;
      if (ready && readyShip && (!row.readyShip || readyShip > row.readyShip)) row.readyShip = readyShip;
      if (units - ready && backShip && (!row.backShip || backShip > row.backShip)) row.backShip = backShip;
    });
  });
  return plan;
}

/** Units not yet assigned per line (negative when over-assigned). */
export function remaining(lines, alloc) {
  return lines.map((l) => ({
    line: l,
    left: l.qty - (alloc.get(l.key) || []).reduce((a, b) => a + b, 0),
  }));
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * STEP 1: simulated. Resolves with one made-up order number per location that has products.
 * STEP 2 replaces this with real order placement (one cart and one order per location).
 */
export async function placeOrders(plan, onProgress, delay = 450) {
  const used = plan.filter((p) => p.units > 0);
  const base = 862000 + (Date.now() % 9000);
  const done = [];
  for (let i = 0; i < used.length; i += 1) {
    onProgress({ index: i, total: used.length, door: used[i].door, state: 'working' });
    // eslint-disable-next-line no-await-in-loop
    await sleep(delay);
    const order = {
      door: used[i].door,
      units: used[i].units,
      value: used[i].value,
      number: `RL-F27-${base + i * 7919}`,
    };
    done.push(order);
    onProgress({
      index: i, total: used.length, door: used[i].door, state: 'done', order,
    });
  }
  return done;
}

/* ---------- block ---------- */

function arrival(label, ship, transit) {
  const from = addBusinessDays(ship, transit);
  const to = addBusinessDays(ship, transit + 2);
  return `${label} ships ${fmtDate.format(ship)}, arrives ${range(from, to)}`;
}

export default function decorate(block) {
  /*
   * Block table options (all optional):
   *   Locations       how many locations to show, 1 to 3 (default 3)
   *   Start           spread (by door share, default), first (all in the first location)
   *                   or empty (nothing assigned until the buyer does it)
   *   Mode            simulate (default) or real
   *   Payment Method  payment code to use in real mode (default checkmo)
   *   Shipping Method carrier_method to use in real mode (default flatrate_flatrate)
   */
  const raw = readBlockConfig(block);
  const cfg = {
    real: String(raw.mode || '').toLowerCase() === 'real',
    locations: Number(raw.locations) || 3,
    start: ['spread', 'first', 'empty'].includes(String(raw.start || '').toLowerCase())
      ? String(raw.start).toLowerCase()
      : 'spread',
    payment: String(raw['payment-method'] || 'checkmo'),
    shipping: String(raw['shipping-method'] || 'flatrate_flatrate'),
  };
  useLocations(cfg.locations);
  useStart(cfg.start);
  const state = {
    lines: [],
    alloc: new Map(),
    open: new Set([0]),
    progress: [],
    log: [],
    result: null,
    error: '',
    partial: [],
    placing: false,
    busy: false, // while orders are placed the cart changes under us, so ignore cart updates
  };

  block.classList.add('cs-ready');
  block.textContent = '';
  block.hidden = true;

  function setUnits(key, doorIndex, value) {
    const line = state.lines.find((l) => l.key === key);
    if (!line) return;
    const current = [...(state.alloc.get(key) || DOORS.map(() => 0))];
    const n = Math.max(0, Math.min(line.qty, Math.floor(Number(value) || 0)));
    current[doorIndex] = n;
    current.qty = line.qty;
    state.alloc.set(key, current);
    state.result = null;
    paint();
  }

  function resetShares() {
    state.alloc = new Map();
    state.alloc = syncAllocation(state.alloc, state.lines);
    state.result = null;
    state.progress = [];
    paint();
  }

  function onStep(p) {
    state.progress = state.progress.filter((x) => x.index !== p.index);
    state.progress.push(p);
    if (p.note) state.log.push(`${p.door.name}: ${p.note}`);
    paint();
  }

  async function place(plan) {
    state.placing = true;
    state.busy = true;
    state.progress = [];
    state.log = [];
    state.result = null;
    state.error = '';
    state.partial = [];
    paint();
    try {
      if (cfg.real) {
        const { placeRealOrders } = await import('./split-orders.js');
        state.result = await placeRealOrders({
          plan,
          config: { payment: cfg.payment, shipping: cfg.shipping },
          onStep,
        });
        state.lines = [];
        state.alloc = new Map();
      } else {
        state.result = await placeOrders(plan, onStep);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Split orders failed', e);
      state.error = e.message || 'Something went wrong';
      state.partial = e.completed || [];
      if (state.partial.length) {
        // some orders went through and the rest was put back, so show what the cart holds now
        const latest = events.lastPayload('cart/data');
        state.lines = latest && Number(latest.totalQuantity) > 0 ? linesOf(latest) : [];
        state.alloc = syncAllocation(new Map(), state.lines);
      }
      // otherwise nothing changed and the buyer's assignments are kept
    } finally {
      state.placing = false;
      state.busy = false;
      paint();
    }
  }

  function statusBar(rem) {
    const bar = el('div', 'cs-status');
    bar.setAttribute('role', 'status');
    const open = rem.filter((r) => r.left !== 0);
    if (!open.length) {
      const total = state.lines.reduce((a, l) => a + l.qty, 0);
      bar.classList.add('cs-status-ok');
      bar.append(el('strong', '', `All ${num.format(total)} units are assigned`));
      return bar;
    }
    const left = open.reduce((a, r) => a + r.left, 0);
    bar.classList.add('cs-status-warn');
    bar.append(el('strong', '', left > 0 ? `${num.format(left)} units left to assign` : `${num.format(-left)} units over-assigned`));
    const ul = el('ul', 'cs-status-list');
    open.forEach((r) => {
      ul.append(el('li', '', r.left > 0
        ? `${r.line.name}: ${num.format(r.left)} left`
        : `${r.line.name}: ${num.format(-r.left)} too many`));
    });
    bar.append(ul);
    return bar;
  }

  function section(row, index) {
    const isOpen = state.open.has(index);
    const wrap = el('section', `cs-acc${isOpen ? ' is-open' : ''}`);
    const panelId = `cs-panel-${index}`;

    const btn = el('button', 'cs-acc-head');
    btn.type = 'button';
    btn.setAttribute('aria-expanded', String(isOpen));
    btn.setAttribute('aria-controls', panelId);
    btn.dataset.k = `head|${index}`;
    const title = el('span', 'cs-acc-title');
    title.append(
      el('span', 'cs-acc-chev', isOpen ? '−' : '+'),
      el('strong', '', row.door.name),
      el('span', 'cs-acc-city', `${row.door.id} · ${row.door.city}`),
    );
    const sum = el('span', 'cs-acc-sum', row.units
      ? `${num.format(row.units)} units · ${money.format(row.value)}`
      : 'No products assigned');
    btn.append(title, sum);
    btn.addEventListener('click', () => {
      if (state.open.has(index)) state.open.delete(index); else state.open.add(index);
      paint();
    });
    wrap.append(btn);

    if (isOpen) {
      const panel = el('div', 'cs-acc-panel');
      panel.id = panelId;
      const table = el('div', 'cs-rows');
      state.lines.forEach((l) => {
        const units = (state.alloc.get(l.key) || [])[index] || 0;
        const r = el('div', 'cs-row');
        const label = el('span', 'cs-row-name', l.name);
        const input = el('input', 'cs-input');
        input.type = 'number';
        input.min = '0';
        input.max = String(l.qty);
        input.step = '1';
        input.value = String(units);
        input.dataset.k = `in|${index}|${l.key}`;
        input.setAttribute('aria-label', `${l.name} units for ${row.door.name}`);
        input.addEventListener('input', () => setUnits(l.key, index, input.value));
        r.append(
          label,
          el('span', 'cs-row-of', `of ${num.format(l.qty)}`),
          input,
          el('span', 'cs-row-value', money.format(units * l.unit)),
        );
        table.append(r);
      });
      panel.append(table);

      const ready = row.lines.reduce((a, l) => a + l.ready, 0);
      const back = row.lines.reduce((a, l) => a + l.back, 0);
      if (ready && row.readyShip) {
        panel.append(el('p', 'cs-eta cs-eta-ok', arrival(`${num.format(ready)} in stock`, row.readyShip, row.door.transit)));
      }
      if (back && row.backShip) {
        panel.append(el('p', 'cs-eta cs-eta-late', arrival(`${num.format(back)} backordered`, row.backShip, row.door.transit)));
      }
      wrap.append(panel);
    }
    return wrap;
  }

  function progressList() {
    const ul = el('ul', 'cs-progress');
    state.progress
      .sort((a, b) => a.index - b.index)
      .forEach((p) => {
        let cls = 'is-working';
        let text = `${p.door.name}: placing order...`;
        if (p.state === 'done') {
          cls = 'is-done';
          text = `${p.door.name}: order ${p.order.number} placed`;
        } else if (p.state === 'failed') {
          cls = 'is-failed';
          text = `${p.door.name}: failed${p.note ? ` - ${p.note}` : ''}`;
        }
        ul.append(el('li', cls, text));
      });
    return ul;
  }

  function logPanel() {
    const d = el('details', 'cs-log');
    d.open = !!state.error;
    d.append(el('summary', '', 'Step log'));
    const ul = el('ul');
    state.log.forEach((line) => ul.append(el('li', '', line)));
    d.append(ul);
    return d;
  }

  function resultPanel(orders, title) {
    const box = el('div', 'cs-result');
    box.append(el('h3', 'cs-result-title', title));
    const grid = el('div', 'cs-result-grid');
    orders.forEach((o) => {
      const c = el('div', 'cs-result-card');
      c.append(
        el('strong', '', o.number),
        el('span', '', o.door.name),
        el('span', '', `${num.format(o.units)} units · ${money.format(o.value)}`),
        o.kind ? el('span', 'cs-result-kind', o.kind) : null,
      );
      grid.append(c);
    });
    box.append(grid);
    if (!cfg.real) box.append(el('p', 'cs-note', 'Simulated. Nothing was placed in Commerce.'));
    return box;
  }

  function errorPanel() {
    const box = el('div', 'cs-error');
    box.setAttribute('role', 'alert');
    box.append(el('strong', '', 'The split orders stopped'));
    box.append(el('p', '', state.error));
    box.append(el('p', 'cs-note', state.partial.length
      ? `${state.partial.length} order(s) were already placed. The products for the rest are back in the cart.`
      : 'No orders were placed. Your cart was put back as it was.'));
    return box;
  }

  function paint() {
    const showing = state.lines.length || state.result || state.error;
    if (!showing) {
      block.hidden = true;
      return;
    }
    if (!state.lines.length) {
      const only = [];
      if (state.error) {
        if (state.partial.length) only.push(resultPanel(state.partial, `${state.partial.length} orders placed before it stopped`));
        only.push(errorPanel());
        if (state.log.length) only.push(logPanel());
      } else {
        only.push(resultPanel(state.result, state.result.length === 1 ? '1 order placed' : `${state.result.length} orders placed`));
      }
      block.replaceChildren(...only);
      block.hidden = false;
      return;
    }
    const focusKey = document.activeElement?.dataset?.k;
    const plan = buildPlan(state.lines, state.alloc);
    const rem = remaining(state.lines, state.alloc);
    const total = plan.reduce((a, p) => a + p.units, 0);
    const value = plan.reduce((a, p) => a + p.value, 0);
    const usedDoors = plan.filter((p) => p.units > 0).length;
    const ready = rem.every((r) => r.left === 0) && usedDoors > 0;

    const head = el('div', 'cs-head');
    const title = el('div');
    title.append(
      el('p', 'cs-label', 'Ship to multiple locations'),
      el('h2', 'cs-title', usedDoors === 1 ? 'Ships as 1 order' : `Splits into ${usedDoors} orders`),
      el('p', 'cs-sub', `${num.format(total)} units · ${money.format(value)} · each location gets its own order, PO and invoice`),
    );
    const tools = el('div', 'cs-tools');
    const reset = el('button', 'cs-btn', cfg.start === 'spread' ? 'Reset to door shares' : 'Reset assignments');
    reset.type = 'button';
    reset.addEventListener('click', resetShares);
    const all = el('button', 'cs-btn', state.open.size === DOORS.length ? 'Collapse all' : 'Expand all');
    all.type = 'button';
    all.addEventListener('click', () => {
      state.open = state.open.size === DOORS.length ? new Set() : new Set(DOORS.map((d, i) => i));
      paint();
    });
    tools.append(reset, all);
    head.append(title, tools);

    const accordion = el('div', 'cs-accordion');
    plan.forEach((row, i) => accordion.append(section(row, i)));

    const foot = el('div', 'cs-foot');
    const place1 = el('button', 'cs-place', state.placing ? 'Placing orders...' : 'Checkout');
    place1.type = 'button';
    place1.disabled = !ready || state.placing;
    place1.addEventListener('click', () => place(plan));
    foot.append(place1);
    if (!ready && !state.placing) {
      foot.append(el('span', 'cs-foot-hint', 'Assign every unit to a location to continue.'));
    }

    const parts = [head, statusBar(rem), accordion, foot];
    if (state.progress.length) parts.push(progressList());
    if (state.error) parts.push(errorPanel());
    if (state.partial.length) parts.push(resultPanel(state.partial, `${state.partial.length} orders placed before it stopped`));
    if (state.error && state.log.length) parts.push(logPanel()); // step log only shows when something fails
    if (!cfg.real) parts.push(el('p', 'cs-note', 'Locations, shares and dates are demo values. Prices shown are the cart prices.'));
    block.replaceChildren(...parts);
    block.hidden = false;

    if (focusKey && typeof block.querySelector === 'function') {
      const again = [...block.querySelectorAll('[data-k]')].find((n) => n.dataset.k === focusKey);
      if (again && typeof again.focus === 'function') again.focus({ preventScroll: true });
    }
  }

  function applyCart(cart) {
    const empty = !cart || !(Number(cart.totalQuantity) > 0);
    if (empty) {
      state.lines = [];
    } else {
      state.lines = linesOf(cart);
      state.alloc = syncAllocation(state.alloc, state.lines);
    }
    paint();
  }

  events.on('cart/data', (cart) => {
    if (state.busy) return; // orders are being placed: the cart is changing on purpose
    if (cart && Number(cart.totalQuantity) > 0) {
      // the cart has products again, so an old result no longer applies
      state.result = null;
      state.error = '';
      state.partial = [];
      state.progress = [];
      state.log = [];
    }
    applyCart(cart);
  }, { eager: true });
}

