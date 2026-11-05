import { events } from '@dropins/tools/event-bus.js';
import * as pdpApi from '@dropins/storefront-pdp/api.js';
import '../../scripts/initializers/pdp.js';

/*
 * Logo customizer: pick where logos go (front left or right, back, arm left or right), which
 * logo, and which color. The price add-on is real: it comes from customizable options set up on
 * the product in the Commerce admin, and this block only chooses them.
 *
 * Admin setup, for each placement (for example "Left chest"), two Drop-down customizable options:
 *   "Left chest - Logo"   one value per logo, priced at the placement price (fixed, per unit)
 *   "Left chest - Color"  one value per color, price 0
 * Value names must match the names in this block's table.
 *
 * Block table (da.live), one row per line:
 *   Title      | Customize with logos
 *   Placement  | Left chest        | 6
 *   Placement  | Right chest       | 6
 *   Placement  | Back              | 8
 *   Placement  | Left sleeve       | 5
 *   Placement  | Right sleeve      | 5
 *   Logo       | Crest             | (picture)  | Navy, Red, White
 *   Logo       | Star              | (picture)  | Gold, Navy
 * A logo with no picture gets a plain stand-in shape.
 */
const HEX = {
  navy: '#1b2a49', red: '#a4262c', white: '#ffffff', black: '#111111', gold: '#b8923a', green: '#2e5e3e', grey: '#8a8a8a', gray: '#8a8a8a', cream: '#f3ead7', blue: '#3b6ea8',
};
const money = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const choices = (opt) => opt?.items || opt?.values || [];
const titleOf = (opt) => opt?.label || opt?.title || opt?.id || '';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** A plain stand-in shape, so the demo works before real logo pictures are added. */
function placeholder(name, colorHex) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('lc-shape');
  const shapes = {
    crest: 'M24 5 L40 11 V25 C40 34 33 40 24 44 C15 40 8 34 8 25 V11 Z',
    star: 'M24 5 L29.5 18 L43 19 L33 28 L36 42 L24 35 L12 42 L15 28 L5 19 L18.5 18 Z',
    stripe: 'M6 14 H42 V20 H6 Z M6 28 H42 V34 H6 Z',
    circle: 'M24 6 A18 18 0 1 1 23.99 6 Z',
  };
  const key = Object.keys(shapes)[(norm(name).length) % 4];
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', shapes[/crest/i.test(name) ? 'crest' : /star/i.test(name) ? 'star' : /stripe|line/i.test(name) ? 'stripe' : key]);
  path.setAttribute('fill', colorHex || '#0d1b3a');
  path.setAttribute('stroke', '#0d1b3a');
  path.setAttribute('stroke-width', '1');
  svg.append(path);
  return svg;
}

/** Read the block table into placements and logos. */
function parseTable(block) {
  const out = { title: 'Customize with logos', placements: [], logos: [] };
  [...block.children].forEach((row) => {
    const cells = [...row.children];
    const kind = norm(cells[0]?.textContent);
    const name = cells[1]?.textContent.trim();
    if (kind === 'title' && name) out.title = name;
    if (kind === 'placement' && name) {
      out.placements.push({ name, price: Number(String(cells[2]?.textContent).replace(/[^0-9.]/g, '')) || 0 });
    }
    if (kind === 'logo' && name) {
      const img = cells[2]?.querySelector('img');
      out.logos.push({
        name,
        image: img ? img.currentSrc || img.src : '',
        colors: String(cells[3]?.textContent || '').split(',').map((c) => c.trim()).filter(Boolean),
      });
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
  Object.values(wired).forEach((w) => [w.logo, w.color].forEach((o) => choices(o).forEach((c) => ownUids.add(c.id))));
  if (debug || !Object.values(wired).some((w) => w.logo)) {
    console.debug('Logo customizer', {
      productOptions: options.map((o) => titleOf(o)),
      wired: Object.fromEntries(Object.entries(wired).map(([k, w]) => [k, { logo: !!w.logo, color: !!w.color }])),
    });
  }

  const state = {}; // placement -> { on, logo, color }
  placements.forEach((pl) => { state[pl.name] = { on: false, logo: '', color: '' }; });

  block.textContent = '';
  block.classList.add('logo-customizer');
  const head = el('div', 'lc-head');
  head.append(el('h2', 'lc-title', table.title));
  head.append(el('p', 'lc-sub', 'Choose where the logo goes, then the logo and color. Each placement adds to the price of every unit.'));
  const list = el('div', 'lc-list');
  const summary = el('div', 'lc-summary');
  summary.setAttribute('role', 'status');
  block.append(head, list, summary);

  // move into the product's option area so it sits beside Color and Size
  const options$ = document.querySelector('.product-details__options');
  if (options$) options$.after(block);

  const complete = (pl) => state[pl.name].on && state[pl.name].logo && state[pl.name].color;

  function applyToProduct() {
    const picked = [];
    placements.forEach((pl) => {
      if (!complete(pl)) return;
      const w = wired[pl.name];
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
        paint();
        applyToProduct();
        paintSummary();
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
            paint();
            applyToProduct();
            paintSummary();
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
              paint();
              applyToProduct();
              paintSummary();
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

  // hide the plain dropdowns Commerce draws for these options: this picker replaces them
  // Find each of our options by its label, then hide just that one field (label + dropdown).
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
      // start at the label's wrapper, then climb while the parent holds the same one control
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

  events.on('pdp/values', paintSummary, { eager: true });
  paint();
  paintSummary();
}
