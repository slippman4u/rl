import { CS_FETCH_GRAPHQL, getProductLink } from '../../scripts/commerce.js';
import { figures } from '../../scripts/wholesale-mock.js';
import { readBlockConfig } from '../../scripts/aem.js';
import '../../scripts/initializers/cart.js';

/*
 * SKU search: paste a list of SKUs or import a CSV and the page pulls up those products from your
 * Commerce catalog, with facets built from the products' own attributes. SKUs Commerce does not
 * return are listed at the top, grouped as "Not in catalog" and "No product inventory".
 *
 * Every product is real: name, price, picture and the link to its product page come from Commerce.
 * Paste parent SKUs (for example CFM or RFK), the SKUs you see in the product page address.
 */
const CHUNK = 25; // SKUs per request

// attributes that never make a useful filter
const SKIP_ATTRIBUTES = /^(sku|name|url_key|url_path|url_suffix|description|short_description|meta_|image|small_image|thumbnail|swatch_image|special_|news_|gift_|price|msrp|weight|status|visibility|tax_class|created_at|updated_at|custom_|page_layout|options_container|quantity|stock|has_options|required_options|category_ids|is_|links_|samples_|ts_|manufacturer_)/i;

const money = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
const norm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function priceBucket(v) {
  if (v < 40) return 'Under $40';
  if (v < 70) return '$40 to $69';
  if (v < 100) return '$70 to $99';
  return '$100 and over';
}
const PRICE_ORDER = ['Under $40', '$40 to $69', '$70 to $99', '$100 and over'];

// ---- Demo attributes -------------------------------------------------------------------------
// Your products do not carry these attributes in Commerce yet, so the page fills them in with
// sample values to show what deep faceting looks like. Turn it off with a block row:
//   Mock Facets | off
// Known styles get sensible values; any other SKU gets values picked from the lists below.
const POOLS = {
  'Merch Division': ['Polo Core', 'Purple Label', 'Collection', 'Casual', 'Tailored'],
  Brand: ['Polo Ralph Lauren', 'Ralph Lauren Collection', 'Purple Label', 'RRL'],
  'Web Seasons': ['Fall 2026', 'Holiday 2026', 'Spring 2027'],
  'Selling Season': ['Fall', 'Holiday', 'Spring', 'Seasonless'],
  Age: ['Adult', 'Big & Tall'],
  Concept: ['Core', 'Seasonal', 'Heritage', 'Fashion'],
  'WHS Zone': ['Zone 1', 'Zone 2', 'Zone 3'],
  'Fashion Degree': ['Basic', 'Core', 'Fashion'],
  'Assortment Lifestyle': ['Heritage', 'Preppy', 'Country', 'Sport'],
};
const KNOWN = {
  cfm: { Category: 'Polo Shirts', Class: 'Knit Polos', Material: 'Cotton mesh', Pattern: 'Striped', 'Cut / Fit': 'Classic Fit', Color: ['Navy', 'Red', 'Cream'], Department: 'Knits & Polos' },
  cfk: { Category: 'Polo Shirts', Class: 'Knit Polos', Material: 'Corduroy knit', Pattern: 'Solid', 'Cut / Fit': 'Classic Fit', Color: ['Navy', 'Brown'], Department: 'Knits & Polos' },
  cmp: { Category: 'Polo Shirts', Class: 'Knit Polos', Material: 'Cotton mesh', Pattern: 'Camo', 'Cut / Fit': 'Custom Slim Fit', Color: ['Olive', 'Brown'], Department: 'Knits & Polos' },
  rfk: { Category: 'Polo Shirts', Class: 'Knit Polos', Material: 'Corduroy knit', Pattern: 'Solid', 'Cut / Fit': 'Relaxed Fit', Color: ['Brown', 'Navy', 'Khaki', 'Green', 'Cream', 'Black'], Department: 'Knits & Polos' },
  blb: { Category: 'Belts', Class: 'Leather Belts', Material: 'Leather', Pattern: 'Solid', 'Cut / Fit': 'One Size', Color: ['Brown'], Department: 'Accessories' },
  cbcs: { Category: 'Socks', Class: 'Dress Socks', Material: 'Cotton blend', Pattern: 'Ribbed', 'Cut / Fit': 'One Size', Color: ['Navy'], Department: 'Accessories' },
  epl: { Category: 'Shoes', Class: 'Loafers', Material: 'Leather', Pattern: 'Solid', 'Cut / Fit': 'One Size', Color: ['Black'], Department: 'Footwear' },
  pwf: { Category: 'Trousers', Class: 'Dress Trousers', Material: 'Wool flannel', Pattern: 'Solid', 'Cut / Fit': 'Pleated', Color: ['Grey'], Department: 'Bottoms' },
};
const GENERIC = {
  Category: ['Polo Shirts', 'Trousers', 'Sweaters', 'Outerwear', 'Belts', 'Shoes'],
  Class: ['Knit Polos', 'Dress Trousers', 'Crewneck Sweaters', 'Leather Belts'],
  Material: ['Cotton mesh', 'Wool flannel', 'Leather', 'Cotton blend', 'Merino wool'],
  Pattern: ['Solid', 'Striped', 'Plaid', 'Camo'],
  'Cut / Fit': ['Classic Fit', 'Custom Slim Fit', 'Relaxed Fit'],
  Color: ['Navy', 'Black', 'Brown', 'Cream', 'Olive', 'Grey'],
  Department: ['Knits & Polos', 'Wovens', 'Bottoms', 'Accessories', 'Footwear', 'Outerwear'],
};
const SIZE_RANGE = {
  'Polo Shirts': 'XS to XXL', Trousers: '30 to 38 waist', Sweaters: 'XS to XXL', Outerwear: 'S to XXL', Belts: '32 to 40', Shoes: '7 to 13', Socks: 'One Size',
};
const SWATCH = {
  Navy: '#1b2a49', Red: '#a4262c', Cream: '#f3ead7', Brown: '#81422C', Olive: '#6b6b3a', Khaki: '#C4B289', Green: '#2e5e3e', Black: '#111111', Grey: '#8a8a8a', White: '#ffffff',
};
const hash = (str) => [...String(str)].reduce((h, c) => ((h * 31) + c.charCodeAt(0)) >>> 0, 7);
const pickFrom = (list, seed, n = 0) => list[(hash(seed) + n * 7) % list.length];

