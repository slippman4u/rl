import { CORE_FETCH_GRAPHQL } from '../../scripts/commerce.js';
import { events } from '@dropins/tools/event-bus.js';
import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';
import * as Cart from '@dropins/storefront-cart/api.js';
import * as orderApi from '@dropins/storefront-order/api.js';

// Same initializers the checkout block loads, so order placement is configured the same way.
import '../../scripts/initializers/order.js';
import '../../scripts/initializers/checkout.js';

/*
 * Step 2: place one REAL order per location.
 *
 * A signed-in customer has one active cart at a time, so the orders are placed one after
 * another. For each location: empty the active cart, add only that location's products,
 * set the ship-to address, a shipping method and a payment method, then place the order the
 * same way the checkout block does (purchase order when the company uses them, else order).
 * Placing an order closes that cart, so the next location starts on a new cart ID.
 *
 * If a location fails, the products for it and for every location after it are put back in
 * the cart, and the error is passed up with the orders that did go through.
 */

// Demo ship-to addresses for the five locations (made up). Edit freely.
export const DOOR_ADDRESSES = {
  D01: {
    street: ['100 Showroom Way'], city: 'Chicago', region: 'IL', postcode: '60601', telephone: '312-555-0101',
  },
  D02: {
    street: ['100 Showroom Way'], city: 'Boston', region: 'MA', postcode: '02116', telephone: '617-555-0102',
  },
  D03: {
    street: ['100 Showroom Way'], city: 'Dallas', region: 'TX', postcode: '75201', telephone: '214-555-0103',
  },
  D04: {
    street: ['100 Showroom Way'], city: 'Atlanta', region: 'GA', postcode: '30305', telephone: '404-555-0104',
  },
  D05: {
    street: ['100 Showroom Way'], city: 'Seattle', region: 'WA', postcode: '98101', telephone: '206-555-0105',
  },
};

