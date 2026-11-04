import * as pdpApi from '@dropins/storefront-pdp/api.js';
import '../../scripts/initializers/pdp.js';

/*
 * SKU search (demo mock-up): paste a list of SKUs or import a CSV, and the page pulls up the
 * matching products with deep facets on the left. SKUs that do not match are explained at the top.
 *
 * It runs on the sample catalog below, so it works without any Commerce call. In a real build the
 * same screen sits on Live Search / the Catalog Service: the pasted list becomes a SKU filter and
 * the facets come from the searchable attributes you expose.
 */
const COLOR_HEX = {
  'Clubhouse Cream': '#f3ead7',
  'Polo Black': '#111111',
  'Newport Navy': '#1b2a49',
  'Montana Khaki': '#C4B289',
  'Nutmeg Brown': '#81422C',
  Greenscape: '#2e5e3e',
  'Cloud Heather': '#c9c9cc',
  'Classic Red': '#a4262c',
  White: '#ffffff',
  'Faded Blue': '#7f9bb8',
  'Olive Drab': '#6b6b3a',
  Burgundy: '#5e1f2b',
};
const LIGHT = new Set(['Clubhouse Cream', 'Montana Khaki', 'Cloud Heather', 'White', 'Faded Blue']);
const ALPHA = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const WAIST = ['30', '32', '34', '36', '38'];

