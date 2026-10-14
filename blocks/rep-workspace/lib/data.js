/**
 * Shared data layer for the rep workspace. Every view imports getModel() from here.
 *
 *   /showroom-data/showroom-data.json  ─┐
 *   Catalog Service (lib/commerce.js)  ─┼─> merge ─> model (tiles, doors, account, ...)
 *   sessionStorage overlay (mutations) ─┘
 *
 * Column names are read through pick() with a few aliases and are matched ignoring case and
 * punctuation (wholesale-ratio == wholesaleRatio == Wholesale Ratio). See README.md.
 */
import { fetchProducts, isCachedData } from './commerce.js';

export { isCachedData };

const DATA_URL = '/showroom-data/showroom-data.json?limit=5000';
const SESSION_KEY = 'rep-workspace-state-v2';
const DEFAULT_WHOLESALE_RATIO = 0.5;

export const STATUSES = ['carryover', 'add', 'drop'];

// ---------------------------------------------------------------------------
// Sheet normalisation
// ---------------------------------------------------------------------------

const norm = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');

function cleanRow(row) {
  const out = {};
  Object.entries(row).forEach(([key, value]) => {
    out[norm(key)] = typeof value === 'string' ? value.trim() : value;
  });
  return out;
}

/** First non-empty value among the given column names ('' when none). */
function pick(row, ...names) {
  const hit = names.map(norm).find((name) => row[name] !== undefined && row[name] !== '');
  return hit === undefined ? '' : row[hit];
}

