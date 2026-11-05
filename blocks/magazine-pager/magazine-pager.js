import { CS_FETCH_GRAPHQL, getProductLink } from '../../scripts/commerce.js';
import { figures } from '../../scripts/wholesale-mock.js';
import { readBlockConfig } from '../../scripts/aem.js';

/**
 * magazine-pager: a category-style product grid where "next page" turns a page like a magazine.
 *
 * Block table (da.live):
 *   magazine-pager
 *   Title      | Polo Shirts
 *   SKUs       | cfm, cfp, cfk, rfk
 *   Page size  | 4          (optional, default 4)
 *
 * Products are real: name, price, picture and link come from Commerce (same call as sku-search).
 */

const TURN_MS = 900;
const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
const fixUrl = (u) => (u && u.startsWith('//') ? `https:${u}` : u || '');
const amount = (a) => (a?.amount?.value !== undefined ? Number(a.amount.value) : 0);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

async function fetchProducts(skus) {
  const query = `query GET_PRODUCTS($skus: [String]) {
    products(skus: $skus) {
      sku
      name
      urlKey
      images { url roles }
      ... on SimpleProductView {
        price { final { amount { currency value } } regular { amount { currency value } } }
      }
      ... on ComplexProductView {
        priceRange { minimum { final { amount { currency value } } regular { amount { currency value } } } }
      }
    }
  }`;
  const res = await CS_FETCH_GRAPHQL.fetchGraphQl(query, { method: 'GET', variables: { skus } });
  if (res?.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '));
  const byKey = new Map();
  (res?.data?.products || []).forEach((p) => {
    if (!p?.sku) return;
    const final = amount(p.price?.final) || amount(p.priceRange?.minimum?.final);
    const regular = amount(p.price?.regular) || amount(p.priceRange?.minimum?.regular) || final;
    const f = figures({ final, regular }, { sku: p.sku });
    const imgs = p.images || [];
    const best = ['image', 'small_image', 'thumbnail'].map((r) => imgs.find((i) => (i.roles || []).includes(r))).find(Boolean) || imgs[0];
    byKey.set(p.sku.toLowerCase(), {
      sku: p.sku,
      name: p.name || p.sku,
      url: p.urlKey ? getProductLink(p.urlKey, p.sku) : '',
      image: fixUrl(best?.url),
      wholesale: f.wholesale,
      msrp: f.msrp,
    });
  });
  // keep the order the author listed them in
  return skus.map((s) => byKey.get(s.toLowerCase())).filter(Boolean);
}

function tile(p) {
  const a = el('a', 'mp-tile');
  if (p.url) a.href = p.url;
  const pic = el('div', 'mp-pic');
  if (p.image) {
    const img = document.createElement('img');
    img.src = p.image;
    img.alt = p.name;
    img.loading = 'lazy';
    pic.append(img);
  }
  a.append(pic, el('p', 'mp-name', p.name), el('p', 'mp-sku', p.sku.toUpperCase()));
  const price = el('p', 'mp-price');
  price.append(el('strong', '', money(p.wholesale)), el('span', 'mp-msrp', ` MSRP ${money(p.msrp)}`));
  a.append(price);
  return a;
}

function buildPage(items, number, total) {
  const page = el('div', 'mp-page');
  const grid = el('div', 'mp-grid');
  items.forEach((p) => grid.append(tile(p)));
  page.append(grid, el('p', 'mp-folio', `${number} / ${total}`));
  return page;
}

export default async function decorate(block) {
  const cfg = readBlockConfig(block);
  const title = cfg.title || 'Collection';
  const skus = String(cfg.skus || '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const size = Math.max(1, parseInt(cfg['page-size'] || cfg.pagesize || '4', 10) || 4);
  block.textContent = '';

  const head = el('div', 'mp-head');
  head.append(el('h2', 'mp-title', title));
  const count = el('p', 'mp-count');
  head.append(count);
  const book = el('div', 'mp-book');
  const nav = el('div', 'mp-nav');
  block.append(head, book, nav);

  if (!skus.length) {
    book.append(el('p', 'mp-msg', 'Add a "SKUs" row to this block, for example: cfm, cfp, cfk.'));
    return;
  }
  book.append(el('p', 'mp-msg', 'Loading the catalog...'));

  let products = [];
  try {
    products = await fetchProducts(skus);
  } catch (e) {
    book.textContent = '';
    book.append(el('p', 'mp-msg', `Could not load products: ${e.message}`));
    return;
  }
  book.textContent = '';
  if (!products.length) {
    book.append(el('p', 'mp-msg', 'None of these SKUs were found in the catalog.'));
    return;
  }

  const chunks = [];
  for (let i = 0; i < products.length; i += size) chunks.push(products.slice(i, i + size));
  const total = chunks.length;
  count.textContent = `${products.length} products`;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let index = Math.min(total, Math.max(1, parseInt(new URLSearchParams(window.location.search).get('page'), 10) || 1)) - 1;
  let busy = false;

  const prev = el('button', 'mp-btn', 'Previous page');
  const next = el('button', 'mp-btn', 'Next page');
  prev.type = 'button';
  next.type = 'button';
  const status = el('span', 'mp-status');
  status.setAttribute('role', 'status');
  const dots = el('div', 'mp-dots');
  nav.append(prev, dots, status, next);

  const dotButtons = chunks.map((_, i) => {
    const d = el('button', 'mp-dot', String(i + 1));
    d.type = 'button';
    d.setAttribute('aria-label', `Go to page ${i + 1}`);
    d.addEventListener('click', () => go(i)); // eslint-disable-line no-use-before-define
    dots.append(d);
    return d;
  });

  const pageAt = (i) => buildPage(chunks[i], i + 1, total);

  function refreshNav() {
    prev.disabled = index === 0;
    next.disabled = index === total - 1;
    status.textContent = `Page ${index + 1} of ${total}`;
    dotButtons.forEach((d, i) => {
      if (i === index) d.setAttribute('aria-current', 'page'); else d.removeAttribute('aria-current');
    });
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('page', String(index + 1));
      window.history.replaceState(null, '', u);
    } catch (e) { /* ignore */ }
  }

  let current = pageAt(index);
  book.append(current);
  refreshNav();

  /**
   * Turn the page. The leaf is a clone of the page that is turning: its front is the page,
   * its back is blank paper. It rotates around the spine (left edge) while a shadow
   * moves across the page underneath.
   */
  async function go(target) {
    if (busy || target === index || target < 0 || target >= total) return;
    const forward = target > index;
    // for several pages at once, do one turn that lands on the target
    const incoming = pageAt(target);

    if (reduce) {
      current.replaceWith(incoming);
      current = incoming;
      index = target;
      refreshNav();
      return;
    }

    busy = true;
    book.classList.add('is-turning');
    const leaf = el('div', 'mp-leaf');
    const front = el('div', 'mp-face mp-front');
    const back = el('div', 'mp-face mp-back');
    const shade = el('div', 'mp-shade');
    const light = el('div', 'mp-light');
    front.append(forward ? current.cloneNode(true) : incoming.cloneNode(true));
    leaf.append(front, back, light);

    let under;
    if (forward) {
      under = incoming; // revealed as the leaf lifts away
      book.prepend(under);
      under.classList.add('mp-under');
      under.append(shade);
      book.append(leaf);
      current.style.visibility = 'hidden';
    } else {
      under = current; // stays in place, leaf comes down on top of it
      under.classList.add('mp-under');
      under.append(shade);
      book.append(leaf);
    }

    const from = forward ? 0 : -180;
    const to = forward ? -180 : 0;
    const timing = { duration: TURN_MS, easing: 'cubic-bezier(0.45, 0.05, 0.25, 1)', fill: 'forwards' };
    const frames = (a, b) => [
      { transform: `rotateY(${a}deg)` },
      { transform: `rotateY(${(a + b) / 2}deg) skewY(${forward ? -2 : 2}deg)`, offset: 0.5 },
      { transform: `rotateY(${b}deg)` },
    ];
    const leafAnim = leaf.animate(frames(from, to), timing);
    // shadow under the leaf: strongest while it is standing up
    shade.animate([{ opacity: forward ? 0.55 : 0 }, { opacity: 0.35, offset: 0.5 }, { opacity: forward ? 0 : 0.55 }], timing);
    // sheen on the leaf as it catches the light
    light.animate([{ opacity: 0 }, { opacity: 0.55, offset: 0.5 }, { opacity: 0 }], timing);
    try { await leafAnim.finished; } catch (e) { /* cancelled */ }

    // settle: show the target page in the normal flow and remove the effects
    const settled = forward ? under : (() => { under.remove(); return incoming; })();
    leaf.remove();
    shade.remove();
    if (!forward) { current.remove(); book.append(settled); }
    else { current.remove(); }
    settled.classList.remove('mp-under');
    settled.style.visibility = '';
    current = settled;
    index = target;
    book.classList.remove('is-turning');
    busy = false;
    refreshNav();
  }

  prev.addEventListener('click', () => go(index - 1));
  next.addEventListener('click', () => go(index + 1));
  block.tabIndex = 0;
  block.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') go(index + 1);
    if (e.key === 'ArrowLeft') go(index - 1);
  });
}
