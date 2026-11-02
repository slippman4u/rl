/**
 * Wholesale pricing for the demo.
 *
 * Retail (MSRP) is the standard catalog price, before the customer's discount.
 * Wholesale is the price the customer actually pays, the discounted price Commerce returns.
 * Margin = retail - wholesale.
 *
 * If a product has no discount (standard price equals the price the customer pays), there is
 * nothing to compare, so wholesale is mocked as a share of retail: edit DEFAULT_RATE, or add a
 * parent SKU to RATES, to change that fallback.
 */
const DEFAULT_RATE = 0.5; // fallback only: wholesale is half of retail
const RATES = {
  // 'cfm': 0.48,
};

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const first = (...values) => {
  const hit = values.find((v) => v !== undefined && v !== null && v !== '' && Number(v) > 0);
  return hit === undefined ? 0 : Number(hit);
};

/** What the customer pays (final) and the standard price (regular), for a variant or a product. */
function prices(variant, product) {
  const pick = (kind) => first(
    variant?.product?.price?.[kind]?.amount?.value,
    product?.priceRange?.minimum?.[kind]?.amount?.value,
    product?.prices?.[kind]?.minimumAmount?.value,
    product?.prices?.[kind]?.amount?.value,
    product?.price?.[kind]?.amount?.value,
  );
  const final = pick('final');
  return { final, regular: pick('regular') || final };
}

export function figures(price, product) {
  const { final, regular } = price;
  const discounted = regular > final && final > 0;
  const msrp = discounted ? regular : final;
  const rate = RATES[product?.sku] ?? DEFAULT_RATE;
  const wholesale = discounted ? final : Math.round(msrp * rate * 100) / 100;
  const margin = Math.round((msrp - wholesale) * 100) / 100;
  return {
    msrp, wholesale, margin, marginPct: msrp ? (margin / msrp) * 100 : 0,
  };
}

function text(value, cls) {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = value;
  return s;
}

/** Extra grid cells. Spread into the `slots` of the QuickOrderVariantsGrid. */
export function wholesaleSlots(product) {
  const f = (ctx) => figures(prices(ctx.variant, product), product);
  return {
    WholesaleCell: (ctx) => ctx.appendChild(text(fmt.format(f(ctx).wholesale), 'wh-price')),
    MsrpCell: (ctx) => ctx.appendChild(text(fmt.format(f(ctx).msrp), 'wh-msrp')),
    MarginCell: (ctx) => {
      const x = f(ctx);
      ctx.appendChild(text(`${x.marginPct.toFixed(0)}%`, 'wh-margin'));
    },
    WholesaleTotalCell: (ctx) => {
      const unit = f(ctx).wholesale;
      const total = text(fmt.format(unit * (Number(ctx.quantity) || 0)), 'wh-total');
      if (typeof ctx.onChange === 'function') {
        ctx.onChange((next) => {
          total.textContent = fmt.format(unit * (Number(next?.quantity) || 0));
        });
      }
      ctx.appendChild(total);
    },
  };
}

function stat(label, value, sub) {
  const box = document.createElement('div');
  box.className = 'wh-stat';
  box.append(text(label, 'wh-stat-label'), text(value, 'wh-stat-value'), text(sub, 'wh-stat-sub'));
  return box;
}

/** Summary strip shown above the grid. */
export function renderWholesaleStrip(container, product) {
  if (!container || !product) return;
  const price = prices(null, product);
  if (!price.final) return;
  const x = figures(price, product);
  container.replaceChildren(
    stat('Wholesale price', fmt.format(x.wholesale), 'Your contract price'),
    stat('Suggested retail', fmt.format(x.msrp), 'MSRP'),
    stat('Retailer margin', `${x.marginPct.toFixed(0)}%`, `${fmt.format(x.margin)} per unit`),
  );
  container.append(text('Illustrative pricing for the demo.', 'wh-note'));
}
