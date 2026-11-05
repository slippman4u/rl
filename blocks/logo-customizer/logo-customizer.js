import { events } from '@dropins/tools/event-bus.js';
import * as pdpApi from '@dropins/storefront-pdp/api.js';
import '../../scripts/initializers/pdp.js';

/*
 * Logo customizer: pick where logos go (front left or right, back, arm left or right), which
 * logo, and which color, and see it on a shirt. The price add-on is real: it comes from
 * customizable options set up on the product in the Commerce admin, and this block only
 * chooses them.
 *
 * Admin setup, for each placement (for example "Left chest"), two Drop-down customizable options:
 *   "Left chest - Logo"   one value per logo, priced at the placement price (fixed, per unit)
 *   "Left chest - Color"  one value per color, price 0
 * Value names must match the names in this block's table.
 *
 * Block table (da.live), one row per line:
 *   Title      | Customize with logos
 *   Placement  | Left chest        | 6
 *   Placement  | Back              | 8
 *   Logo       | Crest             | (picture)  | Navy, Red, White
 *   Shirt      | Black             | (front picture) | (back picture)
 *   Shirt      | White             | (front picture) | (back picture)
 * A logo with no picture gets a plain stand-in shape. A shirt color with no picture gets a plain
 * drawn shirt in that color. The shirt follows the product's color choice (black, white or red).
 */
const HEX = {
  navy: '#1b2a49', red: '#a4262c', white: '#ffffff', black: '#111111', gold: '#b8923a', green: '#2e5e3e', grey: '#8a8a8a', gray: '#8a8a8a', cream: '#f3ead7', blue: '#3b6ea8',
};
const SHIRT_HEX = { black: '#1c1c1c', white: '#f3f3f1', red: '#a4262c' };
const money = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const choices = (opt) => opt?.items || opt?.values || [];
const titleOf = (opt) => opt?.label || opt?.title || opt?.id || '';
const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function svg(tag, attrs = {}) {
  const n = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  return n;
}

/* ---------- stand-in logo shapes (used until real pictures are added) ---------- */
const SHAPES = {
  crest: 'M24 5 L40 11 V25 C40 34 33 40 24 44 C15 40 8 34 8 25 V11 Z',
  star: 'M24 5 L29.5 18 L43 19 L33 28 L36 42 L24 35 L12 42 L15 28 L5 19 L18.5 18 Z',
  stripe: 'M6 14 H42 V20 H6 Z M6 28 H42 V34 H6 Z',
  circle: 'M24 6 A18 18 0 1 1 23.99 6 Z',
};
const shapeFor = (name) => {
  if (/crest/i.test(name)) return SHAPES.crest;
  if (/star/i.test(name)) return SHAPES.star;
  if (/stripe|line/i.test(name)) return SHAPES.stripe;
  return Object.values(SHAPES)[norm(name).length % 4];
};

function placeholder(name, colorHex) {
  const s = svg('svg', { viewBox: '0 0 48 48', 'aria-hidden': 'true', class: 'lc-shape' });
  s.append(svg('path', {
    d: shapeFor(name), fill: colorHex || '#0d1b3a', stroke: '#0d1b3a', 'stroke-width': '1',
  }));
  return s;
}

/* ---------- recolor a logo picture ----------
 * Logo art is dark lines on a light (or transparent) background. We turn darkness into
 * transparency and fill it with the chosen color, so one picture serves every color. */
const tintCache = new Map();
const tintPending = new Set();

function tintKey(src, hex) { return `${src}|${hex}`; }

function tintImage(src, hex) {
  const key = tintKey(src, hex);
  if (tintCache.has(key)) return Promise.resolve(tintCache.get(key));
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const max = 320;
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h);
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        for (let i = 0; i < data.data.length; i += 4) {
          const lum = (0.299 * data.data[i] + 0.587 * data.data[i + 1] + 0.114 * data.data[i + 2]) / 255;
          const a = (data.data[i + 3] / 255) * Math.min(1, (1 - lum) * 1.25);
          data.data[i] = r;
          data.data[i + 1] = g;
          data.data[i + 2] = b;
          data.data[i + 3] = Math.round(a * 255);
        }
        ctx.putImageData(data, 0, 0);
        const url = canvas.toDataURL('image/png');
        tintCache.set(key, url);
        resolve(url);
      } catch (e) {
        resolve(src); // cannot read the picture: show it as it is
      }
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

