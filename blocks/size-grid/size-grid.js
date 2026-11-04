import { events } from '@dropins/tools/event-bus.js';
import * as pdpApi from '@dropins/storefront-pdp/api.js';
import { readBlockConfig } from '../../scripts/aem.js';
import { rootLink } from '../../scripts/commerce.js';
import { figures } from '../../scripts/wholesale-mock.js';
import '../../scripts/initializers/pdp.js';
import '../../scripts/initializers/cart.js';

/*
 * Size grid: an order grid for a product page. Sizes run across the top, colors down the side.
 * Type a quantity in any cell, then "Add to cart" puts exactly those quantities in the cart.
 *
 * Put it under the product-details block on the product page. Optional config rows:
 *   Sizes | S, M, L, XL, XXL      (which sizes to show, in this order; default is every size)
 *   Colors | Cream, Black          (which colors to show; default is every color)
 */
const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', 'XXXL', '3XL'];
const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const norm = (s) => String(s ?? '').trim().toLowerCase();
const list = (s) => String(s || '').split(',').map((v) => v.trim()).filter(Boolean);
const choices = (opt) => opt?.items || opt?.values || [];

async function getVariants(sku) {
  const { data } = await pdpApi.fetchGraphQl(
    `query GET_VARIANTS($sku: String!) {
      variants(sku: $sku) {
        variants {
          selections
          product {
            sku
            name
            inStock
            attributes { name label value }
            images(roles: ["image"]) { url }
            ... on SimpleProductView {
              price {
                final { amount { currency value } }
                regular { amount { currency value } }
              }
            }
          }
        }
      }
    }`,
    { method: 'GET', variables: { sku } },
  );
  return (data?.variants?.variants ?? []).filter((v) => v.product);
}

// does this variant carry the given option choice?
function hasChoice(variant, option, choice) {
  if (choice.id && (variant.selections || []).includes(choice.id)) return true;
  const attr = variant.product.attributes?.find((a) => a.name === option.id);
  return !!attr && (norm(attr.value) === norm(choice.label) || norm(attr.value) === norm(choice.value));
}

