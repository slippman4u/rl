/**
 * Shop the Look block
 *
 * Authoring table format (da.live / Google Doc):
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ shop-the-look                                                   │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ [lifestyle / model image — paste image or enter URL]           │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ ms-ss-lin-020   ← product SKU, plain text, one row per product │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ mp-cpr-wst-004                                                  │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Row 1  — lifestyle/model image (first cell only).
 * Row 2+ — one SKU per row (first cell, plain text).
 *           Product name, price, and thumbnail are fetched live from
 *           the ACO Catalog Service GraphQL API.
 */

import { getConfigValue, getHeaders } from '@dropins/tools/lib/aem/configs.js';

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

/**
 * Extract a usable image element or URL string from a block cell.
 * Handles Google Docs <picture>, bare <img>, hyperlinks, and plain-text URLs.
 * @param {HTMLElement} cell
 * @returns {HTMLElement|string|null}
 */
function imageFromCell(cell) {
  const picture = cell.querySelector('picture');
  if (picture) return picture.cloneNode(true);
  const img = cell.querySelector('img');
  if (img) return img.cloneNode(true);
  const a = cell.querySelector('a');
  if (a?.href) {
    // Resolve relative da.live media paths to absolute URLs.
    // Convert GitHub blob-viewer URLs (github.com/.../blob/...) to raw content URLs
    // (raw.githubusercontent.com/...) so the browser loads the actual image bytes.
    let href = a.href.startsWith('http') ? a.href : `${window.location.origin}${a.href}`;
    href = href
      .replace(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\//, 'https://raw.githubusercontent.com/$1/')
      .replace(/[?&]raw=true/, '');
    return href;
  }
  const text = cell.textContent.trim();
  if (/^https?:\/\//.test(text)) return text;
  return null;
}

/**
 * Fetch product data for an array of SKUs from the ACO Catalog Service.
 * Returns the products array from the GraphQL response, or throws on failure.
 * @param {string[]} skus
 * @returns {Promise<Object[]>}
 */
async function fetchProducts(skus) {
  const query = `{
    products(skus: ${JSON.stringify(skus)}) {
      sku
      name
      images(roles: ["thumbnail"]) {
        url
        label
      }
      ... on SimpleProductView {
        price {
          final {
            amount {
              value
              currency
            }
          }
        }
      }
      ... on ComplexProductView {
        priceRange {
          minimum {
            final {
              amount {
                value
                currency
              }
            }
          }
        }
      }
    }
  }`;

  const endpoint = await getConfigValue('commerce-endpoint');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getHeaders('cs'),
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) throw new Error(`GraphQL request failed: ${response.status}`);

  const { data, errors } = await response.json();
  if (errors?.length) throw new Error(errors[0].message);

  return data?.products ?? [];
}

/**
 * Extract the price amount from a product returned by the ACO Catalog Service.
 * Handles both SimpleProductView (product.price) and ComplexProductView
 * (product.priceRange.minimum), returning the final { value, currency } amount.
 * @param {Object} product — raw product object from the GraphQL response
 * @returns {string}  e.g. "$98.00"
 */
function formatPrice(product) {
  // SimpleProductView exposes price.final.amount
  // ComplexProductView exposes priceRange.minimum.final.amount
  const amount = product?.price?.final?.amount
    ?? product?.priceRange?.minimum?.final?.amount;
  if (!amount?.value) return '';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: amount.currency || 'USD',
    }).format(amount.value);
  } catch {
    return `${amount.currency ?? ''}${amount.value}`;
  }
}

/**
 * Build the product page URL from the product name and SKU.
 * e.g. "Breeze Stripe Linen Shirt" + "ms-ss-lin-020"
 *   →  /products/breeze-stripe-linen-shirt/ms-ss-lin-020
 * @param {string} name
 * @param {string} sku
 * @returns {string}
 */
function buildProductUrl(name, sku) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `/products/${slug}/${sku}`;
}

// ---------------------------------------------------------------------------
// Grid item builders
// ---------------------------------------------------------------------------

/**
 * Create a skeleton placeholder tile shown while the API call is in flight.
 * @param {number} index
 * @returns {HTMLElement}
 */
function buildSkeletonItem(index) {
  const item = document.createElement('div');
  item.className = 'stl-grid-item stl-grid-item--loading';
  item.setAttribute('role', 'listitem');
  item.dataset.productIndex = index;

  const skeleton = document.createElement('div');
  skeleton.className = 'stl-grid-skeleton';
  item.appendChild(skeleton);

  return item;
}

/**
 * Populate a skeleton tile in-place with live product data from the API.
 * @param {HTMLElement} item   — the skeleton .stl-grid-item to replace
 * @param {Object}      product — product object from the GraphQL response
 * @param {number}      index
 */
