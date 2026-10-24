/**
 * Mock wholesale pricing for the demo.
 * The catalog price is treated as the suggested retail price (MSRP).
 * Wholesale price = MSRP x rate. Retailer margin = MSRP - wholesale.
 * Edit DEFAULT_RATE, or add a parent SKU to RATES, to change the numbers.
 */
const DEFAULT_RATE = 0.5; // keystone: wholesale is half of retail
const RATES = {
  // 'cfm': 0.48,
};

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function unitPrice(variant, product) {
  return Number(
    variant?.product?.price?.final?.amount?.value
    ?? product?.priceRange?.minimum?.final?.amount?.value
    ?? product?.price?.final?.amount?.value
    ?? 0,
  ) || 0;
}

export function figures(msrp, product) {
  const rate = RATES[product?.sku] ?? DEFAULT_RATE;
  const wholesale = Math.round(msrp * rate * 100) / 100;
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
  const f = (ctx) => figures(unitPrice(ctx.variant, product), product);
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
  const msrp = unitPrice(null, product);
  if (!msrp) return;
  const x = figures(msrp, product);
  container.replaceChildren(
    stat('Wholesale price', fmt.format(x.wholesale), 'Your contract price'),
    stat('Suggested retail', fmt.format(x.msrp), 'MSRP'),
    stat('Retailer margin', `${x.marginPct.toFixed(0)}%`, `${fmt.format(x.margin)} per unit`),
  );
  container.append(text('Illustrative pricing for the demo.', 'wh-note'));
}
