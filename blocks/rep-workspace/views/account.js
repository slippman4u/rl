import { el } from '../lib/dom.js';
import { formatMoney } from '../lib/data.js';
import {
  formatCount, formatPercent, initialsOf, thumbnailUrl,
} from '../lib/format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const THUMB_WIDTH = 240; // twice the displayed width, for dense screens

let unsubscribe;

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const ratio = (part, whole) => (whole > 0 ? part / whole : 0);

/** Set a CSS custom property from data (no markup involved). */
function setVar(node, name, value) {
  node.style.setProperty(name, String(value));
  return node;
}

function sparkleIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('rw-icon', 'rw-sparkle');
  ['M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z', 'M18 14l.9 2.6L21.5 17.5l-2.6.9L18 21l-.9-2.6-2.6-.9 2.6-.9z']
    .forEach((d) => {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    });
  return svg;
}

// --- 1. header ------------------------------------------------------------------------------

function contactLine(href, text) {
  return el('a', { class: 'rw-acct-link', href, text });
}

function header(model) {
  const a = model.account;
  const used = a.creditLimit - a.creditAvailable;
  const usedShare = clamp(ratio(used, a.creditLimit), 0, 1);
  const { showroomContact: contact } = a;

  const bar = setVar(el('span', { class: 'rw-meter-fill' }), '--w', `${usedShare * 100}%`);
  return el(
    'section',
    { class: 'rw-acct-head', 'aria-labelledby': 'rw-acct-title' },
    el(
      'div',
      { class: 'rw-acct-title' },
      el('p', { class: 'rw-eyebrow', text: 'Account 360' }),
      el('h1', { id: 'rw-acct-title', text: a.name }),
      el(
        'p',
        { class: 'rw-acct-sub' },
        el('span', { text: `Account ${a.number}` }),
        el('span', { class: 'rw-pill', 'data-tone': 'tier', text: `${a.tier} tier` }),
      ),
    ),
    el(
      'div',
      { class: 'rw-acct-contacts' },
      el(
        'div',
        { class: 'rw-acct-contact' },
        el('h2', { text: 'Showroom contact' }),
        el('strong', { text: contact.name }),
        contact.email ? contactLine(`mailto:${contact.email}`, contact.email) : null,
        contact.phone ? contactLine(`tel:${contact.phone.replace(/[^\d+]/g, '')}`, contact.phone) : null,
      ),
      el(
        'div',
        { class: 'rw-acct-contact' },
        el('h2', { text: 'Buyer' }),
        el('strong', { text: a.buyerName }),
        a.preferredDay ? el('span', { class: 'rw-muted', text: `Prefers ${a.preferredDay}s` }) : null,
      ),
    ),
    el(
      'div',
      { class: 'rw-acct-credit' },
      el(
        'div',
        { class: 'rw-acct-credit-head' },
        el('h2', { text: 'Credit utilisation' }),
        el('strong', { text: formatPercent(usedShare * 100) }),
      ),
      el('span', {
        class: 'rw-meter',
        role: 'img',
        'aria-label': `${formatMoney(used)} of ${formatMoney(a.creditLimit)} credit used`,
        'data-high': String(usedShare > 0.85),
      }, bar),
      el('p', {
        class: 'rw-muted rw-acct-credit-note',
        text: `${formatMoney(used)} used · ${formatMoney(a.creditAvailable)} available of ${formatMoney(a.creditLimit)}`,
      }),
    ),
  );
}

// --- 2. KPI row -----------------------------------------------------------------------------

function kpi(label, value, note, extra) {
  return el(
    'li',
    { class: 'rw-kpi' },
    el('span', { class: 'rw-kpi-label', text: label }),
    el('span', { class: 'rw-kpi-row' }, el('strong', { class: 'rw-kpi-value', text: value }), extra || null),
    note ? el('span', { class: 'rw-kpi-note', text: note }) : null,
  );
}

function kpiRow(model) {
  const a = model.account;
  const goldShare = clamp(ratio(a.ytdSpend, a.goldThreshold), 0, 1);
  const ring = setVar(
    el('span', { class: 'rw-ring', 'aria-hidden': 'true' }),
    '--pct',
    goldShare * 100,
  );
  const goldNote = a.goldGap > 0 ? `${formatMoney(a.goldGap)} to Gold` : 'Gold reached';
  return el(
    'ul',
    { class: 'rw-kpis', 'aria-label': 'Account figures' },
    kpi('Year-to-date spend', formatMoney(a.ytdSpend)),
    kpi('Open orders', formatCount(a.openOrders)),
    kpi('Units shipped, Fall 2026', formatCount(a.unitsShipped)),
    kpi('Available credit', formatMoney(a.creditAvailable), `of ${formatMoney(a.creditLimit)}`),
    kpi('Progress to Gold', formatPercent(goldShare * 100), goldNote, ring),
  );
}