function mockAttributes(p) {
  const key = p.sku.toLowerCase();
  const known = KNOWN[key] || {};
  const out = {};
  Object.entries(POOLS).forEach(([label, pool], i) => { out[label] = [pickFrom(pool, key + label, i)]; });
  Object.entries(GENERIC).forEach(([label, pool]) => {
    out[label] = label === 'Color' ? [pickFrom(pool, key), pickFrom(pool, key, 3)] : [pickFrom(pool, key + label)];
  });
  Object.entries(known).forEach(([label, v]) => { out[label] = Array.isArray(v) ? v : [v]; });
  const dept = out.Department[0];
  out['Size range'] = [SIZE_RANGE[out.Category[0]] || 'S to XXL'];
  out['Reporting Division'] = [dept === 'Accessories' || dept === 'Footwear' ? dept : 'Menswear'];
  out.Gender = ['Men'];
  return out;
}

// the order facets appear in, like Ralph Lauren's own screens
const FACET_ORDER = ['Price (wholesale)', 'Reporting Division', 'Merch Division', 'Brand', 'Department', 'Category', 'Class', 'Color', 'Material', 'Pattern', 'Cut / Fit', 'Size range', 'Gender', 'Age', 'Web Seasons', 'Selling Season', 'Concept', 'Fashion Degree', 'Assortment Lifestyle', 'WHS Zone'];


