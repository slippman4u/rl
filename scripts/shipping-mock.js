/*
 * Demo shipping estimates for cart and checkout lines (Story 2, step 3 and 5).
 * All figures are mock data. Edit PROFILES below to change what the demo shows.
 * Dates are calculated from today, so they never look stale.
 */

const DC = 'Greensboro, NC DC';
const CARRIER = 'UPS Ground';

/*
 * One profile per product family, matched on the product name (first match wins).
 * ats:       units available to sell (shown to the buyer as a band, not an exact number)
 * handling:  business days from order to ship
 * transit:   business days in transit
 * restock:   business days until more stock arrives (used for the part above ats)
 * alt:       an available alternative to suggest when the line is short
 */
const PROFILES = [
  {
    match: /polo|shirt|tee|knit|sweater/i, family: 'Tops', ats: 4820, handling: 2, transit: 3, restock: 15,
  },
  {
    match: /chino|pant|short|jean|trouser/i, family: 'Bottoms', ats: 960, handling: 2, transit: 3, restock: 20,
  },
  {
    match: /jacket|vest|coat|parka/i, family: 'Outerwear', ats: 120, handling: 3, transit: 4, restock: 25,
    alt: 'Quilted Vest in Navy is available now',
  },
  {
    match: /cap|hat|belt|sock|wallet|card case|scarf|tie/i, family: 'Accessories', ats: 0, handling: 2, transit: 3, restock: 28,
    alt: 'Leather Belt in Brown is available now',
  },
];

const FALLBACK = {
  family: 'Other', ats: 2000, handling: 2, transit: 3, restock: 15,
};

const fmtDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const num = new Intl.NumberFormat('en-US');

/** Add business days (skips Saturday and Sunday). */
export function addBusinessDays(from, days) {
  const d = new Date(from.getTime());
  let left = Math.max(0, Math.floor(days));
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return d;
}

function band(units) {
  if (units <= 0) return 'Out of stock';
  if (units < 250) return `Low stock: ${num.format(units)} available`;
  if (units < 1000) return 'In stock: 250+ available';
  return 'In stock: 1,000+ available';
}

/** Pure function: returns the shipments for one cart line. Exported for tests. */
export function estimateFor(item, today = new Date()) {
  const name = String(item?.name || '');
  const qty = Math.max(0, Number(item?.quantity) || 0);
  const profile = PROFILES.find((p) => p.match.test(name)) || FALLBACK;

  const now = Math.min(qty, profile.ats);
  const later = qty - now;
  const shipments = [];

  if (now > 0) {
    const ships = addBusinessDays(today, profile.handling);
    shipments.push({
      units: now,
      status: 'ready',
      ships,
      arrivesFrom: addBusinessDays(ships, profile.transit),
      arrivesTo: addBusinessDays(ships, profile.transit + 2),
    });
  }
  if (later > 0) {
    const ships = addBusinessDays(today, profile.restock + profile.handling);
    shipments.push({
      units: later,
      status: 'backorder',
      ships,
      arrivesFrom: addBusinessDays(ships, profile.transit),
      arrivesTo: addBusinessDays(ships, profile.transit + 2),
    });
  }

  let state = 'ok';
  if (later > 0) state = now > 0 ? 'partial' : 'backorder';
  return {
    family: profile.family,
    state,
    availability: band(profile.ats),
    carrier: CARRIER,
    from: DC,
    alt: later > 0 ? profile.alt || '' : '',
    shipments,
  };
}

const range = (a, b) => (a.getMonth() === b.getMonth()
  ? `${fmtDate.format(a)} to ${b.getDate()}`
  : `${fmtDate.format(a)} to ${fmtDate.format(b)}`);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Adds the estimate under a cart or checkout line. container is any element. */
export function renderShippingEstimate(container, item) {
  if (!container || !item) return;
  const e = estimateFor(item);
  const box = el('div', `ship-est ship-est-${e.state}`);

  const head = el('p', 'ship-est-head');
  head.append(el('span', 'ship-est-dot'));
  const headline = {
    ok: 'Ships complete',
    partial: `Splits into ${e.shipments.length} shipments`,
    backorder: 'Backordered',
  }[e.state];
  head.append(el('strong', '', headline), el('span', 'ship-est-avail', ` · ${e.availability}`));
  box.append(head);

  const list = el('ul', 'ship-est-list');
  e.shipments.forEach((s, i) => {
    const li = el('li');
    const label = e.shipments.length > 1 ? `Shipment ${i + 1}: ` : '';
    li.append(
      el('span', 'ship-est-units', `${label}${num.format(s.units)} units`),
      el('span', '', ` ${s.status === 'backorder' ? 'ships' : 'ship'} ${fmtDate.format(s.ships)}, arrive ${range(s.arrivesFrom, s.arrivesTo)}`),
    );
    list.append(li);
  });
  box.append(list);

  box.append(el('p', 'ship-est-meta', `From ${e.from} via ${e.carrier}`));
  if (e.alt) box.append(el('p', 'ship-est-alt', `Alternative: ${e.alt}`));
  box.append(el('p', 'ship-est-note', 'Estimate only. Final dates are confirmed on order acceptance.'));
  container.append(box);
}