// style: sku, name, category, cut, material, family of business, season, colors, retail, stock, sizes, url
const S = (sku, name, category, cut, material, fob, season, colors, retail, stock = 'In stock', sizes = ALPHA, url = '') => ({
  sku, name, category, cut, material, fob, season, colors, retail, wholesale: Math.round(retail * 50) / 100, stock, sizes, url,
});
const CATALOG = [
  S('CFM', 'Classic Fit Striped Mesh Polo Shirt', 'Polos', 'Classic Fit', 'Cotton mesh', 'Polo', 'Fall 2026', ['Newport Navy', 'Clubhouse Cream', 'Greenscape'], 120, 'In stock', ALPHA, '/products/classic-fit-striped-mesh-polo-shirt/cfm'),
  S('RFK', 'Relaxed Fit Knit Corduroy Polo Shirt', 'Polos', 'Relaxed Fit', 'Corduroy knit', 'Polo', 'Fall 2026', ['Nutmeg Brown', 'Newport Navy', 'Montana Khaki', 'Greenscape', 'Clubhouse Cream', 'Polo Black'], 135, 'In stock', ALPHA, '/products/relaxed-fit-knit-corduroy-polo-shirt/rfk'),
  S('OXF', 'Classic Fit Oxford Shirt', 'Woven Shirts', 'Classic Fit', 'Cotton oxford', 'Casual', 'Fall 2026', ['White', 'Faded Blue', 'Newport Navy'], 125),
  S('CHN', 'Straight Fit Stretch Chino Pant', 'Pants', 'Straight Fit', 'Cotton twill', 'Casual', 'Fall 2026', ['Montana Khaki', 'Newport Navy', 'Olive Drab'], 110, 'In stock', WAIST),
  S('SLM', 'Slim Fit Stretch Chino Pant', 'Pants', 'Slim Fit', 'Cotton twill', 'Casual', 'Fall 2026', ['Montana Khaki', 'Polo Black'], 110, 'Low stock', WAIST),
  S('CRD', 'Corduroy Straight Pant', 'Pants', 'Straight Fit', 'Corduroy', 'Casual', 'Fall 2026', ['Nutmeg Brown', 'Greenscape', 'Newport Navy'], 125, 'In stock', WAIST),
  S('CBL', 'Cable-Knit Cotton Sweater', 'Sweaters', 'Classic Fit', 'Cotton knit', 'Knitwear', 'Fall 2026', ['Clubhouse Cream', 'Newport Navy', 'Burgundy'], 165),
  S('MRN', 'Merino Wool Crewneck', 'Sweaters', 'Slim Fit', 'Merino wool', 'Knitwear', 'Fall 2026', ['Cloud Heather', 'Newport Navy', 'Polo Black', 'Burgundy'], 195),
  S('QZP', 'Quarter-Zip Pullover', 'Sweaters', 'Classic Fit', 'Cotton blend', 'Knitwear', 'Fall 2026', ['Newport Navy', 'Greenscape', 'Cloud Heather'], 155, 'Low stock'),
  S('TEE', 'Custom Slim Fit Jersey Tee', 'T-Shirts', 'Slim Fit', 'Cotton jersey', 'Casual', 'Spring 2027', ['White', 'Polo Black', 'Cloud Heather', 'Faded Blue'], 55),
  S('LST', 'Classic Fit Long-Sleeve Tee', 'T-Shirts', 'Classic Fit', 'Cotton jersey', 'Casual', 'Fall 2026', ['White', 'Polo Black', 'Newport Navy'], 65),
  S('PKT', 'Pocket Tee', 'T-Shirts', 'Relaxed Fit', 'Cotton jersey', 'Casual', 'Spring 2027', ['Clubhouse Cream', 'Cloud Heather'], 58),
  S('HDY', 'Fleece Pullover Hoodie', 'Fleece', 'Relaxed Fit', 'Cotton fleece', 'Sport', 'Fall 2026', ['Cloud Heather', 'Polo Black', 'Newport Navy', 'Classic Red'], 140),
  S('JGR', 'Fleece Jogger Pant', 'Fleece', 'Relaxed Fit', 'Cotton fleece', 'Sport', 'Fall 2026', ['Cloud Heather', 'Polo Black'], 120),
  S('RGB', 'Rugby Shirt', 'Polos', 'Classic Fit', 'Cotton jersey', 'Polo', 'Fall 2026', ['Classic Red', 'Newport Navy', 'Greenscape'], 145),
  S('PLD', 'Plaid Flannel Shirt', 'Woven Shirts', 'Relaxed Fit', 'Cotton flannel', 'Casual', 'Fall 2026', ['Nutmeg Brown', 'Greenscape', 'Burgundy'], 130, 'Low stock'),
  S('DNM', 'Denim Trucker Jacket', 'Outerwear', 'Classic Fit', 'Cotton denim', 'Denim', 'Fall 2026', ['Faded Blue', 'Polo Black'], 220),
  S('QLT', 'Quilted Liner Jacket', 'Outerwear', 'Slim Fit', 'Recycled polyester', 'Outerwear', 'Fall 2026', ['Newport Navy', 'Olive Drab', 'Polo Black'], 285),
  S('WXD', 'Waxed Cotton Field Jacket', 'Outerwear', 'Classic Fit', 'Waxed cotton', 'Outerwear', 'Fall 2026', ['Olive Drab', 'Nutmeg Brown'], 350, 'Low stock'),
  S('CSH', 'Cashmere Blend Scarf', 'Accessories', 'One Size', 'Cashmere blend', 'Accessories', 'Fall 2026', ['Cloud Heather', 'Burgundy', 'Newport Navy'], 98, 'In stock', ['One Size']),
  S('BLT', 'Leather Belt', 'Accessories', 'One Size', 'Leather', 'Accessories', 'Fall 2026', ['Nutmeg Brown', 'Polo Black'], 90, 'In stock', ['32', '34', '36', '38', '40']),
  S('CAP', 'Chino Baseball Cap', 'Accessories', 'One Size', 'Cotton twill', 'Accessories', 'Spring 2027', ['Newport Navy', 'Montana Khaki', 'Classic Red'], 45, 'In stock', ['One Size']),
  S('SHT', 'Chino Short', 'Pants', 'Straight Fit', 'Cotton twill', 'Casual', 'Spring 2027', ['Montana Khaki', 'Newport Navy', 'Olive Drab'], 85, 'In stock', WAIST),
  S('SWM', 'Swim Trunk', 'Swim', 'Classic Fit', 'Recycled nylon', 'Swim', 'Spring 2027', ['Newport Navy', 'Classic Red', 'Faded Blue'], 78),
  S('HSP', 'Heritage Stripe Polo', 'Polos', 'Classic Fit', 'Cotton mesh', 'Polo', 'Fall 2026', ['Classic Red', 'Polo Black'], 125, 'Out of stock'),
];

// SKUs the system knows about but cannot show, with the reason
const KNOWN_ISSUES = {
  'CFM-OLD': 'Discontinued after Spring 2026. Replacement: CFM (Classic Fit Striped Mesh Polo Shirt).',
  'POLO-EU1': 'Not in your account\'s catalog. This style belongs to the EU assortment.',
  'RLX-2200': 'Not yet released. This style opens to your account on January 15, 2027.',
};

// Pictures. Any style that also exists in your Commerce catalog gets its real picture
// automatically (matched by SKU). For the others, put a picture address here, for example
// from da.live or AEM Assets:  CBL: '/media/cable-knit-sweater.jpg'
const IMAGE_OVERRIDES = {
  // CBL: '/media/cable-knit-sweater.jpg',
};