/* ---------- where each placement sits (fractions of the shirt's width and height) ---------- */
const GEOM = {
  silhouette: {
    w: 600,
    h: 640,
    front: {
      'left chest': [0.642, 0.266, 0.097, 0],
      'right chest': [0.358, 0.266, 0.097, 0],
      'left sleeve': [0.867, 0.367, 0.067, 60],
      'right sleeve': [0.133, 0.367, 0.067, -60],
    },
    back: {
      back: [0.5, 0.36, 0.283, 0],
      'left sleeve': [0.133, 0.367, 0.067, -60],
      'right sleeve': [0.867, 0.367, 0.067, 60],
    },
  },
  photo: {
    w: 1000,
    front: {
      'left chest': [0.638, 0.292, 0.099, 0],
      'right chest': [0.375, 0.292, 0.099, 0],
      'left sleeve': [0.874, 0.343, 0.07, 70],
      'right sleeve': [0.126, 0.343, 0.07, -70],
    },
    back: {
      back: [0.5, 0.355, 0.3, 0],
      'left sleeve': [0.126, 0.343, 0.07, -70],
      'right sleeve': [0.874, 0.343, 0.07, 70],
    },
  },
};

/** A plain drawn polo shirt, used when there is no photo for that color or view. */
function drawShirt(view, hex) {
  const g = svg('g');
  const stroke = 'rgba(0,0,0,0.28)';
  g.append(svg('path', {
    d: 'M240 50 L130 90 L40 230 L95 270 L150 190 L150 590 L450 590 L450 190 L505 270 L560 230 L470 90 L360 50 Q300 110 240 50 Z',
    fill: hex, stroke, 'stroke-width': '2',
  }));
  if (view === 'front') {
    g.append(svg('path', {
      d: 'M235 45 Q300 125 365 45 L388 78 L300 140 L212 78 Z', fill: hex, stroke, 'stroke-width': '2',
    }));
    g.append(svg('rect', {
      x: '290', y: '112', width: '20', height: '100', fill: hex, stroke, 'stroke-width': '2',
    }));
    [135, 175].forEach((y) => g.append(svg('circle', {
      cx: '300', cy: String(y), r: '4', fill: 'rgba(255,255,255,0.7)', stroke,
    })));
  } else {
    g.append(svg('path', {
      d: 'M240 50 Q300 78 360 50 L368 36 Q300 62 232 36 Z', fill: hex, stroke, 'stroke-width': '2',
    }));
  }
  return g;
}

/** Read the block table into placements, logos and shirt pictures. */
function parseTable(block) {
  const out = {
    title: 'Customize with logos', placements: [], logos: [], shirts: {},
  };
  const src = (cell) => {
    const img = cell?.querySelector('img');
    return img ? img.currentSrc || img.src : '';
  };
  [...block.children].forEach((row) => {
    const cells = [...row.children];
    const kind = norm(cells[0]?.textContent);
    const name = cells[1]?.textContent.trim();
    if (kind === 'title' && name) out.title = name;
    if (kind === 'placement' && name) {
      out.placements.push({ name, price: Number(String(cells[2]?.textContent).replace(/[^0-9.]/g, '')) || 0 });
    }
    if (kind === 'logo' && name) {
      out.logos.push({
        name,
        image: src(cells[2]),
        colors: String(cells[3]?.textContent || '').split(',').map((c) => c.trim()).filter(Boolean),
      });
    }
    if (kind === 'shirt' && name) {
      out.shirts[norm(name)] = { front: src(cells[2]), back: src(cells[3]) };
    }
  });
  return out;
}

const DEFAULTS = {
  placements: [
    { name: 'Left chest', price: 6 }, { name: 'Right chest', price: 6 }, { name: 'Back', price: 8 },
    { name: 'Left sleeve', price: 5 }, { name: 'Right sleeve', price: 5 },
  ],
  logos: [
    { name: 'Crest', image: '', colors: ['Navy', 'Red', 'White'] },
    { name: 'Star', image: '', colors: ['Gold', 'Navy', 'Black'] },
    { name: 'Stripe', image: '', colors: ['Navy', 'Red', 'Green'] },
  ],
};