export default async function decorate(block) {
  const cfg = readBlockConfig(block);
  const wantSizes = list(cfg.sizes);
  const wantColors = list(cfg.colors);
  block.textContent = '';
  block.append(el('p', 'size-grid-status', 'Loading sizes…'));

  const product = await new Promise((resolve) => {
    let done = false;
    const finish = (p) => { if (!done) { done = true; resolve(p); } };
    events.on('pdp/data', (p) => { if (p?.sku) finish(p); }, { eager: true });
    setTimeout(() => finish(null), 8000);
  });
  if (!product) { block.textContent = ''; return; }

  const options = product.options || [];
  const sizeOpt = options.find((o) => /size/i.test(o.id) || /size/i.test(o.label));
  const colorOpt = options.find((o) => o !== sizeOpt);
  if (!sizeOpt || !colorOpt) { block.textContent = ''; return; }

  let variants = [];
  try { variants = await getVariants(product.sku); } catch (e) { variants = []; }

  // sizes across (known order first), colors down
  let sizes = choices(sizeOpt).slice();
  if (wantSizes.length) {
    sizes = wantSizes.map((w) => sizes.find((s) => norm(s.label) === norm(w))).filter(Boolean);
  } else {
    const rank = (s) => { const i = SIZE_ORDER.indexOf(String(s.label).toUpperCase()); return i < 0 ? 99 : i; };
    sizes.sort((a, b) => rank(a) - rank(b));
  }
  let colors = choices(colorOpt).slice();
  if (wantColors.length) {
    colors = wantColors.map((w) => colors.find((c) => norm(c.label).includes(norm(w)))).filter(Boolean);
  }

  const cells = new Map(); // `${r}:${c}` -> { variant, input }
  const table = el('table', 'size-grid-table');
  const head = el('tr');
  head.append(el('th', 'size-grid-corner', 'Color'));
  sizes.forEach((s) => head.append(el('th', 'size-grid-size', s.label)));
  head.append(el('th', 'size-grid-total', 'Total'));
  const thead = el('thead');
  thead.append(head);
  table.append(thead);
  const body = el('tbody');

  const rowTotals = [];
  colors.forEach((color, r) => {
    const tr = el('tr');
    const th = el('th', 'size-grid-color');
    const inner = el('div', 'size-grid-color-inner');
    th.append(inner);
    const first = variants.find((v) => hasChoice(v, colorOpt, color));
    // swatch: the color's own value (hex or image) from Commerce; else the variant photo
    const raw = String(color.value || '').trim();
    const swatch = el('span', 'size-grid-swatch');
    swatch.setAttribute('aria-hidden', 'true');
    const img = first?.product?.images?.[0]?.url;
    if (/^#[0-9a-f]{3,8}$/i.test(raw)) {
      swatch.style.backgroundColor = raw;
    } else if (/^(https?:)?\/\//.test(raw) || raw.startsWith('/')) {
      swatch.style.backgroundImage = `url("${encodeURI(raw)}")`;
    } else if (img) {
      swatch.style.backgroundImage = `url("${encodeURI(img)}")`;
    } else {
      swatch.classList.add('is-empty');
    }
    inner.append(swatch);
    inner.append(el('span', '', color.label));
    tr.append(th);
    sizes.forEach((size, c) => {
      const td = el('td');
      const variant = variants.find((v) => hasChoice(v, colorOpt, color) && hasChoice(v, sizeOpt, size));
      if (!variant || variant.product.inStock === false) {
        td.append(el('span', 'size-grid-na', variant ? 'Out' : '–'));
      } else {
        const input = el('input', 'size-grid-qty');
        input.type = 'number'; input.min = '0'; input.step = '1'; input.value = '0';
        input.inputMode = 'numeric';
        input.setAttribute('aria-label', `${color.label}, size ${size.label}`);
        input.addEventListener('focus', () => input.select());
        input.addEventListener('input', update);
        td.append(input);
        cells.set(`${r}:${c}`, { variant, input });
      }
      tr.append(td);
    });
    const rt = el('td', 'size-grid-total', '0');
    rowTotals.push(rt);
    tr.append(rt);
    body.append(tr);
  });

  const foot = el('tr', 'size-grid-footer');
  foot.append(el('th', '', 'Total'));
  const colTotals = sizes.map(() => el('td', '', '0'));
  foot.append(...colTotals);
  const grand = el('td', 'size-grid-total', '0');
  foot.append(grand);
  body.append(foot);
  table.append(body);

  const bar = el('div', 'size-grid-bar');
  const summary = el('span', 'size-grid-summary', 'Enter quantities above');
  const button = el('button', 'size-grid-add', 'Add to cart');
  button.type = 'button';
  button.disabled = true;
  bar.append(summary, button);
  const message = el('div', 'size-grid-message');
  message.setAttribute('role', 'status');

  const wrap = el('div', 'size-grid-scroll');
  wrap.append(table);
  block.replaceChildren(
    el('h2', 'size-grid-title', 'Order by size'),
    wrap,
    bar,
    message,
  );

  function qty(cell) { return Math.max(0, Math.floor(Number(cell.input.value) || 0)); }

  function selected() {
    const out = [];
    cells.forEach((cell) => {
      const q = qty(cell);
      if (q > 0) out.push({ variant: cell.variant, quantity: q });
    });
    return out;
  }

  function update() {
    const rTot = colors.map(() => 0);
    const cTot = sizes.map(() => 0);
    let money = 0;
    cells.forEach((cell, key) => {
      const [r, c] = key.split(':').map(Number);
      const q = qty(cell);
      rTot[r] += q; cTot[c] += q;
      const p = cell.variant.product.price;
      const f = figures({ final: p?.final?.amount?.value || 0, regular: p?.regular?.amount?.value || 0 }, product);
      money += q * f.wholesale;
    });
    rowTotals.forEach((n, i) => { n.textContent = rTot[i]; });
    colTotals.forEach((n, i) => { n.textContent = cTot[i]; });
    const total = rTot.reduce((a, b) => a + b, 0);
    grand.textContent = total;
    button.disabled = total === 0;
    summary.textContent = total ? `${total} unit${total === 1 ? '' : 's'} · ${fmt.format(money)} wholesale` : 'Enter quantities above';
  }

  button.addEventListener('click', async () => {
    const picks = selected();
    if (!picks.length) return;
    button.disabled = true;
    button.textContent = 'Adding…';
    message.className = 'size-grid-message';
    message.textContent = '';
    try {
      const { addProductsToCart } = await import('@dropins/storefront-cart/api.js');
      await addProductsToCart(picks.map(({ variant, quantity }) => ({
        sku: product.sku,
        optionsUIDs: variant.selections,
        quantity,
      })));
      const total = picks.reduce((a, p) => a + p.quantity, 0);
      cells.forEach((cell) => { cell.input.value = '0'; });
      update();
      message.className = 'size-grid-message is-ok';
      message.textContent = `Added ${total} unit${total === 1 ? '' : 's'} to your cart. `;
      const a = el('a', '', 'View cart');
      a.href = rootLink('/cart');
      message.append(a);
    } catch (e) {
      message.className = 'size-grid-message is-error';
      message.textContent = e?.message || 'Could not add to cart.';
      button.disabled = false;
    } finally {
      button.textContent = 'Add to cart';
    }
  });
}
