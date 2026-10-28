import { readBlockConfig } from '../../scripts/aem.js';
import { CORE_FETCH_GRAPHQL } from '../../scripts/commerce.js';

import '../../scripts/initializers/cart.js';

/*
 * Last split order (home page, signed-in buyers).
 *
 * Finds the buyer's most recent "split order": orders placed back to back by one checkout of
 * the Cart Split block. Orders from the same customer created within a few minutes of each
 * other count as one group (demo grade: Commerce does not link them).
 *
 * "Reorder all" empties the active cart, adds the combined products of the whole group, saves
 * where each order shipped, and opens the cart. The Cart Split block there fills the
 * accordion the same way as last time, and the buyer reviews it and clicks Checkout.
 *
 * Block table options (all optional):
 *   Window Minutes  orders closer together than this are one group   (default 2)
 *   Cart Page       where Reorder all takes the buyer                (default /cart)
 *   Orders Page     "View all orders" link                           (default /customer/orders)
 *   Title           heading                                          (default Your last split order)
 */
const PREFILL_KEY = 'cart-split-prefill'; // read by the cart-split block

const ORDER_FIELDS = `number order_date total { grand_total { value } }
  shipping_address { firstname lastname company street city region postcode }`;

const QUERY = (withParent) => `query {
  customer {
    orders(pageSize: 20, currentPage: 1, sort: { sort_field: CREATED_AT, sort_direction: DESC }) {
      items {
        ${ORDER_FIELDS}
        items {
          product_sku product_name quantity_ordered
          ${withParent ? '... on ConfigurableOrderItem { parent_sku }' : ''}
        }
      }
    }
  }
}`;

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const num = new Intl.NumberFormat('en-US');
const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

async function gql(query) {
  const res = await CORE_FETCH_GRAPHQL.fetchGraphQl(query, { method: 'POST' });
  if (res?.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '));
  return res.data;
}

async function loadOrders() {
  let data;
  try {
    data = await gql(QUERY(true));
  } catch (e) {
    data = await gql(QUERY(false)); // schema without the configurable fragment
  }
  return (data?.customer?.orders?.items || []).map((o) => ({
    number: o.number,
    at: new Date(o.order_date).getTime(),
    total: Number(o.total?.grand_total?.value) || 0,
    address: [o.shipping_address?.company, o.shipping_address?.firstname, o.shipping_address?.lastname,
      ...(o.shipping_address?.street || []), o.shipping_address?.city, o.shipping_address?.region]
      .filter(Boolean).join(' '),
    place: o.shipping_address?.company || o.shipping_address?.city || 'Ship-to',
    items: (o.items || []).map((i) => ({
      sku: i.product_sku,
      parent: i.parent_sku || '',
      name: i.product_name,
      qty: Math.max(0, Math.floor(Number(i.quantity_ordered) || 0)),
    })).filter((i) => i.qty > 0),
  }));
}

/** The newest group: orders whose gap to the one before it (newer) is within the window. */
export function newestGroup(orders, windowMinutes = 2) {
  const sorted = [...orders].filter((o) => Number.isFinite(o.at)).sort((a, b) => b.at - a.at);
  if (!sorted.length) return [];
  const group = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    if (group[group.length - 1].at - sorted[i].at <= windowMinutes * 60 * 1000) group.push(sorted[i]);
    else break;
  }
  return group.reverse(); // oldest first, in the order they were placed
}

/** Combined products across the group, one entry per SKU. */
export function combine(group) {
  const bySku = new Map();
  group.forEach((o) => o.items.forEach((i) => {
    const cur = bySku.get(i.sku) || { ...i, qty: 0 };
    cur.qty += i.qty;
    bySku.set(i.sku, cur);
  }));
  return [...bySku.values()];
}