/** Ask Commerce for the pictures of every style SKU in the sample catalog. Returns { SKU: url }. */
async function loadImages() {
  const out = { ...IMAGE_OVERRIDES };
  try {
    const { data } = await pdpApi.fetchGraphQl(
      `query GET_IMAGES($skus: [String]!) {
        products(skus: $skus) {
          sku
          images(roles: ["image"]) { url }
        }
      }`,
      { method: 'GET', variables: { skus: CATALOG.map((p) => p.sku) } },
    );
    (data?.products || []).forEach((p) => {
      const url = p?.images?.[0]?.url;
      if (url && !out[p.sku]) out[p.sku] = url.startsWith('//') ? `https:${url}` : url;
    });
  } catch (e) { /* no pictures: the colored tiles stay */ }
  return out;
}

const SAMPLE = ['CFM', 'RFK-Clubhouse Cream-L', 'RFK-Polo Black-M', 'OXF', 'CHN', 'MRN', 'RFK-Clubhouse Crem-L', 'CFM-OLD', 'POLO-EU1', 'XYZ-999', 'OXF'].join('\n');

function priceBucket(v) {
  if (v < 40) return 'Under $40';
  if (v < 70) return '$40 to $69';
  if (v < 100) return '$70 to $99';
  return '$100 and over';
}

const FACETS = [
  { key: 'category', label: 'Category', get: (p) => [p.category] },
  { key: 'color', label: 'Color', get: (p) => p.colors, swatch: true },
  {
    key: 'price', label: 'Price (wholesale)', get: (p) => [priceBucket(p.wholesale)], order: ['Under $40', '$40 to $69', '$70 to $99', '$100 and over'],
  },
  { key: 'material', label: 'Material', get: (p) => [p.material] },
  { key: 'cut', label: 'Cut / fit', get: (p) => [p.cut] },
  { key: 'fob', label: 'Family of business', get: (p) => [p.fob] },
  { key: 'season', label: 'Season', get: (p) => [p.season] },
  {
    key: 'size', label: 'Size', get: (p) => p.sizes, order: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '30', '32', '34', '36', '38', '40', 'One Size'],
  },
  {
    key: 'stock', label: 'Availability', get: (p) => [p.stock], order: ['In stock', 'Low stock', 'Out of stock'],
  },
];

const money = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
const norm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// index every style SKU and variant SKU (variants look like RFK-Clubhouse Cream-L)
const INDEX = new Map(); // normalized sku -> { product, sku }
CATALOG.forEach((p) => {
  INDEX.set(norm(p.sku), { product: p, sku: p.sku });
  p.colors.forEach((c) => p.sizes.forEach((s) => {
    const v = `${p.sku}-${c}-${s}`;
    INDEX.set(norm(v), { product: p, sku: v });
  }));
});

function distance(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) m[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return m[a.length][b.length];
}

function suggest(token) {
  const t = norm(token);
  let best = null;
  INDEX.forEach((entry, key) => {
    if (Math.abs(key.length - t.length) > 2) return;
    const d = distance(t, key);
    if (d <= 2 && (!best || d < best.d)) best = { d, sku: entry.sku };
  });
  return best?.sku;
}