function num(value, fallback = 0) {
  const n = parseFloat(String(value).replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

const round2 = (n) => Math.round(n * 100) / 100;
const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function normaliseStatus(value) {
  const v = norm(value);
  if (v.startsWith('drop')) return 'drop';
  if (v === 'add' || v === 'new' || v === 'added') return 'add';
  return 'carryover';
}

/** `{ "tab": { data: [...] } }` -> `{ tab: [rows] }`, one array of plain objects per tab. */
function readTabs(raw) {
  if (Array.isArray(raw?.data)) {
    throw new Error('showroom-data.json is a single sheet; expected a multi-sheet workbook');
  }
  const tabs = {};
  Object.keys(raw || {}).filter((name) => !name.startsWith(':')).forEach((name) => {
    tabs[norm(name)] = (raw[name]?.data || []).map(cleanRow);
  });
  return tabs;
}

/** A tab holding one record, either as a single row or as key/value rows. */
function singleRecord(rows) {
  if (rows.length && rows.every((r) => r.key !== undefined && r.value !== undefined)) {
    return Object.fromEntries(rows.map((r) => [norm(r.key), r.value]));
  }
  return rows[0] || {};
}

/** Published headers per tab. Key/value tabs (`account`, `terms`) list their expected keys. */
const EXPECTED = {
  styles: [
    'sku', 'name-short', 'cluster', 'tier', 'status', 'last-year-units', 'target-units',
    'planned-units',
  ],
  account: [
    'account-id', 'account-name', 'account-number', 'ytd-spend', 'open-orders',
    'units-shipped-fall-2026', 'credit-limit', 'credit-available', 'gold-threshold', 'gold-gap',
    'tier', 'showroom-contact', 'showroom-contact-email', 'showroom-contact-phone', 'buyer-name',
    'preferred-day', 'season', 'wholesale-ratio', 'cad-rate', 'rep-name', 'rep-title',
  ],
  doors: ['door-id', 'name', 'city', 'share', 'entitlement', 'currency'],
  'size-curve': ['size', 'pct'],
  slots: ['date', 'time', 'showroom', 'status'],
  appointments: ['id', 'date', 'time', 'account', 'showroom', 'type', 'status'],
  accounts: ['account-id', 'name', 'status', 'next-step'],
  terms: [
    'early-booking-discount', 'gold-preview-discount', 'minimum-units-per-color',
    'delivery-window-early', 'delivery-window-core',
  ],
  notes: ['sku', 'note'],
};
const KEY_VALUE_TABS = ['account', 'terms'];

/** Console-warn for every expected tab or column that the sheet does not provide. */
function checkColumns(tabs) {
  Object.entries(EXPECTED).forEach(([tab, columns]) => {
    const rows = tabs[norm(tab)];
    if (!rows) {
      console.warn(`rep-workspace: showroom-data.json has no "${tab}" tab`);
      return;
    }
    const present = new Set(KEY_VALUE_TABS.includes(tab)
      ? rows.map((r) => norm(r.key))
      : Object.keys(rows[0] || {}));
    columns.filter((c) => !present.has(norm(c))).forEach((c) => {
      console.warn(`rep-workspace: tab "${tab}" is missing expected ${KEY_VALUE_TABS.includes(tab) ? 'key' : 'column'} "${c}"`);
    });
  });
}

/** Door entitlement: `all`, `not:sku[,sku]` or a plain list of the only SKUs it carries. */
function carries(entitlement, sku) {
  const text = String(entitlement || 'all').trim().toLowerCase();
  if (text === 'all' || text === '') return true;
  const skus = (text.startsWith('not:') ? text.slice(4) : text).split(',').map((x) => x.trim());
  return text.startsWith('not:') ? !skus.includes(sku.toLowerCase()) : skus.includes(sku.toLowerCase());
}

const slotId = (r) => `${r.date}T${r.time}-${slug(r.showroom)}`;

function parseSheets(tabs) {
  checkColumns(tabs);
  const flat = singleRecord(tabs.account || []);
  const field = (name) => pick(flat, name);
  const ratio = num(field('wholesale-ratio'), 0);
  if (!ratio) console.warn(`rep-workspace: using default wholesale ratio ${DEFAULT_WHOLESALE_RATIO}`);

  const doorRows = (tabs.doors || []).map((r) => ({
    id: pick(r, 'door-id'),
    name: pick(r, 'name'),
    city: pick(r, 'city'),
    weight: num(pick(r, 'share')),
    entitlement: pick(r, 'entitlement') || 'all',
    currency: pick(r, 'currency') || 'USD',
  }));
  const weightSum = doorRows.reduce((total, d) => total + d.weight, 0);
  const doors = doorRows.map(({ weight, ...d }) => ({
    ...d,
    share: weightSum ? weight / weightSum : 1 / (doorRows.length || 1), // fraction of 1
  }));

  const curveRows = (tabs.sizecurve || []).map((r) => ({
    size: pick(r, 'size'),
    weight: num(pick(r, 'pct')),
  }));
  const curveSum = curveRows.reduce((total, r) => total + r.weight, 0);

  return {
    styles: (tabs.styles || []).map((r) => ({
      sku: pick(r, 'sku'),
      shortName: pick(r, 'name-short'),
      cluster: pick(r, 'cluster') || 'Unassigned',
      tier: pick(r, 'tier') || 'Unassigned',
      status: normaliseStatus(pick(r, 'status')),
      lastYearUnits: Math.round(num(pick(r, 'last-year-units'))),
      targetUnits: Math.round(num(pick(r, 'target-units'))),
      plannedUnits: Math.round(num(pick(r, 'planned-units'))),
    })).filter((s) => s.sku),
    account: {
      id: field('account-id'),
      name: field('account-name'),
      number: field('account-number'),
      season: field('season'),
      tier: field('tier'),
      buyerName: field('buyer-name'),
      preferredDay: field('preferred-day'),
      ytdSpend: num(field('ytd-spend')),
      openOrders: num(field('open-orders')),
      unitsShipped: num(field('units-shipped-fall-2026')),
      creditLimit: num(field('credit-limit')),
      creditAvailable: num(field('credit-available')),
      goldThreshold: num(field('gold-threshold')),
      goldGap: num(field('gold-gap')),
      wholesaleRatio: ratio || DEFAULT_WHOLESALE_RATIO,
      cadRate: num(field('cad-rate'), 1),
      showroomContact: {
        name: field('showroom-contact'),
        email: field('showroom-contact-email'),
        phone: field('showroom-contact-phone'),
      },
    },
    rep: { name: field('rep-name'), title: field('rep-title') },
    doors,
    carries,
    sizeCurve: curveRows.map((r) => ({
      size: r.size,
      share: curveSum ? r.weight / curveSum : 1 / (curveRows.length || 1),
    })),
    slots: (tabs.slots || []).map((r) => ({
      id: slotId({ date: pick(r, 'date'), time: pick(r, 'time'), showroom: pick(r, 'showroom') }),
      date: pick(r, 'date'),
      time: pick(r, 'time'),
      showroom: pick(r, 'showroom'),
      status: pick(r, 'status') || 'open', // open | limited | booked
    })),
    appointments: (tabs.appointments || []).map((r) => ({
      id: pick(r, 'id'),
      date: pick(r, 'date'),
      time: pick(r, 'time'),
      account: pick(r, 'account'),
      showroom: pick(r, 'showroom'),
      type: pick(r, 'type'),
      status: pick(r, 'status') || 'tentative',
      slotId: slotId({ date: pick(r, 'date'), time: pick(r, 'time'), showroom: pick(r, 'showroom') }),
      source: 'sheet',
    })),
    accounts: (tabs.accounts || []).map((r) => ({
      id: pick(r, 'account-id'),
      name: pick(r, 'name'),
      status: pick(r, 'status'),
      nextStep: pick(r, 'next-step'),
    })),
    terms: (tabs.terms || []).map((r) => ({
      key: r.key,
      value: r.value,
      number: r.value !== '' && Number.isFinite(Number(r.value)) ? Number(r.value) : null,
    })).filter((t) => t.key),
    notes: (tabs.notes || []).map((r) => ({
      sku: pick(r, 'sku'),
      text: pick(r, 'note'),
      author: '',
      date: '',
      source: 'sheet',
    })).filter((n) => n.sku && n.text),
  };
}

let sheetsPromise;

/** Fetch and parse the workbook once; the parsed result is cached at module level. */
export function loadSheets() {
  if (!sheetsPromise) {
    sheetsPromise = fetch(DATA_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`showroom-data.json: ${res.status}`);
        return res.json();
      })
      .then((raw) => parseSheets(readTabs(raw)))
      .catch((e) => {
        sheetsPromise = undefined; // let the next call retry
        throw e;
      });
  }
  return sheetsPromise;
}