async function gql(query, variables) {
  const res = await CORE_FETCH_GRAPHQL.fetchGraphQl(query, { method: 'POST', variables });
  if (res?.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '));
  return res.data;
}

const CART_QUERY = `query {
  customerCart {
    id
    items {
      uid
      quantity
      product { sku }
      ... on ConfigurableCartItem {
        configurable_options { configurable_product_option_value_uid }
      }
    }
  }
}`;

async function readCart() {
  const data = await gql(CART_QUERY);
  const cart = data?.customerCart;
  if (!cart?.id) throw new Error('Could not read the active cart');
  return cart;
}

async function emptyCart(cart) {
  if (!cart.items?.length) return;
  await gql(
    `mutation($input: UpdateCartItemsInput) {
      updateCartItems(input: $input) { cart { id } }
    }`,
    { input: { cart_id: cart.id, cart_items: cart.items.map((i) => ({ cart_item_uid: i.uid, quantity: 0 })) } },
  );
}

async function addItems(cartId, items) {
  const data = await gql(
    `mutation($cartId: String!, $items: [CartItemInput!]!) {
      addProductsToCart(cartId: $cartId, cartItems: $items) {
        cart { id }
        user_errors { code message }
      }
    }`,
    { cartId, items },
  );
  const errors = data?.addProductsToCart?.user_errors || [];
  if (errors.length) throw new Error(errors.map((e) => e.message).join('; '));
}

/** What to add for each product: parent SKU, quantity and the chosen option values. */
function snapshotOf(cart) {
  const byUid = new Map();
  cart.items.forEach((i) => {
    byUid.set(i.uid, {
      sku: i.product.sku,
      selected_options: (i.configurable_options || []).map((o) => o.configurable_product_option_value_uid),
    });
  });
  return byUid;
}

function itemsFor(job, snapshot) {
  return job.lines.map((l) => {
    const base = snapshot.get(l.key);
    if (!base) throw new Error(`Could not match "${l.name}" to a line in the cart`);
    const item = { sku: base.sku, quantity: l.units };
    if (base.selected_options.length) item.selected_options = base.selected_options;
    return item;
  });
}

async function setAddress(cartId, door) {
  const a = DOOR_ADDRESSES[door.id];
  if (!a) throw new Error(`No address for ${door.name}`);
  const data = await gql(
    `mutation($input: SetShippingAddressesOnCartInput) {
      setShippingAddressesOnCart(input: $input) {
        cart {
          shipping_addresses {
            available_shipping_methods { carrier_code method_code available }
          }
        }
      }
    }`,
    {
      input: {
        cart_id: cartId,
        shipping_addresses: [{
          address: {
            firstname: 'Receiving',
            lastname: door.name,
            company: door.name,
            street: a.street,
            city: a.city,
            region: a.region,
            postcode: a.postcode,
            country_code: 'US',
            telephone: a.telephone,
            save_in_address_book: false,
          },
        }],
      },
    },
  );
  await gql(
    `mutation($input: SetBillingAddressOnCartInput) {
      setBillingAddressOnCart(input: $input) { cart { id } }
    }`,
    { input: { cart_id: cartId, billing_address: { same_as_shipping: true } } },
  );
  return data?.setShippingAddressesOnCart?.cart?.shipping_addresses?.[0]?.available_shipping_methods || [];
}

async function setShipping(cartId, methods, wanted) {
  const usable = methods.filter((m) => m.available !== false);
  let pick = usable[0];
  if (wanted) {
    const [carrier, method] = wanted.split('_');
    pick = usable.find((m) => m.carrier_code === carrier && m.method_code === method) || pick;
  }
  if (!pick) throw new Error('No shipping method is available for this address');
  const data = await gql(
    `mutation($input: SetShippingMethodsOnCartInput) {
      setShippingMethodsOnCart(input: $input) {
        cart { available_payment_methods { code title } }
      }
    }`,
    {
      input: {
        cart_id: cartId,
        shipping_methods: [{ carrier_code: pick.carrier_code, method_code: pick.method_code }],
      },
    },
  );
  return data?.setShippingMethodsOnCart?.cart?.available_payment_methods || [];
}

async function setPayment(cartId, methods, wanted) {
  const pick = (wanted && methods.find((m) => m.code === wanted)) || methods[0];
  if (!pick) throw new Error('No payment method is available');
  await gql(
    `mutation($input: SetPaymentMethodOnCartInput) {
      setPaymentMethodOnCart(input: $input) { cart { id } }
    }`,
    { input: { cart_id: cartId, payment_method: { code: pick.code } } },
  );
  return pick;
}

const numberOf = (r) => r?.number ?? r?.orderNumber ?? r?.order_number ?? r?.uid ?? r?.id ?? 'placed';

/** Same rule as the checkout block: a purchase order when the company has them, else an order. */
async function place(cartId) {
  const b2b = getConfigValue('commerce-b2b-enabled');
  const permissions = events.lastPayload('auth/permissions');
  if (b2b && permissions) {
    const { PO_PERMISSIONS, ...poApi } = await import('@dropins/storefront-purchase-order/api.js');
    if (permissions[PO_PERMISSIONS.PO_ALL] !== false) {
      const po = await poApi.placePurchaseOrder(cartId);
      return { kind: 'Purchase order', number: numberOf(po) };
    }
  }
  const order = await orderApi.placeOrder(cartId);
  return { kind: 'Order', number: numberOf(order) };
}

async function putBack(snapshot, jobs) {
  const cart = await readCart();
  await emptyCart(cart);
  const all = jobs.flatMap((j) => itemsFor(j, snapshot));
  if (all.length) await addItems(cart.id, all);
}

/**
 * @param {Object} opts
 * @param {Array} opts.plan locations with their lines, from the accordion
 * @param {Object} opts.config { payment, shipping } optional method codes
 * @param {Function} opts.onStep progress callback
 * @returns {Promise<Array>} one entry per placed order
 */
export async function placeRealOrders({ plan, config = {}, onStep }) {
  const jobs = plan.filter((p) => p.units > 0);
  const first = await readCart();
  const snapshot = snapshotOf(first);
  const done = [];

  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i];
    const say = (note) => onStep({
      index: i, total: jobs.length, door: job.door, state: 'working', note,
    });
    try {
      say('Starting a cart');
      const cart = i === 0 ? first : await readCart();
      say(`Cart ${cart.id.slice(0, 8)}: adding products`);
      await emptyCart(cart);
      await addItems(cart.id, itemsFor(job, snapshot));

      say('Setting the ship-to address');
      const shippingMethods = await setAddress(cart.id, job.door);

      say('Choosing a shipping method');
      const paymentMethods = await setShipping(cart.id, shippingMethods, config.shipping);

      say('Choosing a payment method');
      const payment = await setPayment(cart.id, paymentMethods, config.payment);

      say(`Placing the order (${payment.title || payment.code})`);
      // eslint-disable-next-line no-await-in-loop
      const result = await place(cart.id);
      const order = {
        door: job.door, units: job.units, value: job.value, number: String(result.number), kind: result.kind,
      };
      done.push(order);
      onStep({
        index: i, total: jobs.length, door: job.door, state: 'done', order,
      });
    } catch (error) {
      onStep({
        index: i, total: jobs.length, door: job.door, state: 'failed', note: error.message,
      });
      try {
        await putBack(snapshot, jobs.slice(i));
      } catch (restoreError) {
        error.message += ` (and the cart could not be restored: ${restoreError.message})`;
      }
      error.completed = done;
      error.failedDoor = job.door;
      try { await Cart.refreshCart(); } catch (e) { /* ignore */ }
      throw error;
    }
  }
  try { await Cart.refreshCart(); } catch (e) { /* ignore */ }
  return done;
}