/** What the cart-split block needs to rebuild the same split. */
export function prefillFor(group) {
  return group.map((o) => ({
    address: o.address,
    items: o.items.map((i) => ({ skus: [i.sku, i.parent].filter(Boolean), name: i.name, qty: i.qty })),
  }));
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

async function replaceCart(group) {
  const cartData = await gql(`query { customerCart { id itemsV2(pageSize: 100, currentPage: 1) { items { uid } } } }`);
  const cart = cartData?.customerCart;
  if (!cart?.id) throw new Error('Could not read your cart');
  const uids = (cart.itemsV2?.items || []).map((i) => i.uid);
  if (uids.length) {
    await CORE_FETCH_GRAPHQL.fetchGraphQl(
      `mutation($input: UpdateCartItemsInput) { updateCartItems(input: $input) { cart { id } } }`,
      { method: 'POST', variables: { input: { cart_id: cart.id, cart_items: uids.map((u) => ({ cart_item_uid: u, quantity: 0 })) } } },
    );
  }
  const items = combine(group).map((i) => (i.parent
    ? { sku: i.sku, parent_sku: i.parent, quantity: i.qty }
    : { sku: i.sku, quantity: i.qty }));
  const res = await CORE_FETCH_GRAPHQL.fetchGraphQl(
    `mutation($cartId: String!, $items: [CartItemInput!]!) {
      addProductsToCart(cartId: $cartId, cartItems: $items) { cart { id } user_errors { code message } }
    }`,
    { method: 'POST', variables: { cartId: cart.id, items } },
  );
  if (res?.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '));
  const problems = res?.data?.addProductsToCart?.user_errors || [];
  if (problems.length) throw new Error(problems.map((e) => e.message).join('; '));
}

export default async function decorate(block) {
  const raw = readBlockConfig(block);
  const windowMinutes = Number(raw['window-minutes']) || 2;
  const cartPage = String(raw['cart-page'] || '/cart');
  const ordersPage = String(raw['orders-page'] || '/customer/orders');
  const heading = String(raw.title || 'Your last split order');

  block.textContent = '';
  block.hidden = true;

  let group;
  try {
    group = newestGroup(await loadOrders(), windowMinutes);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Last split order lookup failed', e);
    return; // signed out, or no access: show nothing
  }
  if (!group.length) return;

  const units = group.reduce((a, o) => a + o.items.reduce((s, i) => s + i.qty, 0), 0);
  const total = group.reduce((a, o) => a + o.total, 0);
  const many = group.length > 1;

  const card = el('div', 'lso-card');
  card.append(
    el('p', 'lso-label', many ? 'Split order' : 'Last order'),
    el('h2', 'lso-title', many ? heading : 'Your last order'),
    el('p', 'lso-sub', `${dateFmt.format(new Date(group[group.length - 1].at))} · ${group.length} ${group.length === 1 ? 'location' : 'locations'} · ${num.format(units)} units · ${money.format(total)}`),
  );
  const list = el('ul', 'lso-list');
  group.forEach((o) => {
    const u = o.items.reduce((s, i) => s + i.qty, 0);
    list.append(el('li', '', `${o.place}: ${num.format(u)} units · ${money.format(o.total)} · order ${o.number}`));
  });
  card.append(list);

  const actions = el('div', 'lso-actions');
  const status = el('p', 'lso-status');
  status.setAttribute('role', 'status');
  const go = el('button', 'lso-button', many ? `Reorder all ${group.length}` : 'Reorder');
  go.type = 'button';
  go.addEventListener('click', async () => {
    go.disabled = true;
    status.textContent = 'Building your cart...';
    try {
      await replaceCart(group);
      window.sessionStorage.setItem(PREFILL_KEY, JSON.stringify(prefillFor(group)));
      window.location.assign(cartPage);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Reorder failed', e);
      status.textContent = `Could not rebuild the cart: ${e.message}`;
      go.disabled = false;
    }
  });
  const all = el('a', 'lso-link', 'View all orders');
  all.href = ordersPage;
  actions.append(go, all);
  card.append(actions, status);

  block.append(card);
  block.hidden = false;
}