// ---------------------------------------------------------------------------
// Swatches
// ---------------------------------------------------------------------------

const NEUTRAL_SWATCH = 'rgb(158 163 168)';

/** Fallback colors by catalog color name (lower case). Two-tone names use the body color. */
const SWATCH_FALLBACK = {
  'andover heather/navy': 'rgb(150 160 178)',
  'barclay heather/green': 'rgb(120 150 130)',
  'canterbury heather': 'rgb(160 150 140)',
  'classic royal heather': 'rgb(70 100 170)',
  'classic stone': 'rgb(196 188 170)',
  'cloud heather': 'rgb(200 204 208)',
  'clubhouse cream': 'rgb(238 230 208)',
  'fairway houndstooth isle heather': 'rgb(90 120 110)',
  'fairway houndstooth pine heather': 'rgb(60 100 80)',
  'fall royal/yellow': 'rgb(40 70 160)',
  'field and pheasant': 'rgb(140 110 70)',
  greenscape: 'rgb(70 120 70)',
  'harbor island blue/navy': 'rgb(60 110 160)',
  'heritage frogskin camo': 'rgb(95 105 70)',
  'heritage royal/red': 'rgb(40 70 160)',
  'montana khaki': 'rgb(190 170 125)',
  'new iris blue/orange': 'rgb(80 90 170)',
  'newport navy': 'rgb(25 40 75)',
  'newport navy/red': 'rgb(25 40 75)',
  'nutmeg brown': 'rgb(120 80 50)',
  'parchment cream': 'rgb(240 232 210)',
  'polo black': 'rgb(25 25 28)',
  'polo black/red': 'rgb(25 25 28)',
  'rain heather': 'rgb(150 160 168)',
  'vintage khaki': 'rgb(194 176 138)',
  'vintage pine': 'rgb(40 85 65)',
  white: 'rgb(250 250 250)',
  'white navy': 'rgb(245 245 248)',
  'windsor heather': 'rgb(120 130 150)',
};