/** Turn pasted text into a list of SKUs: split on lines, tabs, commas and semicolons. */
function tokenize(text) {
  return String(text).split(/[\n\r\t,;]+/)
    .map((t) => t.trim().replace(/^["']|["']$/g, '').trim())
    .filter(Boolean);
}

function lookup(tokens) {
  const seen = new Set();
  const found = new Map(); // style sku -> { product, matched: [] }
  const missing = [];
  let duplicates = 0;
  tokens.forEach((t) => {
    const key = norm(t);
    if (seen.has(key)) { duplicates += 1; return; }
    seen.add(key);
    const hit = INDEX.get(key);
    if (hit) {
      if (!found.has(hit.product.sku)) found.set(hit.product.sku, { product: hit.product, matched: [] });
      found.get(hit.product.sku).matched.push(hit.sku);
      return;
    }
    const issue = KNOWN_ISSUES[t.trim().toUpperCase()];
    if (issue) { missing.push({ sku: t, kind: 'Unavailable', why: issue }); return; }
    if (!/^[a-z0-9][a-z0-9 ._/-]{1,60}$/i.test(t)) {
      missing.push({ sku: t, kind: 'Invalid', why: 'This does not look like a SKU. SKUs use letters, numbers and dashes.' });
      return;
    }
    const near = suggest(t);
    missing.push({
      sku: t,
      kind: 'Not found',
      why: near ? `No product has this SKU. Did you mean ${near}?` : 'No product in your catalog has this SKU. Check for a typo or ask your sales rep.',
      near,
    });
  });
  return {
    found: [...found.values()], missing, duplicates, total: tokens.length,
  };
}

function parseCsv(text) {
  // If the first row has a SKU column (SKU, Item, Style, Product), read only that column.
  // Otherwise read every cell.
  const rows = String(text).replace(/\r/g, '').split('\n')
    .map((line) => line.split(/,|\t/).map((c) => c.trim().replace(/^"|"$/g, '').trim()))
    .filter((cells) => cells.some(Boolean));
  const col = rows.length ? rows[0].findIndex((c) => /^(sku|item|style|product)(\s|_|#|$)/i.test(c)) : -1;
  if (col >= 0) return rows.slice(1).map((r) => r[col]).filter(Boolean);
  return rows.flat().filter(Boolean);
}

export default async function decorate(block) {
  const state = {
    result: null, filters: {}, sort: 'list', open: {}, more: {},
  };

  let images = {};
  loadImages().then((found) => { images = found; if (state.result) renderMain(); });

  block.textContent = '';
  const title = el('h1', 'sku-search-title', 'Search by SKU');
  const lead = el('p', 'sku-search-lead', 'Paste a list of SKUs from your spreadsheet, or import a CSV. We pull up every matching product and tell you about any SKU we could not find.');

  // ---- input panel
  const panel = el('div', 'sku-search-panel');
  const area = el('textarea', 'sku-search-input');
  area.rows = 4;
  area.placeholder = 'Paste SKUs here, one per line or separated by commas.\nExample: CFM, RFK-Clubhouse Cream-L, OXF';
  area.setAttribute('aria-label', 'SKU list');
  const actions = el('div', 'sku-search-actions');
  const go = el('button', 'sku-search-go', 'Find products');
  go.type = 'button';
  const file = el('input');
  file.type = 'file';
  file.accept = '.csv,.txt,text/csv,text/plain';
  file.hidden = true;
  const imp = el('button', 'sku-search-secondary', 'Import CSV');
  imp.type = 'button';
  const sample = el('button', 'sku-search-link', 'Try a sample list');
  sample.type = 'button';
  const reset = el('button', 'sku-search-link', 'Clear search');
  reset.type = 'button';
  const count = el('span', 'sku-search-count', '');
  actions.append(go, imp, file, sample, reset, count);
  panel.append(area, actions);

  const notices = el('div', 'sku-search-notices');
  notices.setAttribute('role', 'status');
  const layout = el('div', 'sku-search-layout');
  const facetBox = el('aside', 'sku-search-facets');
  facetBox.setAttribute('aria-label', 'Filters');
  const main = el('section', 'sku-search-main');
  layout.append(facetBox, main);
  block.append(title, lead, panel, notices, layout);

  // ---- filtering
  const passes = (p, skip) => FACETS.every((f) => {
    if (f.key === skip) return true;
    const picked = state.filters[f.key];
    return !picked || !picked.size || f.get(p).some((v) => picked.has(v));
  });

  function visible() {
    if (!state.result) return [];
    let list = state.result.found.filter((r) => passes(r.product));
    if (state.sort === 'priceAsc') list = list.slice().sort((a, b) => a.product.wholesale - b.product.wholesale);
    if (state.sort === 'priceDesc') list = list.slice().sort((a, b) => b.product.wholesale - a.product.wholesale);
    if (state.sort === 'name') list = list.slice().sort((a, b) => a.product.name.localeCompare(b.product.name));
    return list;
  }

  // ---- rendering
  function renderNotices() {
    notices.replaceChildren();
    const r = state.result;
    if (!r) return;
    const unique = r.total - r.duplicates;
    const matchedSkus = r.found.reduce((n, f) => n + f.matched.length, 0);
    const summary = el('div', `sku-search-note ${r.found.length ? 'is-ok' : 'is-warn'}`);
    summary.append(el('strong', '', `${matchedSkus} of ${unique} SKU${unique === 1 ? '' : 's'} matched`));
    summary.append(el('span', '', ` across ${r.found.length} product${r.found.length === 1 ? '' : 's'}.`));
    if (r.duplicates) summary.append(el('span', '', ` ${r.duplicates} duplicate${r.duplicates === 1 ? ' was' : 's were'} ignored.`));
    notices.append(summary);

    if (r.missing.length) {
      const warn = el('div', 'sku-search-note is-warn');
      const head = el('div', 'sku-search-note-head');
      head.append(el('strong', '', `${r.missing.length} SKU${r.missing.length === 1 ? '' : 's'} could not be found`));
      const toggle = el('button', 'sku-search-link', state.open.missing === false ? 'Show details' : 'Hide details');
      toggle.type = 'button';
      toggle.addEventListener('click', () => { state.open.missing = state.open.missing === false; renderNotices(); });
      head.append(toggle);
      warn.append(head);
      if (state.open.missing !== false) {
        const ul = el('ul', 'sku-search-missing');
        r.missing.forEach((m) => {
          const li = el('li');
          li.append(el('code', '', m.sku), el('span', 'sku-search-kind', m.kind), el('span', '', m.why));
          if (m.near) {
            const fix = el('button', 'sku-search-link', `Use ${m.near}`);
            fix.type = 'button';
            fix.addEventListener('click', () => {
              area.value = tokenize(area.value).map((t) => (t === m.sku ? m.near : t)).join('\n');
              run();
            });
            li.append(fix);
          }
          ul.append(li);
        });
        warn.append(ul);
      }
      notices.append(warn);
    }
  }

  function renderFacets() {
    facetBox.replaceChildren();
    if (!state.result || !state.result.found.length) return;
    const head = el('div', 'sku-search-facets-head');
    head.append(el('h2', '', 'Filter'));
    if (Object.values(state.filters).some((s) => s.size)) {
      const clr = el('button', 'sku-search-link', 'Clear all');
      clr.type = 'button';
      clr.addEventListener('click', () => { state.filters = {}; render(); });
      head.append(clr);
    }
    facetBox.append(head);

    FACETS.forEach((f) => {
      // counts reflect every other active filter, so the numbers stay honest
      const counts = new Map();
      state.result.found.filter((r) => passes(r.product, f.key)).forEach((r) => {
        f.get(r.product).forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
      });
      const picked = state.filters[f.key] || new Set();
      picked.forEach((v) => { if (!counts.has(v)) counts.set(v, 0); });
      if (!counts.size) return;
      const values = [...counts.keys()];
      if (f.order) values.sort((a, b) => (f.order.indexOf(a) + 1 || 99) - (f.order.indexOf(b) + 1 || 99));
      else values.sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));

      const box = el('details', 'sku-search-facet');
      box.open = state.open[f.key] !== false;
      box.addEventListener('toggle', () => { state.open[f.key] = box.open; });
      const sum = el('summary', '', f.label);
      if (picked.size) sum.append(el('span', 'sku-search-badge', String(picked.size)));
      box.append(sum);

      const limit = 6;
      const showAll = state.more[f.key];
      (showAll ? values : values.slice(0, limit)).forEach((v) => {
        const row = el('label', 'sku-search-opt');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = picked.has(v);
        cb.addEventListener('change', () => {
          const set = state.filters[f.key] || new Set();
          if (cb.checked) set.add(v); else set.delete(v);
          state.filters[f.key] = set;
          render();
        });
        row.append(cb);
        if (f.swatch) {
          const sw = el('span', 'sku-search-dot');
          sw.style.backgroundColor = COLOR_HEX[v] || '#ddd';
          row.append(sw);
        }
        row.append(el('span', 'sku-search-opt-label', v), el('span', 'sku-search-opt-count', String(counts.get(v))));
        box.append(row);
      });
      if (values.length > limit) {
        const more = el('button', 'sku-search-link', showAll ? 'Show fewer' : `Show ${values.length - limit} more`);
        more.type = 'button';
        more.addEventListener('click', () => { state.more[f.key] = !showAll; renderFacets(); });
        box.append(more);
      }
      facetBox.append(box);
    });
  }

  function chips() {
    const wrap = el('div', 'sku-search-chips');
    FACETS.forEach((f) => (state.filters[f.key] || new Set()).forEach((v) => {
      const c = el('button', 'sku-search-chip', `${v} ×`);
      c.type = 'button';
      c.setAttribute('aria-label', `Remove filter ${v}`);
      c.addEventListener('click', () => { state.filters[f.key].delete(v); render(); });
      wrap.append(c);
    }));
    return wrap;
  }

  function card(r) {
    const p = r.product;
    const a = el(p.url ? 'a' : 'div', 'sku-search-card');
    if (p.url) a.href = p.url;
    const tile = el('div', 'sku-search-tile');
    const hex = COLOR_HEX[p.colors[0]] || '#ddd';
    tile.style.background = `linear-gradient(160deg, ${hex}, ${hex}cc)`;
    if (LIGHT.has(p.colors[0])) tile.classList.add('is-light');
    if (images[p.sku]) {
      const img = el('img', 'sku-search-img');
      img.src = images[p.sku];
      img.alt = p.name;
      img.loading = 'lazy';
      img.addEventListener('error', () => img.remove());
      tile.append(img);
    }
    tile.append(el('span', 'sku-search-tile-sku', p.sku));
    a.append(tile);

    const body = el('div', 'sku-search-card-body');
    body.append(el('h3', '', p.name));
    const price = el('div', 'sku-search-price');
    price.append(el('strong', '', money(p.wholesale)), el('span', '', ` wholesale · ${money(p.retail)} retail`));
    body.append(price);
    const dots = el('div', 'sku-search-dots');
    p.colors.forEach((c) => {
      const d = el('span', 'sku-search-dot');
      d.style.backgroundColor = COLOR_HEX[c] || '#ddd';
      d.title = c;
      dots.append(d);
    });
    body.append(dots);
    body.append(el('div', 'sku-search-meta', `${p.cut} · ${p.material}`));
    body.append(el('span', `sku-search-stock is-${p.stock.toLowerCase().replace(/\s+/g, '-')}`, p.stock));

    const m = el('div', 'sku-search-matched');
    m.append(el('span', '', 'Matched: '));
    r.matched.slice(0, 3).forEach((s) => m.append(el('code', '', s)));
    if (r.matched.length > 3) m.append(el('span', '', ` +${r.matched.length - 3} more`));
    body.append(m);
    a.append(body);
    return a;
  }

  function renderMain() {
    main.replaceChildren();
    if (!state.result) {
      const empty = el('div', 'sku-search-empty');
      empty.append(el('h2', '', 'Nothing searched yet'), el('p', '', 'Paste your SKUs above and select Find products, or try the sample list.'));
      main.append(empty);
      return;
    }
    const list = visible();
    const bar = el('div', 'sku-search-bar');
    bar.append(el('span', 'sku-search-results', `${list.length} product${list.length === 1 ? '' : 's'}`));
    const sortLabel = el('label', 'sku-search-sort', 'Sort ');
    const sel = el('select');
    [['list', 'Order of your list'], ['name', 'Name'], ['priceAsc', 'Price: low to high'], ['priceDesc', 'Price: high to low']].forEach(([v, t]) => {
      const o = el('option', '', t);
      o.value = v;
      o.selected = state.sort === v;
      sel.append(o);
    });
    sel.addEventListener('change', () => { state.sort = sel.value; renderMain(); });
    sortLabel.append(sel);
    bar.append(sortLabel);
    main.append(bar, chips());
    if (!list.length) {
      const empty = el('div', 'sku-search-empty');
      const has = state.result.found.length > 0;
      empty.append(
        el('h2', '', has ? 'No products match these filters' : 'No products found'),
        el('p', '', has ? 'Remove a filter to see more of your list.' : 'None of the SKUs in your list matched. See the notes above.'),
      );
      main.append(empty);
      return;
    }
    const grid = el('div', 'sku-search-grid');
    list.forEach((r) => grid.append(card(r)));
    main.append(grid);
  }

  function render() {
    renderNotices();
    renderFacets();
    renderMain();
  }

  function run() {
    const tokens = tokenize(area.value);
    if (!tokens.length) {
      state.result = null;
      count.textContent = '';
      render();
      return;
    }
    state.filters = {};
    state.result = lookup(tokens);
    count.textContent = `${tokens.length} SKU${tokens.length === 1 ? '' : 's'} read`;
    render();
  }

  go.addEventListener('click', run);
  area.addEventListener('paste', () => setTimeout(run, 0)); // pasting runs the search straight away
  imp.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    if (f.size > 1024 * 1024) { count.textContent = 'That file is too large (1 MB max).'; return; }
    const reader = new FileReader();
    reader.onload = () => {
      area.value = parseCsv(reader.result).join('\n');
      run();
      count.textContent = `Imported ${f.name} · ${tokenize(area.value).length} SKUs read`;
    };
    reader.readAsText(f);
    file.value = '';
  });
  sample.addEventListener('click', () => { area.value = SAMPLE; run(); });
  reset.addEventListener('click', () => { area.value = ''; state.filters = {}; run(); });

  render();
}