export default async function decorate(block) {
  const table = parseTable(block);
  const placements = table.placements.length ? table.placements : DEFAULTS.placements;
  const logos = table.logos.length ? table.logos : DEFAULTS.logos;
  const debug = new URLSearchParams(window.location.search).has('debug');

  // wait for the product data so we can find the matching customizable options
  const product = await new Promise((resolve) => {
    let done = false;
    const finish = (p) => { if (!done) { done = true; resolve(p); } };
    events.on('pdp/data', (p) => { if (p?.sku) finish(p); }, { eager: true });
    setTimeout(() => finish(null), 8000);
  });

  const options = product?.options || [];
  // placement name -> { logo: option, color: option }
  const wired = {};
  placements.forEach((pl) => {
    const find = (suffix) => options.find((o) => norm(titleOf(o)) === norm(`${pl.name} - ${suffix}`));
    wired[pl.name] = { logo: find('Logo'), color: find('Color') };
  });
  const ownUids = new Set();
  const ownOptions = new Set();
  Object.values(wired).forEach((w) => [w.logo, w.color].forEach((o) => {
    if (o) ownOptions.add(o);
    choices(o).forEach((c) => ownUids.add(c.id));
  }));
  if (debug || !Object.values(wired).some((w) => w.logo)) {
    console.debug('Logo customizer', {
      productOptions: options.map((o) => titleOf(o)),
      wired: Object.fromEntries(Object.entries(wired).map(([k, w]) => [k, { logo: !!w.logo, color: !!w.color }])),
    });
  }

  const state = {}; // placement -> { on, logo, color }
  placements.forEach((pl) => { state[pl.name] = { on: false, logo: '', color: '' }; });
  let view = 'front';

  block.textContent = '';
  block.classList.add('logo-customizer');
  const head = el('div', 'lc-head');
  head.append(el('h2', 'lc-title', table.title));
  head.append(el('p', 'lc-sub', 'Choose where the logo goes, then the logo and color. Each placement adds to the price of every unit.'));

  // ---- shirt preview
  const stage = el('div', 'lc-stage');
  const tabs = el('div', 'lc-tabs');
  const tabButtons = {};
  [['front', 'Front'], ['back', 'Back']].forEach(([v, label]) => {
    const t = el('button', 'lc-tab', label);
    t.type = 'button';
    t.addEventListener('click', () => { view = v; paintPreview(); });
    tabs.append(t);
    tabButtons[v] = t;
  });
  const shirtHost = el('div', 'lc-shirt');
  stage.append(tabs, shirtHost);

  const list = el('div', 'lc-list');
  const summary = el('div', 'lc-summary');
  summary.setAttribute('role', 'status');
  block.append(head, stage, list, summary);

  // move into the product's option area so it sits beside Color and Size
  const options$ = document.querySelector('.product-details__options');
  if (options$) options$.after(block);

  const complete = (pl) => state[pl.name].on && state[pl.name].logo && state[pl.name].color;

  /** Which base shirt is selected on the product (black, white or red). */
  function shirtColor() {
    try {
      const uids = pdpApi.getProductConfigurationValues()?.optionsUIDs || [];
      const colorOpt = options.find((o) => !ownOptions.has(o) && /colo/i.test(`${titleOf(o)} ${o.id}`));
      const item = choices(colorOpt).find((c) => uids.includes(c.id));
      const label = norm(item?.label || item?.title || '');
      if (/black/.test(label)) return 'black';
      if (/red/.test(label)) return 'red';
      if (/white/.test(label)) return 'white';
    } catch (e) { /* use the default below */ }
    return 'black';
  }

  function paintPreview() {
    Object.entries(tabButtons).forEach(([v, b]) => {
      b.setAttribute('aria-pressed', String(v === view));
      b.classList.toggle('is-on', v === view);
    });
    const base = shirtColor();
    const photo = table.shirts[base]?.[view];
    const mode = photo ? 'photo' : 'silhouette';
    const geo = GEOM[mode];
    const W = geo.w;
    let H = geo.h;
    if (photo) {
      const probe = new Image();
      probe.src = photo;
      H = probe.naturalWidth ? W * (probe.naturalHeight / probe.naturalWidth) : W * 1.348;
    }
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'lc-svg', role: 'img', 'aria-label': `${base} shirt, ${view} view, with the selected logos` });
    if (photo) {
      root.append(svg('image', {
        href: photo, x: '0', y: '0', width: String(W), height: String(H),
      }));
    } else {
      root.append(drawShirt(view, SHIRT_HEX[base]));
    }
    placements.filter(complete).forEach((pl) => {
      const spot = geo[view][norm(pl.name)];
      if (!spot) return;
      const [fx, fy, fs, rot] = spot;
      const cx = fx * W;
      const cy = fy * H;
      const size = fs * W;
      const s = state[pl.name];
      const logo = logos.find((l) => l.name === s.logo);
      const hex = HEX[norm(s.color)] || '#888888';
      const g = svg('g', { transform: `rotate(${rot} ${cx} ${cy})` });
      if (logo?.image) {
        const key = tintKey(logo.image, hex);
        if (tintCache.has(key)) {
          g.append(svg('image', {
            href: tintCache.get(key), x: String(cx - size / 2), y: String(cy - size / 2), width: String(size), height: String(size), preserveAspectRatio: 'xMidYMid meet',
          }));
        } else if (!tintPending.has(key)) {
          tintPending.add(key);
          tintImage(logo.image, hex).then(() => { tintPending.delete(key); paintPreview(); });
        }
      } else {
        const sh = svg('path', {
          d: shapeFor(s.logo), fill: hex, stroke: 'rgba(0,0,0,0.35)', 'stroke-width': '1', transform: `translate(${cx - size / 2} ${cy - size / 2}) scale(${size / 48})`,
        });
        g.append(sh);
      }
      root.append(g);
    });
    shirtHost.replaceChildren(root);
    const names = placements.filter(complete).map((pl) => pl.name);
    stage.dataset.empty = names.length ? 'false' : 'true';
  }

  function applyToProduct() {
    const picked = [];
    placements.forEach((pl) => {
      const w = wired[pl.name];
      if (!complete(pl)) {
        // an unused placement gets the option's "None" value (if the admin has one), so every
        // option always has a value and the product page does not hold back Add to Cart
        [w.logo, w.color].forEach((o) => {
          const none = choices(o).find((c) => norm(c.label || c.title) === 'none');
          if (none) picked.push(none.id);
        });
        return;
      }
      const logoItem = choices(w.logo).find((c) => norm(c.label || c.title) === norm(state[pl.name].logo));
      const colorItem = choices(w.color).find((c) => norm(c.label || c.title) === norm(state[pl.name].color));
      if (logoItem) picked.push(logoItem.id);
      if (colorItem) picked.push(colorItem.id);
    });
    try {
      pdpApi.setProductConfigurationValues((prev) => ({
        ...prev,
        optionsUIDs: [...(prev?.optionsUIDs || []).filter((u) => !ownUids.has(u)), ...picked],
      }));
    } catch (e) {
      console.debug('Logo customizer: could not set options', e);
    }
  }

  function quantity() {
    try { return Number(pdpApi.getProductConfigurationValues()?.quantity) || 1; } catch (e) { return 1; }
  }

  function paintSummary() {
    summary.replaceChildren();
    const done = placements.filter(complete);
    if (!done.length) {
      summary.append(el('span', 'lc-muted', 'No logos selected.'));
      return;
    }
    const per = done.reduce((n, pl) => n + pl.price, 0);
    const qty = quantity();
    done.forEach((pl) => {
      const row = el('div', 'lc-line');
      row.append(
        el('span', '', `${pl.name}: ${state[pl.name].logo}, ${state[pl.name].color}`),
        el('span', '', `+${money(pl.price)}`),
      );
      summary.append(row);
    });
    const perLine = el('div', 'lc-line lc-total');
    perLine.append(el('span', '', 'Customization per unit'), el('span', '', `+${money(per)} / unit`));
    const total = el('div', 'lc-line lc-grand');
    total.append(el('span', '', `Total customization (${qty} unit${qty === 1 ? '' : 's'})`), el('strong', '', `+${money(per * qty)}`));
    summary.append(perLine, total);
    if (debug && !Object.values(wired).some((w) => w.logo)) {
      summary.append(el('p', 'lc-muted', 'Preview only: the matching customizable options were not found on this product, so the price is not added to the cart.'));
    }
  }

  function changed() {
    paint();
    applyToProduct();
    paintSummary();
    paintPreview();
  }

  function paint() {
    list.replaceChildren();
    placements.forEach((pl) => {
      const s = state[pl.name];
      const row = el('div', `lc-row${s.on ? ' is-on' : ''}`);
      const top = el('label', 'lc-top');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = s.on;
      cb.addEventListener('change', () => {
        s.on = cb.checked;
        if (!s.on) { s.logo = ''; s.color = ''; }
        if (s.on) view = /back/i.test(pl.name) ? 'back' : (view === 'back' && !/sleeve/i.test(pl.name) ? 'front' : view);
        changed();
      });
      top.append(cb, el('span', 'lc-name', pl.name), el('span', 'lc-price', `+${money(pl.price)} / unit`));
      row.append(top);

      if (s.on) {
        const body = el('div', 'lc-body');
        const tiles = el('div', 'lc-tiles');
        logos.forEach((logo) => {
          const t = el('button', `lc-tile${s.logo === logo.name ? ' is-picked' : ''}`);
          t.type = 'button';
          t.setAttribute('aria-pressed', String(s.logo === logo.name));
          if (logo.image) {
            const img = el('img');
            img.src = logo.image;
            img.alt = '';
            t.append(img);
          } else {
            t.append(placeholder(logo.name, HEX[norm(s.color)] || ''));
          }
          t.append(el('span', '', logo.name));
          t.addEventListener('click', () => {
            s.logo = logo.name;
            if (!logo.colors.some((c) => norm(c) === norm(s.color))) s.color = '';
            changed();
          });
          tiles.append(t);
        });
        body.append(tiles);

        const chosen = logos.find((l) => l.name === s.logo);
        if (chosen) {
          const colors = el('div', 'lc-colors');
          colors.append(el('span', 'lc-muted', 'Color:'));
          chosen.colors.forEach((c) => {
            const sw = el('button', `lc-swatch${norm(s.color) === norm(c) ? ' is-picked' : ''}`);
            sw.type = 'button';
            sw.title = c;
            sw.setAttribute('aria-label', c);
            sw.setAttribute('aria-pressed', String(norm(s.color) === norm(c)));
            sw.style.backgroundColor = HEX[norm(c)] || '#ddd';
            sw.addEventListener('click', () => {
              s.color = c;
              changed();
            });
            colors.append(sw);
          });
          if (s.color) colors.append(el('span', 'lc-muted', s.color));
          body.append(colors);
        } else {
          body.append(el('p', 'lc-muted', 'Choose a logo to see its colors.'));
        }
        row.append(body);
      }
      list.append(row);
    });
  }

  // hide the plain dropdowns Commerce draws for these options: this picker replaces them.
  // Color and Size keep their dropdowns.
  const mine = new Set();
  placements.forEach((pl) => { mine.add(norm(`${pl.name} - Logo`)); mine.add(norm(`${pl.name} - Color`)); });
  const controls = (node) => node.querySelectorAll('select, input, textarea, [role="combobox"], [role="listbox"]').length;

  function hideNative() {
    const area = document.querySelector('.product-details__options');
    if (!area) return;
    area.querySelectorAll('label, legend, span, p, div').forEach((n) => {
      if (n.closest('.logo-customizer') || n.childElementCount > 1) return;
      if (!mine.has(norm(n.textContent))) return;
      let box = n.parentElement;
      while (box && box !== area && controls(box) < 1) box = box.parentElement;
      if (!box || box === area) return;
      const count = controls(box);
      while (box.parentElement && box.parentElement !== area && controls(box.parentElement) === count) {
        box = box.parentElement;
      }
      box.hidden = true;
      box.style.display = 'none';
    });
  }
  const optionsArea = document.querySelector('.product-details__options');
  if (optionsArea) {
    hideNative();
    new MutationObserver(hideNative).observe(optionsArea, { childList: true, subtree: true });
    [300, 1200, 3000].forEach((ms) => setTimeout(hideNative, ms)); // for fields that draw late
  }

  // With ?debug on the page address, show what the product page thinks of this selection
  const diag = el('pre', 'lc-diag');
  if (debug) block.append(diag);
  let lastValid = null;
  function paintDiag() {
    if (!debug) return;
    let values = {};
    let valid = 'unknown';
    try { values = pdpApi.getProductConfigurationValues() || {}; } catch (e) { values = { error: e.message }; }
    try { valid = pdpApi.isProductConfigurationValid(); } catch (e) { valid = `error: ${e.message}`; }
    const required = Object.entries(wired).flatMap(([k, w]) => [['Logo', w.logo], ['Color', w.color]]
      .filter(([, o]) => o && o.required).map(([t]) => `${k} - ${t}`));
    diag.textContent = [
      `product page says valid: ${valid} (last event: ${lastValid})`,
      `options matched: ${Object.values(wired).filter((w) => w.logo && w.color).length} of ${placements.length} placements`,
      `required among ours: ${required.length ? required.join(', ') : 'none'}`,
      `option UIDs selected: ${(values.optionsUIDs || []).length}`,
      `quantity: ${values.quantity}`,
      `base shirt: ${shirtColor()}`,
    ].join('\n');
  }
  events.on('pdp/valid', (v) => { lastValid = v; paintDiag(); }, { eager: true });
  events.on('pdp/values', () => { paintSummary(); paintPreview(); paintDiag(); }, { eager: true });
  paint();
  paintSummary();
  paintPreview();
  applyToProduct(); // starts every unused placement on its "None" value, if the admin has one
  paintDiag();
}