/** ACCS swatch value when the option provides one, else the fallback map, else neutral grey. */
const swatchFor = (title, provided) => provided
  || SWATCH_FALLBACK[String(title).toLowerCase()] || NEUTRAL_SWATCH;

// ---------------------------------------------------------------------------
// Deterministic unit split
// ---------------------------------------------------------------------------

/* eslint-disable no-bitwise */
function hash(text) { // FNV-1a, 32 bit
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
/* eslint-enable no-bitwise */

/** Stable weight in [1, 2) for a colour name. */
const colorWeight = (color) => 1 + (hash(color.toLowerCase()) % 1000) / 1000;

/** Split an integer total across weights so the parts sum exactly (largest remainder). */
function apportion(total, weights, keys) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const quotas = weights.map((w) => (total * w) / sum);
  const parts = quotas.map(Math.floor);
  const left = total - parts.reduce((a, b) => a + b, 0);
  quotas
    .map((q, i) => ({ i, frac: q - Math.floor(q) }))
    .sort((a, b) => b.frac - a.frac || keys[a.i].localeCompare(keys[b.i]))
    .slice(0, left)
    .forEach(({ i }) => { parts[i] += 1; });
  return parts;
}

// ---------------------------------------------------------------------------
// Overlay state (prototype mutations)
// ---------------------------------------------------------------------------

function emptyState() {
  return {
    status: {}, planned: {}, notes: {}, appointments: [], cancelled: [], released: [],
  };
}

function loadState() {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(SESSION_KEY));
    if (stored && typeof stored === 'object') return { ...emptyState(), ...stored };
  } catch (e) {
    // storage unavailable or corrupt: start clean
  }
  return emptyState();
}

function saveState(state) {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch (e) {
    // in-memory state still works for this page view
  }
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/** Units that count toward roll-ups: dropped tiles (and all their colors) contribute zero. */
export const effectiveUnits = (item) => (item.status === 'drop' ? 0 : item.plannedUnits);

export const formatMoney = (n) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
}).format(n);

/** "from $118": tiles show their lowest color retail. */
export const fromPrice = (tile) => `from ${formatMoney(tile.retail)}`;

const sum = (items, field) => items.reduce((total, item) => total + item[field], 0);

/** One tile per parent SKU, each with colors[] whose units sum exactly to the parent totals. */
function buildTiles(base, products, state) {
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const tiles = [];
  base.styles.forEach((style) => {
    const product = bySku.get(style.sku);
    if (!product) {
      console.warn(`rep-workspace: no catalog product for style ${style.sku}`);
      return;
    }
    const status = state.status[style.sku] || style.status;
    const options = product.colors.length ? product.colors : [{ title: '', swatch: '' }];
    const names = options.map((c) => c.title);
    const weights = names.map(colorWeight);
    const lastYear = apportion(style.lastYearUnits, weights, names);
    const target = apportion(style.targetUnits, weights, names);
    const planned = apportion(style.plannedUnits, weights, names);

    const colors = options.map((option, i) => {
      const id = `${style.sku}:${slug(option.title) || 'default'}`;
      const variants = product.variants.filter((v) => v.color === option.title);
      const prices = variants.map((v) => v.price).filter((price) => price > 0);
      const retail = prices.length ? Math.min(...prices) : product.fallbackPrice;
      return {
        id,
        color: option.title,
        swatch: swatchFor(option.title, option.swatch),
        imageUrl: '', // no per-color images exist yet; consumers fall back to the tile image
        retail,
        wholesale: round2(retail * base.account.wholesaleRatio),
        plannedUnits: state.planned[id] ?? planned[i],
        targetUnits: target[i],
        lastYearUnits: lastYear[i],
        status,
        variants,
      };
    });

    tiles.push({
      id: style.sku,
      parentSku: style.sku,
      name: product.name,
      shortName: style.shortName || product.name,
      imageUrl: product.imageUrl,
      cluster: style.cluster,
      tier: style.tier,
      status,
      retail: Math.min(...colors.map((c) => c.retail)),
      wholesale: Math.min(...colors.map((c) => c.wholesale)),
      plannedUnits: sum(colors, 'plannedUnits'),
      targetUnits: sum(colors, 'targetUnits'),
      lastYearUnits: sum(colors, 'lastYearUnits'),
      doors: base.doors.filter((d) => base.carries(d.entitlement, style.sku)).length,
      notes: [...base.notes.filter((n) => n.sku === style.sku), ...(state.notes[style.sku] || [])],
      sizes: product.sizes,
      colors,
    });
  });
  return tiles;
}