// --- 3. clusters ----------------------------------------------------------------------------

function barLine(label, value, share, tone, marker) {
  const fill = setVar(el('span', { class: 'rw-fill', 'data-tone': tone }), '--w', `${share * 100}%`);
  return el(
    'div',
    { class: 'rw-bar-line' },
    el('span', { class: 'rw-bar-label', text: label }),
    el('span', { class: 'rw-track' }, fill, marker || null),
    el('span', { class: 'rw-bar-value', text: formatCount(value) }),
  );
}

function clusterSection(model) {
  const clusters = model.byCluster();
  const scale = Math.max(1, ...clusters.flatMap((c) => [c.lastYearUnits, c.targetUnits, c.units]));
  return el(
    'section',
    { class: 'rw-card', 'aria-labelledby': 'rw-acct-clusters' },
    el('h2', { id: 'rw-acct-clusters', text: 'Last year versus this season’s target' }),
    el(
      'ul',
      { class: 'rw-legend' },
      el('li', {}, el('span', { class: 'rw-key', 'data-tone': 'last' }), 'Last year'),
      el('li', {}, el('span', { class: 'rw-key', 'data-tone': 'target' }), 'Target'),
      el('li', {}, el('span', { class: 'rw-key', 'data-tone': 'planned' }), 'Planned'),
    ),
    el(
      'ul',
      { class: 'rw-clusters' },
      clusters.map((c) => {
        const direction = c.varianceUnits >= 0 ? 'over' : 'under';
        const marker = setVar(
          el('span', { class: 'rw-marker', title: `Planned ${formatCount(c.units)}` }),
          '--at',
          `${(c.units / scale) * 100}%`,
        );
        return el(
          'li',
          { class: 'rw-cluster' },
          el(
            'div',
            { class: 'rw-cluster-head' },
            el('strong', { text: c.key }),
            el('span', {
              class: 'rw-variance',
              'data-direction': direction,
              text: `${formatPercent(c.variancePct, { signed: true })} vs target`,
            }),
          ),
          barLine('Last year', c.lastYearUnits, c.lastYearUnits / scale, 'last'),
          barLine('Target', c.targetUnits, c.targetUnits / scale, 'target', marker),
          el('p', {
            class: 'rw-muted rw-cluster-note',
            text: `Planned ${formatCount(c.units)} units, ${formatCount(Math.abs(c.varianceUnits))} ${direction === 'over' ? 'over' : 'under'} target`,
          }),
        );
      }),
    ),
  );
}

// --- 4. entitlements ------------------------------------------------------------------------

function thumb(tile) {
  const wrap = el('div', { class: 'rw-thumb' });
  const placeholder = () => el('span', {
    class: 'rw-thumb-fallback', 'aria-hidden': 'true', text: initialsOf(tile.shortName),
  });
  if (!tile.imageUrl) {
    wrap.append(placeholder());
    return wrap;
  }
  const img = el('img', {
    src: thumbnailUrl(tile.imageUrl, THUMB_WIDTH), alt: '', loading: 'lazy', width: '120', height: '150',
  });
  img.addEventListener('error', () => {
    // resized rendition failed: try the original once, then give up and show initials
    if (img.getAttribute('src') !== tile.imageUrl) img.src = tile.imageUrl;
    else img.replaceWith(placeholder());
  });
  wrap.append(img);
  return wrap;
}

function styleGroups(model) {
  const groups = new Map();
  model.tiles.forEach((tile) => {
    if (!groups.has(tile.cluster)) groups.set(tile.cluster, []);
    groups.get(tile.cluster).push(tile);
  });
  return el(
    'div',
    { class: 'rw-style-groups' },
    [...groups].map(([cluster, tiles], i) => el(
      'section',
      { class: 'rw-style-group', 'aria-labelledby': `rw-group-${i}` },
      el('h3', { id: `rw-group-${i}`, text: `${cluster} (${tiles.length})` }),
      el(
        'ul',
        { class: 'rw-style-cards' },
        tiles.map((tile) => el(
          'li',
          { class: 'rw-style-card' },
          thumb(tile),
          el('strong', { text: tile.shortName }),
          el('span', { class: 'rw-pill rw-style-pill', text: tile.cluster }),
        )),
      ),
    )),
  );
}