/** Turn pasted text into a list of SKUs: split on lines, tabs, commas and semicolons. */
function tokenize(text) {
  return String(text).split(/[\n\r\t,;]+/)
    .map((t) => t.trim().replace(/^["']|["']$/g, '').trim())
    .filter(Boolean);
}

function parseCsv(text) {
  // If the first row has a SKU column (SKU, Item, Style, Product), read only that column.
  const rows = String(text).replace(/\r/g, '').split('\n')
    .map((line) => line.split(/,|\t/).map((c) => c.trim().replace(/^"|"$/g, '').trim()))
    .filter((cells) => cells.some(Boolean));
  const col = rows.length ? rows[0].findIndex((c) => /^(sku|item|style|product)(\s|_|#|$)/i.test(c)) : -1;
  if (col >= 0) return rows.slice(1).map((r) => r[col]).filter(Boolean);
  return rows.flat().filter(Boolean);
}

const fixUrl = (u) => (u && u.startsWith('//') ? `https:${u}` : u || '');
const amount = (a) => (a?.amount?.value !== undefined ? Number(a.amount.value) : 0);

/** Ask Commerce for these SKUs. Returns normalized products, keyed by lower-case SKU. */
async function fetchProducts(skus) {
  const query = `query GET_PRODUCTS($skus: [String]) {
    products(skus: $skus) {
      sku
      name
      urlKey
      inStock
      images { url roles }
      attributes { name label value }
      ... on SimpleProductView {
        price {
          final { amount { currency value } }
          regular { amount { currency value } }
        }
      }
      ... on ComplexProductView {
        priceRange {
          minimum {
            final { amount { currency value } }
            regular { amount { currency value } }
          }
        }
      }
    }
  }`;
  const chunks = [];
  for (let i = 0; i < skus.length; i += CHUNK) chunks.push(skus.slice(i, i + CHUNK));
  const out = new Map();
  const results = await Promise.all(chunks.map(async (part) => {
    const res = await CS_FETCH_GRAPHQL.fetchGraphQl(query, { method: 'GET', variables: { skus: part } });
    if (res?.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '));
    return res?.data?.products || [];
  }));
  results.flat().forEach((p) => {
    if (!p?.sku) return;
    const final = amount(p.price?.final) || amount(p.priceRange?.minimum?.final);
    const regular = amount(p.price?.regular) || amount(p.priceRange?.minimum?.regular) || final;
    const f = figures({ final, regular }, { sku: p.sku });
    const imgs = p.images || [];
    const best = ['image', 'small_image', 'thumbnail'].map((r) => imgs.find((i) => (i.roles || []).includes(r))).find(Boolean) || imgs[0];
    const image = fixUrl(best?.url);
    const attrs = {};
    (p.attributes || []).forEach((a) => {
      const label = String(a.label || '').trim();
      const value = String(a.value ?? '').trim();
      if (!label || !value || SKIP_ATTRIBUTES.test(a.name || '')) return;
      if (/^AC /i.test(label) || /\[object/i.test(value)) return;
      if (value.length > 40 || /^https?:|^\/|^\d{6,}$/.test(value)) return;
      (attrs[label] = attrs[label] || new Set()).add(value);
    });
    out.set(p.sku.toLowerCase(), {
      sku: p.sku,
      name: p.name || p.sku,
      url: p.urlKey ? getProductLink(p.urlKey, p.sku) : '',
      image,
      wholesale: f.wholesale,
      retail: f.msrp,
      inStock: p.inStock !== false,
      attrs: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, [...v]])),
    });
  });
  // Configurable products often keep their pictures on the variants. Borrow the first one.
  await Promise.all([...out.values()].filter((p) => !p.image).map(async (p) => {
    try {
      const res = await CS_FETCH_GRAPHQL.fetchGraphQl(
        `query GET_VARIANT_IMAGE($sku: String!) {
          variants(sku: $sku) {
            variants { product { images(roles: ["image"]) { url } } }
          }
        }`,
        { method: 'GET', variables: { sku: p.sku } },
      );
      const hit = (res?.data?.variants?.variants || [])
        .map((v) => v?.product?.images?.[0]?.url).find(Boolean);
      if (hit) p.image = fixUrl(hit);
    } catch (e) { /* no picture: the grey tile stays */ }
  }));
  return out;
}

/** Facets built from what the matched products actually carry. */
function buildFacets(products) {
  const facets = [
    {
      key: 'price', label: 'Price (wholesale)', get: (p) => [priceBucket(p.wholesale)], order: PRICE_ORDER,
    },
  ];
  const labels = new Map(); // label -> Set of values
  products.forEach((p) => Object.entries(p.attrs).forEach(([label, values]) => {
    if (!labels.has(label)) labels.set(label, new Set());
    values.forEach((v) => labels.get(label).add(v));
  }));
  [...labels.entries()]
    .filter(([, values]) => values.size >= 2 && values.size <= 40)
    .sort((a, b) => ((FACET_ORDER.indexOf(a[0]) + 1) || 99) - ((FACET_ORDER.indexOf(b[0]) + 1) || 99) || a[0].localeCompare(b[0]))
    .slice(0, 24)
    .forEach(([label]) => {
      facets.push({
        key: `attr:${label}`, label, get: (p) => p.attrs[label] || [], swatch: label === 'Color',
      });
    });
  return facets;
}

/* ---------- Quick view tray: the product's real page, sliding in from the right ---------- */
let trayInstance = null;

async function refreshParentCart() {
  try {
    const api = await import('@dropins/storefront-cart/api.js');
    if (typeof api.refreshCart === 'function') await api.refreshCart();
  } catch (e) {
    // the cart refreshes on the next page load
  }
}

function setBackgroundInert(inert) {
  document.querySelectorAll('body > header, body > main, body > footer').forEach((node) => {
    node.inert = inert;
  });
}

function getTray() {
  if (trayInstance) return trayInstance;

  const overlay = el('div', 'ss-tray-overlay');
  overlay.hidden = true;
  const panel = el('aside', 'ss-tray');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Quick view');

  const bar = el('div', 'ss-tray-bar');
  const title = el('span', 'ss-tray-title', '');
  const full = el('a', 'ss-tray-full', 'Open full page');
  full.target = '_blank';
  full.rel = 'noopener';
  const close = el('button', 'ss-tray-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close quick view');
  bar.append(title, full, close);

  const loading = el('p', 'ss-tray-loading', 'Loading…');
  const frame = el('iframe', 'ss-tray-frame');
  frame.title = 'Product quick view';
  panel.append(bar, loading, frame);
  overlay.append(panel);
  document.body.append(overlay);

  let opener = null;

  function closeTray() {
    if (overlay.hidden || !overlay.classList.contains('is-open')) return;
    overlay.classList.remove('is-open');
    document.documentElement.classList.remove('ss-tray-open');
    setBackgroundInert(false);
    setTimeout(() => { overlay.hidden = true; }, 300);
    if (opener) opener.focus();
    refreshParentCart(); // the bag in the header picks up what was added
  }

  frame.addEventListener('load', () => {
    loading.hidden = true;
    frame.classList.add('is-ready');
    try {
      const doc = frame.contentWindow.document;
      // inside the tray, show only the product: no site header or footer
      const style = doc.createElement('style');
      style.textContent = 'body > header, body > footer { display: none !important; } body > main { padding-top: 0 !important; margin-top: 0 !important; }';
      doc.head.append(style);
      doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTray(); });
    } catch (e) {
      // the framed page is not same-origin; the close button still works
    }
  });

  close.addEventListener('click', closeTray);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeTray(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTray(); });

  function open(page, name, openerEl) {
    opener = openerEl;
    full.href = page;
    title.textContent = name;
    panel.setAttribute('aria-label', `Quick view: ${name}`);
    if (frame.dataset.page !== page) {
      loading.hidden = false;
      frame.classList.remove('is-ready');
      frame.dataset.page = page;
      frame.src = page;
    }
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    document.documentElement.classList.add('ss-tray-open');
    setBackgroundInert(true);
    close.focus();
  }

  trayInstance = { open, close: closeTray };
  return trayInstance;
}

/** Open the tray on a normal click; leave ctrl/cmd/middle clicks to open a new tab. */
function openInTray(e, p, openerEl) {
  if (!p.url || e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
  e.preventDefault();
  getTray().open(p.url, p.name, openerEl);
}

export default async function decorate(block) {
  const config = readBlockConfig(block);
  const mockOn = !/^(off|false|no)$/i.test(String(config['mock-facets'] || 'on'));
  const state = {
    result: null, filters: {}, pending: {}, sortBy: 'list', dir: 'asc', open: {}, more: {}, selected: new Set(), view: '5', facets: [], busy: false, error: '', panel: true,
  };

  block.textContent = '';
  const title = el('h1', 'sku-search-title', 'Search by SKU');
  const lead = el('p', 'sku-search-lead', 'Paste a list of SKUs from your spreadsheet, or import a CSV. We pull up every matching product and tell you about any SKU we could not find.');

  // ---- input panel
  const panel = el('div', 'sku-search-panel');
  const area = el('textarea', 'sku-search-input');
  area.rows = 4;
  area.placeholder = 'Paste SKUs here, one per line or separated by commas.\nExample: CFM, RFK';
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
  const reset = el('button', 'sku-search-link', 'Clear search');
  reset.type = 'button';
  const count = el('span', 'sku-search-count', '');
  actions.append(go, imp, file, reset, count);
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
  const passes = (p, skip) => state.facets.every((f) => {
    if (f.key === skip) return true;
    const picked = state.filters[f.key];
    return !picked || !picked.size || f.get(p).some((v) => picked.has(v));
  });

  function visible() {
    if (!state.result) return [];
    const list = state.result.found.filter((p) => passes(p));
    const by = {
      name: (x, y) => x.name.localeCompare(y.name),
      price: (x, y) => x.wholesale - y.wholesale,
      sku: (x, y) => x.sku.localeCompare(y.sku),
    }[state.sortBy];
    if (by) list.sort(by);
    if (state.dir === 'desc') list.reverse();
    return list;
  }

  // ---- rendering
  function renderNotices() {
    notices.replaceChildren();
    if (state.error) {
      notices.append(el('div', 'sku-search-note is-warn', `Could not reach the catalog: ${state.error}`));
      return;
    }
    const r = state.result;
    if (!r) return;
    const yours = el('div', 'sku-search-yours');
    yours.append(el('strong', '', 'Your search for: '));
    r.tokens.slice(0, 40).forEach((t) => {
      const c = el('button', 'sku-search-chip', `${t} ×`);
      c.type = 'button';
      c.setAttribute('aria-label', `Remove ${t} from the search`);
      c.addEventListener('click', () => {
        area.value = tokenize(area.value).filter((x) => norm(x) !== norm(t)).join('\n');
        run();
      });
      yours.append(c);
    });
    if (r.tokens.length > 40) yours.append(el('span', '', ` +${r.tokens.length - 40} more`));
    notices.append(yours);

    const unique = r.tokens.length;
    const summary = el('div', `sku-search-note ${r.found.length ? 'is-ok' : 'is-warn'}`);
    summary.append(el('strong', '', `${r.found.length} of ${unique} SKU${unique === 1 ? '' : 's'} matched`));
    if (r.duplicates) summary.append(el('span', '', ` ${r.duplicates} duplicate${r.duplicates === 1 ? ' was' : 's were'} ignored.`));
    notices.append(summary);

    if (r.missing.length) {
      const warn = el('div', 'sku-search-note is-warn');
      const head = el('div', 'sku-search-note-head');
      head.append(el('strong', '', `Failed to return ${r.missing.length} SKU${r.missing.length === 1 ? '' : 's'}`));
      const toggle = el('button', 'sku-search-link', state.open.missing === false ? 'Show details' : 'Hide details');
      toggle.type = 'button';
      toggle.addEventListener('click', () => { state.open.missing = state.open.missing === false; renderNotices(); });
      head.append(toggle);
      warn.append(head);
      if (state.open.missing !== false) {
        [['catalog', 'Not in catalog'], ['inventory', 'No product inventory']].forEach(([group, heading]) => {
          const items = r.missing.filter((m) => m.group === group);
          if (!items.length) return;
          const gh = el('div', 'sku-search-group-head');
          gh.append(el('strong', '', `${heading}: `), el('span', 'sku-search-group-list', items.map((m) => m.sku).join(', ')));
          const copy = el('button', 'sku-search-link', 'Copy');
          copy.type = 'button';
          copy.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(items.map((m) => m.sku).join('\n')); copy.textContent = 'Copied'; } catch (e) { copy.textContent = 'Copy failed'; }
            setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
          });
          gh.append(copy);
          warn.append(gh);
          const ul = el('ul', 'sku-search-missing');
          items.forEach((m) => {
            const li = el('li');
            li.append(el('code', '', m.sku), el('span', 'sku-search-kind', m.kind), el('span', '', m.why));
            ul.append(li);
          });
          warn.append(ul);
        });
      }
      notices.append(warn);
    }
  }

  function renderFacets() {
    facetBox.replaceChildren();
    facetBox.hidden = !state.panel;
    layout.classList.toggle('is-collapsed', !state.panel);
    if (!state.result || !state.result.found.length) return;
    const head = el('div', 'sku-search-facets-head');
    head.append(el('h2', '', 'Filter options'));
    facetBox.append(head);
    const btns = el('div', 'sku-search-facet-buttons');
    const apply = el('button', 'sku-search-go', 'Apply');
    apply.type = 'button';
    apply.addEventListener('click', () => {
      state.filters = Object.fromEntries(Object.entries(state.pending).map(([k, v]) => [k, new Set(v)]));
      render();
    });
    const clr = el('button', 'sku-search-secondary', 'Reset');
    clr.type = 'button';
    clr.addEventListener('click', () => { state.filters = {}; state.pending = {}; render(); });
    btns.append(apply, clr);
    facetBox.append(btns);

    state.facets.forEach((f, index) => {
      // counts reflect every applied filter except this facet's own
      const counts = new Map();
      state.result.found.filter((p) => passes(p, f.key)).forEach((p) => {
        f.get(p).forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
      });
      const picked = state.pending[f.key] || new Set();
      picked.forEach((v) => { if (!counts.has(v)) counts.set(v, 0); });
      if (!counts.size) return;
      const values = [...counts.keys()];
      if (f.order) values.sort((x, y) => (f.order.indexOf(x) + 1 || 99) - (f.order.indexOf(y) + 1 || 99));
      else values.sort((x, y) => counts.get(y) - counts.get(x) || x.localeCompare(y));

      const box = el('details', 'sku-search-facet');
      box.open = state.open[f.key] ?? index < 2;
      box.addEventListener('toggle', () => { state.open[f.key] = box.open; });
      const sum = el('summary', '', f.label);
      if (picked.size) sum.append(el('span', 'sku-search-badge', String(picked.size)));
      box.append(sum);

      const limit = 8;
      const showAll = state.more[f.key];
      (showAll ? values : values.slice(0, limit)).forEach((v) => {
        const row = el('label', 'sku-search-opt');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = picked.has(v);
        cb.addEventListener('change', () => {
          const set = state.pending[f.key] || new Set();
          if (cb.checked) set.add(v); else set.delete(v);
          state.pending[f.key] = set;
          renderFacets();
        });
        row.append(cb);
        if (f.swatch) {
          const sw = el('span', 'sku-search-dot');
          sw.style.backgroundColor = SWATCH[v] || '#ddd';
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
    state.facets.forEach((f) => (state.filters[f.key] || new Set()).forEach((v) => {
      const c = el('button', 'sku-search-chip', `${v} ×`);
      c.type = 'button';
      c.setAttribute('aria-label', `Remove filter ${v}`);
      c.addEventListener('click', () => { state.filters[f.key].delete(v); state.pending[f.key]?.delete(v); render(); });
      wrap.append(c);
    }));
    return wrap;
  }

  function card(p) {
    const a = el('div', `sku-search-card${state.selected.has(p.sku) ? ' is-selected' : ''}`);
    const tile = el('div', 'sku-search-tile');
    if (p.image) {
      const img = el('img', 'sku-search-img');
      img.src = p.image;
      img.alt = p.name;
      img.loading = 'lazy';
      img.addEventListener('error', () => img.remove());
      tile.append(img);
    }
    if (p.url) {
      tile.classList.add('is-clickable');
      tile.addEventListener('click', (e) => openInTray(e, p, tile));
    }
    a.append(tile);

    const body = el('div', 'sku-search-card-body');
    const h = el('h3');
    if (p.url) {
      const link = el('a', '', p.name);
      link.href = p.url;
      link.addEventListener('click', (e) => openInTray(e, p, link));
      h.append(link);
    } else {
      h.textContent = p.name;
    }
    body.append(h);
    body.append(el('div', 'sku-search-meta', `SKU ${p.sku.toUpperCase()}`));
    const colors = p.attrs.Color || p.attrs.Colour;
    if (colors) body.append(el('div', 'sku-search-meta', `Color: ${colors.join(' / ')}`));
    const price = el('div', 'sku-search-price');
    price.append(el('span', '', 'Wholesale: '), el('strong', '', money(p.wholesale)), el('span', 'sku-search-msrp', `MSRP: ${money(p.retail)}`));
    body.append(price);
    body.append(el('span', `sku-search-stock ${p.inStock ? '' : 'is-out-of-stock'}`, p.inStock ? 'In stock' : 'Out of stock'));

    const foot = el('div', 'sku-search-cardfoot');
    const pick = el('label', 'sku-search-pick');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = state.selected.has(p.sku);
    cb.addEventListener('change', () => {
      if (cb.checked) state.selected.add(p.sku); else state.selected.delete(p.sku);
      renderMain();
    });
    pick.append(cb, el('span', '', 'Select'));
    foot.append(pick);
    if (p.url) {
      const view = el('a', 'sku-search-viewlink', 'Quick view');
      view.href = p.url;
      view.addEventListener('click', (e) => openInTray(e, p, view));
      foot.append(view);
    }
    body.append(foot);
    a.append(body);
    return a;
  }

  function exportSelected() {
    const rows = [['SKU', 'Name', 'Wholesale', 'MSRP']];
    state.result.found.filter((p) => state.selected.has(p.sku)).forEach((p) => {
      rows.push([p.sku, p.name, p.wholesale, p.retail]);
    });
    const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = el('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'selected-products.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function renderMain() {
    main.replaceChildren();
    if (!state.result) {
      const empty = el('div', 'sku-search-empty');
      empty.append(el('h2', '', state.busy ? 'Searching…' : 'Nothing searched yet'), el('p', '', state.busy ? 'Looking up your SKUs in the catalog.' : 'Paste your SKUs above and select Find products.'));
      main.append(empty);
      return;
    }
    const list = visible();
    const total = state.result.found.length;

    // toolbar: collapse, count, selection, view, sort
    const bar = el('div', 'sku-search-toolbar');
    const toggle = el('button', 'sku-search-collapse', state.panel ? '‹' : '›');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', state.panel ? 'Hide filters' : 'Show filters');
    toggle.addEventListener('click', () => { state.panel = !state.panel; render(); });
    bar.append(toggle, el('span', 'sku-search-results', `Search Results (${list.length}${list.length !== total ? ` of ${total}` : ''})`));

    const selGroup = el('div', 'sku-search-group');
    selGroup.append(el('span', '', 'Selection'));
    const all = el('button', 'sku-search-tiny', 'Select all on page');
    all.type = 'button';
    all.addEventListener('click', () => { list.forEach((p) => state.selected.add(p.sku)); renderMain(); });
    const none = el('button', 'sku-search-tiny', 'Deselect all');
    none.type = 'button';
    none.addEventListener('click', () => { state.selected.clear(); renderMain(); });
    selGroup.append(all, none);
    bar.append(selGroup);

    const viewGroup = el('div', 'sku-search-group');
    viewGroup.append(el('span', '', 'View'));
    [['3', 'Large'], ['5', 'Small'], ['list', 'List']].forEach(([v, t]) => {
      const vb = el('button', `sku-search-tiny${state.view === v ? ' is-on' : ''}`, t);
      vb.type = 'button';
      vb.addEventListener('click', () => { state.view = v; renderMain(); });
      viewGroup.append(vb);
    });
    bar.append(viewGroup);

    const sortGroup = el('div', 'sku-search-group');
    sortGroup.append(el('span', '', 'Sort by'));
    const dirSel = el('select');
    [['asc', 'Ascending'], ['desc', 'Descending']].forEach(([v, t]) => {
      const o = el('option', '', t);
      o.value = v;
      o.selected = state.dir === v;
      dirSel.append(o);
    });
    dirSel.addEventListener('change', () => { state.dir = dirSel.value; renderMain(); });
    const fieldSel = el('select');
    [['list', 'Order of your list'], ['name', 'Name'], ['price', 'Price'], ['sku', 'SKU']].forEach(([v, t]) => {
      const o = el('option', '', t);
      o.value = v;
      o.selected = state.sortBy === v;
      fieldSel.append(o);
    });
    fieldSel.addEventListener('change', () => { state.sortBy = fieldSel.value; renderMain(); });
    sortGroup.append(dirSel, fieldSel);
    bar.append(sortGroup);
    main.append(bar, chips());

    const n = state.selected.size;
    if (n) {
      const pickbar = el('div', 'sku-search-pickbar');
      pickbar.append(el('strong', 'sku-search-selected', `${n} selected`));
      const add = el('button', 'sku-search-go', 'Add to order');
      add.type = 'button';
      add.addEventListener('click', () => {
        pickbar.querySelector('.sku-search-sent')?.remove();
        pickbar.append(el('span', 'sku-search-sent', `${n} style${n === 1 ? '' : 's'} sent to your order (demo).`));
      });
      const exp = el('button', 'sku-search-secondary', 'Export CSV');
      exp.type = 'button';
      exp.addEventListener('click', exportSelected);
      pickbar.append(add, exp);
      main.append(pickbar);
    }

    if (!list.length) {
      const empty = el('div', 'sku-search-empty');
      const has = total > 0;
      empty.append(
        el('h2', '', has ? 'No products match these filters' : 'No products found'),
        el('p', '', has ? 'Reset the filters to see more of your list.' : 'None of the SKUs in your list matched. See the notes above.'),
      );
      main.append(empty);
      return;
    }
    const grid = el('div', 'sku-search-grid');
    grid.dataset.view = state.view;
    list.forEach((p) => grid.append(card(p)));
    main.append(grid);
  }

  function render() {
    renderNotices();
    renderFacets();
    renderMain();
  }

  async function run() {
    const all = tokenize(area.value);
    state.error = '';
    if (!all.length) {
      state.result = null;
      count.textContent = '';
      render();
      return;
    }
    const seen = new Set();
    const tokens = [];
    all.forEach((t) => { if (!seen.has(norm(t))) { seen.add(norm(t)); tokens.push(t); } });
    const duplicates = all.length - tokens.length;
    count.textContent = `${all.length} SKU${all.length === 1 ? '' : 's'} read`;

    const valid = tokens.filter((t) => /^[a-z0-9][a-z0-9 ._/-]{0,60}$/i.test(t));
    state.busy = true;
    state.result = null;
    render();
    let products = new Map();
    try {
      products = valid.length ? await fetchProducts(valid) : new Map();
    } catch (e) {
      console.debug('SKU search failed', e);
      state.error = e?.message || 'The request failed.';
      state.busy = false;
      render();
      return;
    }
    state.busy = false;

    const found = [];
    const missing = [];
    tokens.forEach((t) => {
      if (!valid.includes(t)) {
        missing.push({
          sku: t, kind: 'Invalid', group: 'catalog', why: 'This does not look like a SKU. SKUs use letters, numbers and dashes.',
        });
        return;
      }
      const p = products.get(t.toLowerCase());
      if (!p) {
        missing.push({
          sku: t, kind: 'Not found', group: 'catalog', why: 'No product in your catalog has this SKU. Check for a typo, or ask your sales rep.',
        });
      } else if (!p.inStock) {
        missing.push({
          sku: t, kind: 'No inventory', group: 'inventory', why: `${p.name} is in the catalog but has no inventory right now.`,
        });
      } else {
        found.push(p);
      }
    });
    if (mockOn) found.forEach((p) => { p.attrs = { ...p.attrs, ...mockAttributes(p) }; });
    state.filters = {};
    state.pending = {};
    state.selected = new Set();
    state.facets = buildFacets(found);
    state.result = {
      found, missing, tokens, duplicates,
    };
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
    reader.onload = async () => {
      area.value = parseCsv(reader.result).join('\n');
      await run();
      count.textContent = `Imported ${f.name} · ${tokenize(area.value).length} SKUs read`;
    };
    reader.readAsText(f);
    file.value = '';
  });
  reset.addEventListener('click', () => { area.value = ''; state.filters = {}; state.pending = {}; run(); });

  render();
}
