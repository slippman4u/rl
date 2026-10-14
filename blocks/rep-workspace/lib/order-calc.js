/**
 * The order's arithmetic, shared by the order builder, the commit screen and the confirmation:
 * delivery windows (carts), the sizes-by-doors grids, the currency split, discounts, totals and
 * the credit check. Nothing here touches the DOM.
 */
import { effectiveUnits } from './data.js';
import { apportion, apportionMatrix, formatCurrency } from './format.js';
import { round2 } from './wedge-utils.js';

export const STATE_KEY = 'rep-workspace-order';
export const WINDOW_PREFIX = 'delivery-window-';
export const EARLY_CLUSTERS = ['Core Essentials']; // everything else defaults to the later window
export const DISCOUNTS = [
  { key: 'early', term: 'early-booking-discount', label: 'Early booking discount' },
  { key: 'gold', term: 'gold-preview-discount', label: 'Gold preview discount' },
];

export const sum = (list) => list.reduce((a, b) => a + b, 0);
export const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

const freshState = () => ({
  assign: {}, // style id -> delivery window id
  matrices: {}, // color row id -> sizes x doors grid of units (only after a manual edit)
  discounts: { early: true, gold: false },
  currency: 'USD',
});

/** The saved order choices. One shared object that is updated in place. */
const saved = freshState();

export const getState = () => saved;

export function loadState() {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STATE_KEY));
    if (parsed && typeof parsed === 'object') {
      const base = freshState();
      const discounts = { ...base.discounts, ...parsed.discounts };
      Object.assign(saved, base, parsed, { discounts });
    }
  } catch (e) {
    // storage unavailable or corrupt: keep the in-memory state
  }
}

export function persist() {
  try {
    window.sessionStorage.setItem(STATE_KEY, JSON.stringify(saved));
  } catch (e) {
    // the choices last for this page view only
  }
}

/** Back to the defaults (used by "Reset demo"). */
export function resetState() {
  Object.keys(saved).forEach((key) => delete saved[key]);
  Object.assign(saved, freshState());
}

/**
 * @param {Object} model the shared model
 * @returns {Object} calculators bound to the model and the saved order state
 */
export function createOrderCalc(model) {
  const sizes = model.sizeCurve;
  const { doors } = model;
  const rate = model.account.cadRate;
  const windows = model.terms
    .filter((t) => t.key.startsWith(WINDOW_PREFIX))
    .map((t) => ({
      id: t.key.slice(WINDOW_PREFIX.length),
      label: capitalise(t.key.slice(WINDOW_PREFIX.length)),
      date: String(t.value),
    }));
  const earlyWindow = windows.find((w) => w.id === 'early') || windows[0];
  const lateWindow = windows.find((w) => w.id === 'core') || windows[windows.length - 1];
  const windowById = new Map(windows.map((w) => [w.id, w]));

  /** The delivery window a style ships in: the rep's choice, else by cluster. */
  const windowFor = (tile) => {
    const chosen = saved.assign[tile.id];
    if (windowById.has(chosen)) return chosen;
    return (EARLY_CLUSTERS.includes(tile.cluster) ? earlyWindow : lateWindow).id;
  };

  /** Amount in USD to the display currency. */
  const convert = (usd, currency = saved.currency) => round2(currency === 'CAD' ? usd * rate : usd);
  const money = (usd, currency = saved.currency) => (
    formatCurrency(convert(usd, currency), currency)
  );

  const sizeShares = sizes.map((s) => s.share);
  const doorShares = doors.map((d) => d.share);
  /** Sizes by doors, every door included (an unentitled door is flagged at commit). */
  const calcMatrix = (units) => apportionMatrix(
    apportion(units, sizeShares),
    apportion(units, doorShares),
  );

  /** A manual grid counts only while it still adds up to the color's planned units. */
  function matrixFor(row) {
    const units = effectiveUnits(row);
    const own = saved.matrices[row.id];
    const fits = own && own.length === sizes.length && own.every((r) => r.length === doors.length)
      && sum(own.map(sum)) === units;
    return fits ? own : calcMatrix(units);
  }

  /** Lines (non-dropped styles with grids), orders per window and currency, carts, totals. */
  function compute() {
    const byTile = new Map();
    model.colorRows.forEach((r) => {
      if (!byTile.has(r.tileId)) byTile.set(r.tileId, []);
      byTile.get(r.tileId).push(r);
    });
    const lines = model.tiles.filter((t) => t.status !== 'drop').map((tile) => ({
      tile,
      window: windowFor(tile),
      colors: (byTile.get(tile.id) || []).map((row) => ({ row, matrix: matrixFor(row) })),
    }));
    const orders = new Map();
    const carts = new Map(windows.map((w) => [w.id, { units: 0, usd: 0 }]));
    let units = 0;
    let usd = 0;
    lines.forEach((line) => line.colors.forEach(({ row, matrix }) => {
      doors.forEach((door, j) => {
        const u = matrix.reduce((a, r) => a + r[j], 0);
        if (!u) return;
        const value = u * row.wholesale;
        const key = `${line.window}|${door.currency}`;
        if (!orders.has(key)) {
          orders.set(key, {
            key, window: line.window, currency: door.currency, units: 0, usd: 0,
          });
        }
        const order = orders.get(key);
        order.units += u;
        order.usd += value;
        carts.get(line.window).units += u;
        carts.get(line.window).usd += value;
        units += u;
        usd += value;
      });
    }));
    return {
      lines, orders, carts, units, usd,
    };
  }

  const percentOf = (d) => Number(model.term(d.term)) || 0;

  /** Subtotal, discounts, the total and each order's total (all USD unless noted). */
  function totals(data) {
    const active = DISCOUNTS.filter((d) => saved.discounts[d.key]);
    const pct = sum(active.map(percentOf));
    const subtotal = round2(data.usd);
    const discountLines = active.map((d) => ({ d, usd: round2((subtotal * percentOf(d)) / 100) }));
    const total = round2(subtotal - sum(discountLines.map((x) => x.usd)));
    const windowIndex = (id) => windows.findIndex((w) => w.id === id);
    const orders = [...data.orders.values()]
      // earliest window first, USD before CAD
      .sort((a, b) => windowIndex(a.window) - windowIndex(b.window)
        || b.currency.localeCompare(a.currency))
      .map((o) => {
        const orderTotal = round2(o.usd * (1 - pct / 100));
        const native = o.currency === 'CAD' ? round2(orderTotal * rate) : orderTotal;
        return { ...o, total: orderTotal, native };
      });
    return {
      pct, percent: percentOf, subtotal, discountLines, total, orders,
    };
  }

  /** The order total against the available credit. */
  function credit(totalUsd) {
    const available = model.account.creditAvailable;
    const over = round2(totalUsd - available);
    return {
      available,
      limit: model.account.creditLimit,
      over,
      share: available > 0 ? totalUsd / available : 0,
      exceeds: over > 0,
    };
  }

  return {
    sizes,
    doors,
    rate,
    windows,
    windowById,
    windowFor,
    convert,
    money,
    calcMatrix,
    matrixFor,
    compute,
    totals,
    credit,
  };
}