function doorsList(model) {
  return el(
    'section',
    { class: 'rw-doors', 'aria-labelledby': 'rw-acct-doors' },
    el('h3', { id: 'rw-acct-doors', text: `Doors (${model.doors.length})` }),
    el(
      'ul',
      { class: 'rw-door-list' },
      model.doors.map((door) => {
        const carried = model.tiles.filter(
          (t) => model.doorsCarrying(t.id).some((d) => d.id === door.id),
        ).length;
        const fill = setVar(el('span', { class: 'rw-fill', 'data-tone': 'door' }), '--w', `${door.share * 100}%`);
        return el(
          'li',
          { class: 'rw-door' },
          el(
            'div',
            { class: 'rw-door-head' },
            el('span', { class: 'rw-door-name' }, el('strong', { text: door.name }), el('small', { text: door.city })),
            el('span', { class: 'rw-pill', 'data-tone': door.currency === 'USD' ? 'neutral' : 'plan', text: door.currency }),
          ),
          el(
            'div',
            { class: 'rw-bar-line' },
            el('span', { class: 'rw-track' }, fill),
            el('span', { class: 'rw-bar-value', text: formatPercent(door.share * 100) }),
          ),
          carried < model.tiles.length
            ? el('small', { class: 'rw-muted', text: `Carries ${carried} of ${model.tiles.length} styles` })
            : null,
        );
      }),
    ),
  );
}

function entitlements(model) {
  return el(
    'section',
    { class: 'rw-card', 'aria-labelledby': 'rw-acct-entitle' },
    el('h2', { id: 'rw-acct-entitle', text: `Entitlements: ${model.tiles.length} styles` }),
    el('div', { class: 'rw-entitle' }, styleGroups(model), doorsList(model)),
  );
}

// --- 5. insights ----------------------------------------------------------------------------

function insights(model) {
  const clusters = model.byCluster();
  const [under] = clusters.filter((c) => c.varianceUnits < 0)
    .sort((x, y) => x.variancePct - y.variancePct);
  const [over] = clusters.filter((c) => c.varianceUnits > 0)
    .sort((x, y) => y.variancePct - x.variancePct);
  const { goldGap, name } = model.account;

  const items = [];
  if (under) {
    items.push({
      label: `Review in plan: ${under.key}`,
      text: `${under.key} is furthest under target: ${formatCount(-under.varianceUnits)} units short (${formatPercent(under.variancePct)}).`,
    });
  }
  if (over) {
    items.push({
      label: `Review in plan: ${over.key}`,
      text: `${over.key} is furthest over target: ${formatCount(over.varianceUnits)} units over (${formatPercent(over.variancePct, { signed: true })}).`,
    });
  }
  items.push({
    label: 'Review in plan: Gold progress',
    text: goldGap > 0
      ? `${name} is ${formatMoney(goldGap)} from Gold. Gold unlocks priority allocation on core styles and extended payment terms.`
      : `${name} has reached Gold, which brings priority allocation on core styles and extended payment terms.`,
  });

  return el(
    'section',
    { class: 'rw-card rw-insights', 'aria-labelledby': 'rw-acct-insights' },
    el('h2', { id: 'rw-acct-insights' }, sparkleIcon(), ' Account insights'),
    el(
      'ul',
      { class: 'rw-insight-list' },
      items.map((item) => el(
        'li',
        { class: 'rw-insight' },
        el('p', { text: item.text }),
        el('a', {
          class: 'rw-insight-link', href: '#/plan', 'aria-label': item.label, text: 'Review in plan',
        }),
      )),
    ),
  );
}

// --- view -----------------------------------------------------------------------------------

function build(model) {
  return el(
    'div',
    { class: 'rw-acct' },
    header(model),
    kpiRow(model),
    clusterSection(model),
    entitlements(model),
    insights(model),
    el('div', { class: 'rw-actions' }, el('a', { class: 'rw-button', href: '#/plan', text: 'Review account plan' })),
  );
}

export function render(container, model) {
  const paint = () => container.replaceChildren(build(model));
  paint();
  // planned units change when the plan is edited, which moves the cluster bars and insights
  unsubscribe = model.subscribe(paint);
}

export function destroy() {
  if (unsubscribe) unsubscribe();
  unsubscribe = undefined;
}