function populateGridItem(item, product, index) {
  const name = product.name || product.sku;
  const price = formatPrice(product);
  const imageUrl = product.images?.[0]?.url || '';
  const imageAlt = product.images?.[0]?.label || name;
  const url = buildProductUrl(name, product.sku);

  item.className = 'stl-grid-item';
  item.dataset.productIndex = index;
  item.dataset.name = name;
  item.dataset.price = price;
  item.dataset.url = url;
  item.innerHTML = '';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'stl-grid-btn';
  btn.setAttribute('aria-label', name);

  if (imageUrl) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = imageAlt;
    img.className = 'stl-grid-img';
    img.loading = 'lazy';
    btn.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'stl-grid-img stl-grid-img--placeholder';
    btn.appendChild(placeholder);
  }

  item.appendChild(btn);
}

/**
 * Render a visible error state on a tile when the SKU returned no data
 * or the API call failed.
 * @param {HTMLElement} item
 */
function showErrorItem(item) {
  item.className = 'stl-grid-item stl-grid-item--error';
  item.innerHTML = '';

  const errorEl = document.createElement('div');
  errorEl.className = 'stl-grid-error';
  errorEl.textContent = 'Product unavailable';
  item.appendChild(errorEl);
}

// ---------------------------------------------------------------------------
// Popup
// ---------------------------------------------------------------------------

/**
 * Wire up the shared popup interaction layer for the product grid.
 * A single popup element is reused for every thumbnail.
 * Error tiles (no .stl-grid-btn) are automatically skipped.
 * @param {HTMLElement} block
 */
function setupPopup(block) {
  // --- Build popup element ---
  const popup = document.createElement('div');
  popup.className = 'stl-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-modal', 'true');
  popup.setAttribute('aria-label', 'Product details');
  popup.hidden = true;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'stl-popup-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';

  const nameEl = document.createElement('p');
  nameEl.className = 'stl-popup-name';

  const priceEl = document.createElement('p');
  priceEl.className = 'stl-popup-price';

  const cta = document.createElement('a');
  cta.className = 'stl-popup-cta';
  cta.target = '_blank';
  cta.rel = 'noopener noreferrer';
  cta.textContent = 'View this item';

  popup.append(closeBtn, nameEl, priceEl, cta);
  block.appendChild(popup);

  // --- State ---
  let activeTrigger = null;

  function openPopup(triggerItem) {
    nameEl.textContent = triggerItem.dataset.name || '';
    priceEl.textContent = triggerItem.dataset.price || '';
    cta.href = triggerItem.dataset.url || '#';
    // Move popup into the triggered tile — CSS (position:absolute; bottom:0; left:0; right:0)
    // pins it to the tile's bottom edge as a caption overlay with no layout impact.
    triggerItem.appendChild(popup);
    popup.hidden = false;
    activeTrigger = triggerItem;
  }

  // returnFocus=true restores focus to the tile button (keyboard/close-btn dismissal).
  // Hover-triggered closes skip focus restoration to avoid jarring keyboard jumps.
  function closePopup({ returnFocus = false } = {}) {
    popup.hidden = true;
    const returning = activeTrigger;
    activeTrigger = null;
    if (returnFocus) returning?.querySelector('.stl-grid-btn')?.focus();
  }

  // Grace-period timer: keeps popup alive while mouse travels from thumbnail to card.
  let hideTimer = null;
  function scheduleClose() { hideTimer = setTimeout(closePopup, 200); }
  function cancelClose() { clearTimeout(hideTimer); hideTimer = null; }

  // Detect true-hover (mouse) device vs. touch-only.
  const hasHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // Attach per-tile listeners — skip error tiles that have no .stl-grid-btn.
  block.querySelectorAll('.stl-grid-item').forEach((item) => {
    const btn = item.querySelector('.stl-grid-btn');
    if (!btn) return;

    if (hasHover) {
      item.addEventListener('mouseenter', () => { cancelClose(); openPopup(item); });
      item.addEventListener('mouseleave', scheduleClose);
    }

    // Fires on keyboard Enter/Space; also fires on mouse click (toggle behaviour).
    btn.addEventListener('click', () => {
      if (!popup.hidden && activeTrigger === item) {
        cancelClose();
        closePopup({ returnFocus: true });
        return;
      }
      openPopup(item);
    });
  });

  if (hasHover) {
    popup.addEventListener('mouseenter', cancelClose);
    popup.addEventListener('mouseleave', scheduleClose);
  } else {
    // Mobile: tap outside popup to close.
    document.addEventListener('click', (e) => {
      if (popup.hidden) return;
      if (popup.contains(e.target)) return;
      if (e.target.closest('.stl-grid-item')) return;
      closePopup();
    });
  }

  // Close button (both modes).
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    cancelClose();
    closePopup({ returnFocus: true });
  });

  // Escape key (both modes).
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !popup.hidden) { cancelClose(); closePopup({ returnFocus: true }); }
  });

  // Focus trap: Tab cycles only within the popup.
  popup.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusable = [...popup.querySelectorAll('button, a[href]')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  });
}