/** Flat style-color rows (parent info repeated on each) for the wedge, builder and CSV. */
const flattenColors = (tiles) => tiles.flatMap((tile) => tile.colors.map((c) => ({
  ...c,
  tileId: tile.id,
  parentSku: tile.parentSku,
  name: tile.name,
  cluster: tile.cluster,
  tier: tile.tier,
  doors: tile.doors,
  tileImageUrl: tile.imageUrl,
})));

function totalsOf(tiles) {
  const t = tiles.reduce((acc, tile) => {
    const sold = tile.colors.reduce((c, color) => {
      const units = effectiveUnits(color);
      return {
        units: c.units + units,
        wholesaleCost: c.wholesaleCost + units * color.wholesale,
        extendedRetail: c.extendedRetail + units * color.retail,
      };
    }, { units: 0, wholesaleCost: 0, extendedRetail: 0 });
    return {
      units: acc.units + sold.units,
      wholesaleCost: acc.wholesaleCost + sold.wholesaleCost,
      extendedRetail: acc.extendedRetail + sold.extendedRetail,
      targetUnits: acc.targetUnits + tile.targetUnits,
      lastYearUnits: acc.lastYearUnits + tile.lastYearUnits,
    };
  }, {
    units: 0, wholesaleCost: 0, extendedRetail: 0, targetUnits: 0, lastYearUnits: 0,
  });
  const varianceUnits = t.units - t.targetUnits;
  return {
    ...t,
    wholesaleCost: round2(t.wholesaleCost),
    extendedRetail: round2(t.extendedRetail),
    varianceUnits,
    variancePct: t.targetUnits ? (varianceUnits / t.targetUnits) * 100 : 0,
  };
}

let modelPromise;

