/**
 * Live product data for the rep workspace.
 *
 * Reuses the storefront's Catalog Service client (CS_FETCH_GRAPHQL), which
 * initializeCommerce() already points at the endpoint/headers from config.json,
 * so no endpoint, key or store view code is hard-coded here.
 */
import { CS_FETCH_GRAPHQL } from '../../../scripts/commerce.js';

export const STORAGE_KEY = 'rep-workspace-products';
const STORE_VERSION = 2; // 2: colors are { title, swatch } objects
export const TIMEOUT_MS = 4000;
const PAGE_SIZE = 100; // Catalog Service rejects larger variant pages
const MAX_PAGES = 20;

const PRODUCT_FIELDS = `sku
    name
    images(roles: []) { url roles }
    ... on ComplexProductView {
      options { id title values { id title ... on ProductViewOptionValueSwatch { type value } } }
      priceRange { minimum { final { amount { value } } } }
    }`;

const VARIANT_FIELDS = `variants {
  selections
  product { sku ... on SimpleProductView { price { final { amount { value } } } } }
}
cursor`;

/** One request: the products plus a first page of variants for every parent (aliased). */
const BATCH_QUERY = (skus) => `{
  products(skus: ${JSON.stringify(skus)}) {
    ${PRODUCT_FIELDS}
  }
  ${skus.map((sku, i) => `v${i}: variants(sku: ${JSON.stringify(sku)}, pageSize: ${PAGE_SIZE}) { ${VARIANT_FIELDS} }`).join('\n')}
}`;

/** Follow-up request for the parents whose variants span more than one page. */
const PAGE_QUERY = (pending) => `{
  ${pending.map(({ sku, cursor }, i) => `v${i}: variants(sku: ${JSON.stringify(sku)}, pageSize: ${PAGE_SIZE}, cursor: ${JSON.stringify(cursor)}) { ${VARIANT_FIELDS} }`).join('\n')}
}`;

let cachedFlag = false;

/** True when the most recent fetchProducts() result came from localStorage. */
export const isCachedData = () => cachedFlag;

function readStore(skus) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    const have = new Set((stored?.products || []).map((p) => p.sku));
    if (stored?.version === STORE_VERSION && skus.every((sku) => have.has(sku))) return stored;
  } catch (e) {
    // storage unavailable or corrupt: behave as if nothing is cached
  }
  return null;
}

function writeStore(payload) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    // quota or privacy mode: the live data is still used for this session
  }
}

const finalPrice = (variant) => Number(variant?.product?.price?.final?.amount?.value) || 0;

function shapeProduct(raw, variantRows) {
  const options = raw.options || [];
  const colorOption = options.find((o) => /colou?r/i.test(`${o.id} ${o.title}`));
  const sizeOption = options.find((o) => /size/i.test(o.id) || /size/i.test(o.title));
  const titles = new Map();
  options.forEach((o) => {
    (o.values || []).forEach((v) => titles.set(v.id, { optionId: o.id, title: v.title }));
  });

  const seen = new Set();
  const variants = [];
  variantRows.forEach((row) => {
    const sku = row?.product?.sku;
    if (!sku || seen.has(sku)) return;
    seen.add(sku);
    const picks = (row.selections || []).map((id) => titles.get(id)).filter(Boolean);
    variants.push({
      sku,
      color: picks.find((p) => p.optionId === colorOption?.id)?.title || '',
      size: picks.find((p) => p.optionId === sizeOption?.id)?.title || '',
      price: finalPrice(row),
    });
  });

  const images = (raw.images || []).map((i) => i.url);
  return {
    sku: raw.sku,
    name: raw.name || raw.sku,
    imageUrl: images[0] || '',
    images,
    colors: (colorOption?.values || []).map((v) => ({
      title: v.title,
      swatch: /^(#[0-9a-f]{3,8}|rgb)/i.test(v.value || '') ? v.value : '',
    })),
    sizes: (sizeOption?.values || []).map((v) => v.title),
    // parent price is 0 in the admin; this is only a fallback for colors with no variants
    fallbackPrice: Number(raw.priceRange?.minimum?.final?.amount?.value) || 0,
    variants,
  };
}

async function fetchLive(skus, signal) {
  const run = async (query) => {
    const res = await CS_FETCH_GRAPHQL.fetchGraphQl(query, { method: 'POST', signal });
    if (res?.errors?.length) throw new Error(res.errors[0].message);
    return res.data;
  };

  const data = await run(BATCH_QUERY(skus));
  const rows = skus.map((_, i) => data[`v${i}`]?.variants || []);
  let cursors = skus.map((_, i) => data[`v${i}`]?.cursor || null);

  for (let page = 0; page < MAX_PAGES && cursors.some(Boolean); page += 1) {
    const pending = [];
    for (let i = 0; i < skus.length; i += 1) {
      if (cursors[i]) pending.push({ sku: skus[i], cursor: cursors[i], i });
    }
    // eslint-disable-next-line no-await-in-loop
    const next = await run(PAGE_QUERY(pending));
    cursors = skus.map(() => null);
    for (let n = 0; n < pending.length; n += 1) {
      const { i } = pending[n];
      rows[i].push(...(next[`v${n}`]?.variants || []));
      cursors[i] = next[`v${n}`]?.cursor || null;
    }
  }

  const bySku = new Map((data.products || []).filter(Boolean).map((p) => [p.sku, p]));
  const products = [];
  skus.forEach((sku, i) => {
    const raw = bySku.get(sku);
    if (raw) products.push(shapeProduct(raw, rows[i]));
  });
  if (!products.length) throw new Error('Catalog Service returned no products');
  return products;
}

/**
 * Fetch name, images, options and variant pricing for the given parent SKUs.
 * Falls back to the localStorage copy when the call fails or exceeds 4 seconds.
 * @param {string[]} skus parent SKUs (exact case)
 * @returns {Promise<{products: Object[], cached: boolean, fetchedAt: number}>}
 */
export async function fetchProducts(skus) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Catalog Service took longer than ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
  });
  try {
    const products = await Promise.race([fetchLive(skus, controller.signal), timeout]);
    const result = { products, cached: false, fetchedAt: Date.now() };
    cachedFlag = false;
    writeStore({ version: STORE_VERSION, products, fetchedAt: result.fetchedAt });
    return result;
  } catch (e) {
    const stored = readStore(skus);
    if (!stored) throw e;
    console.warn('rep-workspace: live product data unavailable, using cached copy', e);
    cachedFlag = true;
    return { products: stored.products, cached: true, fetchedAt: stored.fetchedAt };
  } finally {
    clearTimeout(timer);
  }
}