// ---------------------------------------------------------------------------
// Block entry point
// ---------------------------------------------------------------------------

export default async function decorate(block) {
  // --- Parse authored rows ---
  // Row 1: lifestyle/model image (first cell only).
  // Rows 2+: one SKU per row, plain text in the first cell.

  const rows = [...block.querySelectorAll(':scope > div')];
  const [firstRow, ...productRows] = rows;

  // Lifestyle image — scan every cell in the first row first.
  // If nothing is found there (e.g. the first row is a label-only row and the
  // image link lives in its own subsequent row), fall back to scanning productRows
  // in order and promote the first image-bearing row to be the lifestyle image.
  // That row's index is recorded so it is excluded from the SKU list below.
  const firstRowCells = firstRow ? [...firstRow.querySelectorAll(':scope > div')] : [];
  let lifestyleImg = firstRowCells.reduce((found, cell) => found ?? imageFromCell(cell), null);
  let lifestyleRowIndex = -1;

  if (!lifestyleImg) {
    productRows.forEach((row, i) => {
      if (lifestyleImg !== null) return; // already found — skip remaining rows
      const cells = [...row.querySelectorAll(':scope > div')];
      const found = cells.reduce((f, cell) => f ?? imageFromCell(cell), null);
      if (found !== null) {
        lifestyleImg = found;
        lifestyleRowIndex = i;
      }
    });
  }

  // SKUs — one per row, first cell, plain text. Normalise to lowercase so that
  // da.live-authored "MS-SS-LIN-020" matches the ACO API's "ms-ss-lin-020".
  // Skip the lifestyle image row (if it was found in productRows) and anything
  // that is clearly not a product SKU (URLs, link labels, long strings).
  const skus = productRows.reduce((acc, row, i) => {
    if (i === lifestyleRowIndex) return acc;
    const raw = row.querySelector(':scope > div')?.textContent.trim();
    if (!raw) return acc;
    const sku = raw.toLowerCase();
    if (sku.startsWith('http') || sku.includes('/') || sku.includes(' ') || sku.length > 50) return acc;
    acc.push(sku);
    return acc;
  }, []);

  // --- Build static DOM immediately ---
  block.innerHTML = '';

  const heading = document.createElement('h2');
  heading.className = 'stl-heading';
  heading.textContent = 'How To Wear It';
  block.appendChild(heading);

  const layout = document.createElement('div');
  layout.className = 'stl-layout';

  // LEFT panel — lifestyle / model image (eager: likely above the fold)
  const lifestylePanel = document.createElement('div');
  lifestylePanel.className = 'stl-lifestyle';
  if (lifestyleImg) {
    let lifestyleEl;
    if (typeof lifestyleImg === 'string') {
      // imageFromCell returned a URL string — create an <img> directly
      lifestyleEl = document.createElement('img');
      lifestyleEl.src = lifestyleImg;
      lifestyleEl.alt = 'Model wearing the look';
      lifestyleEl.loading = 'eager';
      lifestyleEl.className = 'stl-lifestyle-img';
    } else {
      // imageFromCell returned a <picture> or <img> element
      lifestyleEl = lifestyleImg;
      lifestyleEl.className = 'stl-lifestyle-img';
      if (lifestyleEl.tagName === 'IMG') lifestyleEl.loading = 'eager';
    }
    lifestylePanel.appendChild(lifestyleEl);
  }
  layout.appendChild(lifestylePanel);

  // RIGHT panel — skeleton tiles shown immediately while API is in flight
  const grid = document.createElement('div');
  grid.className = 'stl-grid';
  grid.setAttribute('role', 'list');
  grid.setAttribute('aria-label', 'Shop the Look — products');

  // One skeleton tile per authored SKU — count is fully dynamic.
  const gridItems = skus.map((sku, i) => {
    const item = buildSkeletonItem(i);
    grid.appendChild(item);
    return item;
  });

  layout.appendChild(grid);
  block.appendChild(layout);

  // --- Fetch live product data and populate the grid ---
  if (skus.length > 0) {
    try {
      const products = await fetchProducts(skus);
      const bySkus = new Map(products.map((p) => [p.sku.toLowerCase(), p]));

      skus.forEach((sku, i) => {
        const product = bySkus.get(sku);
        if (product) {
          populateGridItem(gridItems[i], product, i);
        } else {
          showErrorItem(gridItems[i]);
        }
      });
    } catch {
      gridItems.forEach((item) => showErrorItem(item));
    }
  }

  // Wire up popup after grid tiles are in their final state.
  setupPopup(block);
}