async function createModel() {
  const base = await loadSheets();
  const { products, cached, fetchedAt } = await fetchProducts(base.styles.map((s) => s.sku));
  const state = loadState();
  const listeners = new Set();
  const model = {};

  function rebuild() {
    model.tiles = buildTiles(base, products, state);
    model.colorRows = flattenColors(model.tiles);
    // a superseded visit is cancelled in the overlay (sheet rows are never edited)
    model.appointments = [...base.appointments, ...state.appointments]
      .map((a) => (state.cancelled.includes(a.id) ? { ...a, status: 'cancelled' } : a));
    model.slots = base.slots.map((slot) => {
      const held = model.appointments.some((a) => a.slotId === slot.id && a.status !== 'cancelled');
      const sheetBooked = slot.status === 'booked' && !state.released.includes(slot.id);
      return {
        ...slot,
        status: slot.status === 'booked' && !sheetBooked ? 'open' : slot.status,
        booked: sheetBooked || held,
      };
    });
  }

  function commit() {
    saveState(state);
    rebuild();
    listeners.forEach((fn) => fn(model));
  }

  const findTile = (tileId) => {
    const tile = model.tiles.find((t) => t.id === tileId);
    if (!tile) throw new Error(`rep-workspace: unknown tile ${tileId}`);
    return tile;
  };

  const groupTotals = (field, filterFn = () => true) => {
    const groups = new Map();
    model.tiles.filter(filterFn).forEach((tile) => {
      if (!groups.has(tile[field])) groups.set(tile[field], []);
      groups.get(tile[field]).push(tile);
    });
    return [...groups].map(([key, tiles]) => (
      { key, tileCount: tiles.length, ...totalsOf(tiles) }
    ));
  };

  Object.assign(model, {
    account: base.account,
    rep: base.rep,
    doors: base.doors,
    sizeCurve: base.sizeCurve,
    accounts: base.accounts,
    terms: base.terms,
    term: (key) => {
      const t = base.terms.find((x) => x.key === key);
      return t ? (t.number ?? t.value) : undefined;
    },
    /** Doors that carry a style, per the doors tab entitlement column. */
    doorsCarrying: (sku) => base.doors.filter((d) => base.carries(d.entitlement, sku)),
    source: { cached, fetchedAt },
    totalsFor: (filterFn = () => true) => totalsOf(model.tiles.filter(filterFn)),
    byCluster: (filterFn) => groupTotals('cluster', filterFn),
    byTier: (filterFn) => groupTotals('tier', filterFn),
    effectiveUnits,

    setStatus(tileId, status) {
      if (!STATUSES.includes(status)) throw new Error(`rep-workspace: bad status ${status}`);
      findTile(tileId); // status belongs to the tile; every color row follows it
      state.status[tileId] = status;
      commit();
    },
    addNote(tileId, text) {
      findTile(tileId);
      const note = {
        text: String(text).trim(),
        author: base.rep.name,
        date: new Date().toISOString().slice(0, 10),
        source: 'rep',
      };
      if (!note.text) return;
      state.notes[tileId] = [...(state.notes[tileId] || []), note];
      commit();
    },
    /**
     * Set planned units for a tile (split across its colors with the same deterministic
     * weights as the sheet totals) or for a single color row.
     * @param {string} id tile id (parent SKU) or color row id (parentSku:color-slug)
     */
    setPlannedUnits(id, units) {
      const total = Math.max(0, Math.round(num(units)));
      const tile = model.tiles.find((t) => t.id === id);
      if (tile) {
        const names = tile.colors.map((c) => c.color);
        const parts = apportion(total, names.map(colorWeight), names);
        tile.colors.forEach((c, i) => { state.planned[c.id] = parts[i]; });
      } else if (model.colorRows.some((r) => r.id === id)) {
        state.planned[id] = total;
      } else {
        throw new Error(`rep-workspace: unknown tile or color row ${id}`);
      }
      commit();
    },
    /**
     * Book a showroom slot for an account (default: the current account). Booking for the
     * current account supersedes its active (tentative or confirmed) appointment: the old one
     * is cancelled in the overlay and its slot is released.
     * @param {Object} details slotId, accountId?, type?, status?, durationMinutes?,
     *   attendees? (names), preRead? (item keys)
     */
    bookAppointment(details = {}) {
      const slot = model.slots.find((x) => x.id === details.slotId);
      if (!slot) throw new Error(`rep-workspace: unknown slot ${details.slotId}`);
      const account = base.accounts.find((x) => x.id === details.accountId) || base.account;

      if (account.id === base.account.id) {
        model.appointments
          .filter((a) => a.account === base.account.name && ['tentative', 'confirmed'].includes(a.status))
          .forEach((old) => {
            state.cancelled.push(old.id);
            state.released.push(old.slotId);
          });
      }

      const appointment = {
        id: `A${Date.now().toString(36)}-${state.appointments.length + 1}`,
        date: slot.date,
        time: slot.time,
        account: account.name,
        showroom: slot.showroom,
        type: details.type || 'Showroom visit',
        status: details.status || 'tentative',
        slotId: slot.id,
        durationMinutes: Math.round(num(details.durationMinutes)) || 60,
        attendees: (details.attendees || []).map(String),
        preRead: (details.preRead || []).map(String),
        source: 'rep',
      };
      state.appointments.push(appointment);
      commit();
      return appointment;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  });

  rebuild();
  return model;
}

/**
 * Resolves to the single shared model. The object is stable: after a mutation its
 * `tiles`, `slots` and `appointments` are replaced and subscribers are called, so views
 * should re-read from the model inside their subscribe callback.
 * @returns {Promise<Object>}
 */
export function getModel() {
  if (!modelPromise) {
    modelPromise = createModel().catch((e) => {
      modelPromise = undefined;
      throw e;
    });
  }
  return modelPromise;
}
