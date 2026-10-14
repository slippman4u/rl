import { el } from '../lib/dom.js';
import { effectiveUnits } from '../lib/data.js';
import {
  formatCount, formatCurrency, formatDate, formatPercent,
} from '../lib/format.js';
import {
  DISCOUNTS, createOrderCalc, getState, loadState, persist, sum,
} from '../lib/order-calc.js';
import { fill, swatchDot, thumbBox } from '../lib/wedge-utils.js';

/** View state that is not worth persisting. */
const ui = {
  cart: '',
  door: '',
  openStyles: new Set(),
  openColors: new Set(),
  seeded: false,
  menu: '',
  explain: false,
};

let teardown = [];

export function render(container, model, ctx) {
  loadState();
  ctx.completeStage('present');

  const calc = createOrderCalc(model);
  const saved = getState();
  const {
    sizes, doors, rate, windows, windowById, compute,
  } = calc;
  if (!windows.length) {
    container.replaceChildren(el('p', { class: 'rw-muted', text: 'No delivery windows are set in the terms.' }));
    return;
  }
  if (!windows.some((w) => w.id === ui.cart)) ui.cart = windows[0].id;
  if (!doors.some((d) => d.id === ui.door)) ui.door = '';

  const money = (usd) => calc.money(usd);
  const dateOf = (w) => formatDate(w.date, { month: 'short', day: 'numeric', year: 'numeric' });

  /** Units and wholesale value of one color, restricted to the door filter. */
  function figures({ row, matrix }) {
    const cols = doors.map((d, j) => j).filter((j) => !ui.door || doors[j].id === ui.door);
    const units = sum(cols.map((j) => matrix.reduce((a, r) => a + r[j], 0)));
    return { units, usd: units * row.wholesale };
  }

  const styleFigures = (line) => line.colors.map(figures).reduce(
    (a, f) => ({ units: a.units + f.units, usd: a.usd + f.usd }),
    { units: 0, usd: 0 },
  );

  // --- hosts ---
  const tabsHost = el('div', { class: 'rw-cart-tabs', role: 'tablist', 'aria-label': 'Delivery windows' });
  const doorHost = el('div', { class: 'rw-door-chips', role: 'group', 'aria-label': 'Filter by door' });
  const linesHost = el('div', { class: 'rw-order-lines', role: 'tabpanel' });
  const summaryHost = el('aside', { class: 'rw-osummary', 'aria-label': 'Order summary' });
  const root = el(
    'div',
    { class: 'rw-order' },
    el(
      'div',
      { class: 'rw-order-head' },
      el('p', { class: 'rw-eyebrow', text: 'Present' }),
      el('h1', { text: 'Order builder' }),
      el('p', { class: 'rw-muted', text: `${model.account.name} · ${model.account.season}` }),
    ),
    tabsHost,
    el('div', { class: 'rw-order-grid' }, el('div', { class: 'rw-order-main' }, doorHost, linesHost), summaryHost),
    el(
      'div',
      { class: 'rw-actions rw-order-actions' },
      el('a', { class: 'rw-button rw-button-outline', href: '#/wedge', text: 'Back to assortment' }),
      el('a', { class: 'rw-button', href: '#/commit', text: 'Review and commit' }),
    ),
  );

  /** Repaint without losing the page scroll, matrix scroll or keyboard focus. */
  function keep(fn) {
    const y = window.scrollY;
    const focusKey = document.activeElement?.dataset?.fk;
    const scrolls = new Map([...root.querySelectorAll('.rw-matrix-wrap')]
      .map((w) => [w.dataset.row, w.scrollLeft]));
    fn();
    root.querySelectorAll('.rw-matrix-wrap').forEach((w) => {
      if (scrolls.has(w.dataset.row)) w.scrollLeft = scrolls.get(w.dataset.row);
    });
    if (focusKey) {
      root.querySelector(`[data-fk="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    }
    window.scrollTo(0, y);
  }

  // --- cart tabs ---
  function paintTabs(data) {
    const tabs = windows.map((w) => {
      const cart = data.carts.get(w.id);
      const selected = ui.cart === w.id;
      const tab = el(
        'button',
        {
          class: 'rw-cart-tab',
          type: 'button',
          role: 'tab',
          'aria-selected': String(selected),
          tabindex: selected ? '0' : '-1',
          'data-fk': `tab|${w.id}`,
        },
        el('span', { class: 'rw-cart-name', text: `${w.label} window` }),
        el('small', { class: 'rw-cart-date', text: `Delivers ${dateOf(w)}` }),
        el('strong', { text: `${formatCount(cart.units)} units` }),
        el('span', { class: 'rw-cart-total', text: money(cart.usd) }),
      );
      tab.addEventListener('click', () => {
        ui.cart = w.id;
        ui.menu = '';
        keep(paint);
      });
      return tab;
    });
    tabsHost.onkeydown = (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      const index = windows.findIndex((w) => w.id === ui.cart);
      ui.cart = windows[(index + step + windows.length) % windows.length].id;
      keep(paint);
      tabsHost.querySelector('[aria-selected="true"]')?.focus();
    };
    fill(tabsHost, tabs);
  }

  // --- door chips ---
  function paintDoorChips() {
    const chip = (id, label, currency) => {
      const b = el(
        'button',
        {
          class: 'rw-dchip', type: 'button', 'aria-pressed': String(ui.door === id), 'data-fk': `door|${id}`,
        },
        el('span', { text: label }),
        currency && currency !== 'USD' ? el('span', { class: 'rw-pill', 'data-tone': 'plan', text: currency }) : null,
      );
      b.addEventListener('click', () => {
        ui.door = id;
        keep(paint);
      });
      return b;
    };
    fill(doorHost, chip('', 'All doors'), doors.map((d) => chip(d.id, d.name, d.currency)));
  }

  // --- matrix ---
  function recalcTable(table) {
    const rowTotals = {};
    const colTotals = {};
    let grand = 0;
    table.querySelectorAll('input[data-i]').forEach((input) => {
      const v = Math.max(0, Math.round(Number(input.value) || 0));
      rowTotals[input.dataset.i] = (rowTotals[input.dataset.i] || 0) + v;
      colTotals[input.dataset.j] = (colTotals[input.dataset.j] || 0) + v;
      grand += v;
    });
    table.querySelectorAll('[data-rt]').forEach((n) => { n.textContent = formatCount(rowTotals[n.dataset.rt] || 0); });
    table.querySelectorAll('[data-ct]').forEach((n) => { n.textContent = formatCount(colTotals[n.dataset.ct] || 0); });
    const gt = table.querySelector('[data-gt]');
    if (gt) gt.textContent = formatCount(grand);
  }

  function commitCell(entry, i, j, raw) {
    const { row, matrix } = entry;
    const parsed = Math.round(Number(raw));
    const value = Number.isFinite(parsed) ? Math.max(0, parsed) : matrix[i][j];
    if (value === matrix[i][j]) {
      keep(paint); // put back a blank or out-of-range entry
      return;
    }
    const next = matrix.map((r) => [...r]);
    next[i][j] = value;
    saved.matrices[row.id] = next;
    persist();
    const total = sum(next.map(sum));
    // the plan elsewhere follows; the model repaints this screen when its units change
    if (total !== effectiveUnits(row)) model.setPlannedUnits(row.id, total);
    else keep(paint);
  }

  function matrixTable(entry) {
    const { row, matrix } = entry;
    const cols = doors.map((d, j) => j).filter((j) => !ui.door || doors[j].id === ui.door);
    const head = el(
      'tr',
      {},
      el('th', { scope: 'col', class: 'rw-mcorner', text: 'Size' }),
      cols.map((j) => el(
        'th',
        { scope: 'col', class: 'rw-mdoor' },
        el('span', { text: doors[j].name }),
        doors[j].currency !== 'USD' ? el('span', { class: 'rw-pill rw-mchip', 'data-tone': 'plan', text: doors[j].currency }) : null,
      )),
      el('th', { scope: 'col', class: 'rw-mtot', text: 'Total' }),
    );
    const body = sizes.map((s, i) => el(
      'tr',
      {},
      el('th', { scope: 'row', class: 'rw-msize', text: s.size }),
      cols.map((j) => {
        const input = el('input', {
          class: 'rw-mcell',
          type: 'number',
          inputmode: 'numeric',
          min: '0',
          step: '1',
          'data-i': String(i),
          'data-j': String(j),
          'data-fk': `cell|${row.id}|${i}|${j}`,
          'aria-label': `${row.color}, size ${s.size}, ${doors[j].name}`,
        });
        input.value = String(matrix[i][j]);
        input.addEventListener('input', () => recalcTable(input.closest('table')));
        // wait a tick so a Tab has moved the focus before the screen repaints
        input.addEventListener('change', () => setTimeout(() => commitCell(entry, i, j, input.value), 0));
        return el('td', { class: 'rw-mtd' }, input);
      }),
      el('td', { class: 'rw-mtot', 'data-rt': String(i), text: formatCount(sum(cols.map((j) => matrix[i][j]))) }),
    ));
    const foot = el(
      'tr',
      {},
      el('th', { scope: 'row', class: 'rw-msize', text: 'Total' }),
      cols.map((j) => el('td', { class: 'rw-mtot', 'data-ct': String(j), text: formatCount(matrix.reduce((a, r) => a + r[j], 0)) })),
      el('td', { class: 'rw-mtot rw-mgrand', 'data-gt': '', text: formatCount(sum(cols.map((j) => matrix.reduce((a, r) => a + r[j], 0)))) }),
    );
    const wrap = el(
      'div',
      { class: 'rw-matrix-wrap', 'data-row': row.id },
      el(
        'table',
        { class: 'rw-matrix' },
        el('caption', { class: 'rw-sr', text: `Units by size and door for ${row.color}` }),
        el('thead', {}, head),
        el('tbody', {}, body),
        el('tfoot', {}, foot),
      ),
    );
    return wrap;
  }

  // --- lines ---
  function colorRow(entry) {
    const { row } = entry;
    const open = ui.openColors.has(row.id);
    const f = figures(entry);
    const toggle = el('button', {
      class: 'rw-expand',
      type: 'button',
      'aria-expanded': String(open),
      'aria-label': `${open ? 'Collapse' : 'Expand'} ${row.color}`,
      'data-fk': `co|${row.id}`,
    });
    toggle.addEventListener('click', () => {
      if (ui.openColors.has(row.id)) ui.openColors.delete(row.id);
      else ui.openColors.add(row.id);
      keep(paint);
    });
    return el(
      'li',
      { class: 'rw-ocolor' },
      el(
        'div',
        { class: 'rw-ocolor-row' },
        toggle,
        swatchDot(row.swatch),
        el('span', { class: 'rw-ocolor-name', text: row.color }),
        el('span', { class: 'rw-onum', text: formatCount(f.units) }),
        el('span', { class: 'rw-onum rw-omoney', text: money(f.usd) }),
      ),
      open ? matrixTable(entry) : null,
    );
  }

  function styleCard(line) {
    const { tile } = line;
    const open = ui.openStyles.has(tile.id);
    const f = styleFigures(line);
    const toggle = el('button', {
      class: 'rw-expand',
      type: 'button',
      'aria-expanded': String(open),
      'aria-label': `${open ? 'Collapse' : 'Expand'} ${tile.shortName}`,
      'data-fk': `st|${tile.id}`,
    });
    toggle.addEventListener('click', () => {
      if (ui.openStyles.has(tile.id)) ui.openStyles.delete(tile.id);
      else ui.openStyles.add(tile.id);
      keep(paint);
    });

    const others = windows.filter((w) => w.id !== line.window);
    const menuOpen = ui.menu === tile.id;
    const moveButton = el('button', {
      class: 'rw-omove',
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-expanded': String(menuOpen),
      'aria-label': `Move ${tile.shortName} to another cart`,
      'data-fk': `mv|${tile.id}`,
      text: 'Move',
    });
    moveButton.addEventListener('click', () => {
      ui.menu = menuOpen ? '' : tile.id;
      keep(paint);
      root.querySelector(ui.menu ? '.rw-menuitem' : `[data-fk="mv|${CSS.escape(tile.id)}"]`)?.focus();
    });
    const menu = menuOpen
      ? el('ul', { class: 'rw-menu rw-menu-down', role: 'menu', 'aria-label': `Move ${tile.shortName}` }, others.map((w) => {
        const item = el('button', {
          class: 'rw-menuitem', type: 'button', role: 'menuitem', text: `Move to the ${w.label} window`,
        });
        item.addEventListener('click', () => {
          saved.assign[tile.id] = w.id;
          persist();
          ui.menu = '';
          keep(paint);
          root.querySelector(`[data-fk="tab|${CSS.escape(w.id)}"]`)?.focus();
        });
        return el('li', { role: 'none' }, item);
      }))
      : null;

    return el(
      'li',
      { class: 'rw-ostyle' },
      el(
        'div',
        { class: 'rw-ostyle-row' },
        toggle,
        thumbBox(tile, { width: 120, className: 'rw-ostyle-thumb' }),
        el(
          'span',
          { class: 'rw-ostyle-name' },
          el('strong', { text: tile.shortName }),
          el('small', { class: 'rw-ostyle-sku', text: `${tile.parentSku} · ${line.colors.length} ${line.colors.length === 1 ? 'color' : 'colors'}` }),
        ),
        el('span', { class: 'rw-onum', text: formatCount(f.units) }),
        el('span', { class: 'rw-onum rw-omoney', text: money(f.usd) }),
        el('span', { class: 'rw-pill', 'data-tone': 'plan', text: `${windowById.get(line.window).label} cart` }),
        el('div', { class: 'rw-menuwrap' }, moveButton, menu),
      ),
      open
        ? el('ul', { class: 'rw-ocolors', 'aria-label': `Colors of ${tile.shortName}` }, line.colors.map(colorRow))
        : null,
    );
  }

  function paintLines(data) {
    const mine = data.lines.filter((l) => l.window === ui.cart);
    if (!ui.seeded && data.lines.length) {
      ui.openStyles.add(data.lines[0].tile.id); // only the first style starts open
      ui.seeded = true;
    }
    const doorName = doors.find((d) => d.id === ui.door)?.name;
    const clusters = [...new Set(mine.map((l) => l.tile.cluster))];
    fill(
      linesHost,
      doorName
        ? el('p', { class: 'rw-order-note', role: 'status', text: `Lines show ${doorName} only. The order summary covers every door.` })
        : null,
      mine.length
        ? clusters.map((cluster) => {
          const inCluster = mine.filter((l) => l.tile.cluster === cluster);
          const totals = inCluster.map(styleFigures).reduce(
            (a, f) => ({ units: a.units + f.units, usd: a.usd + f.usd }),
            { units: 0, usd: 0 },
          );
          return el(
            'section',
            { class: 'rw-ocluster', 'aria-label': cluster },
            el(
              'div',
              { class: 'rw-ocluster-head' },
              el('h2', { text: cluster }),
              el('span', { class: 'rw-onum', text: `${formatCount(totals.units)} units` }),
              el('span', { class: 'rw-onum rw-omoney', text: money(totals.usd) }),
            ),
            el('ul', { class: 'rw-ostyles' }, inCluster.map(styleCard)),
          );
        })
        : el('p', { class: 'rw-muted rw-order-empty', text: 'No styles are in this cart.' }),
    );
  }

  // --- summary ---
  function paintSummary(data) {
    const {
      percent, subtotal, discountLines, total, orders,
    } = calc.totals(data);

    const currencyButton = (code) => {
      const b = el('button', {
        class: 'rw-seg', type: 'button', 'aria-pressed': String(saved.currency === code), 'data-fk': `cur|${code}`, text: code,
      });
      b.addEventListener('click', () => {
        saved.currency = code;
        persist();
        keep(paint);
      });
      return b;
    };

    const termRows = DISCOUNTS.map((d) => {
      const box = el('input', {
        class: 'rw-termbox', type: 'checkbox', id: `rw-term-${d.key}`, 'data-fk': `term|${d.key}`,
      });
      box.checked = !!saved.discounts[d.key];
      box.addEventListener('change', () => {
        saved.discounts[d.key] = box.checked;
        persist();
        keep(paint);
      });
      return el('li', {}, el('label', { class: 'rw-toggle', for: box.id }, box, el('span', { text: `${d.label} (${percent(d)}%)` })));
    });

    const orderList = orders.map((o) => el(
      'li',
      { class: 'rw-oorder' },
      el('span', { class: 'rw-oorder-name' }, `${windowById.get(o.window).label} window `, el('span', { class: 'rw-pill', 'data-tone': o.currency === 'USD' ? 'neutral' : 'plan', text: o.currency })),
      el('span', { class: 'rw-oorder-units', text: `${formatCount(o.units)} units` }),
      el(
        'span',
        { class: 'rw-oorder-total' },
        el('strong', { text: money(o.total) }),
        o.currency !== saved.currency ? el('small', { class: 'rw-oorder-native', text: `${formatCurrency(o.native, o.currency)} invoiced` }) : null,
      ),
    ));

    const explainButton = el('button', {
      class: 'rw-wclear', type: 'button', 'aria-expanded': String(ui.explain), 'data-fk': 'explain', text: ui.explain ? 'Hide the orders' : 'Why?',
    });
    explainButton.addEventListener('click', () => {
      ui.explain = !ui.explain;
      keep(paint);
    });

    const { available, over, share } = calc.credit(total);
    const meterFill = el('span', { class: 'rw-meter-fill' });
    meterFill.style.setProperty('--w', `${Math.min(share, 1) * 100}%`);

    fill(
      summaryHost,
      el(
        'div',
        { class: 'rw-osum-head' },
        el('h2', { text: 'Order summary' }),
        el('div', { class: 'rw-seg-group', role: 'group', 'aria-label': 'Display currency' }, currencyButton('USD'), currencyButton('CAD')),
      ),
      saved.currency === 'CAD'
        ? el('p', { class: 'rw-muted rw-osum-rate', text: `Amounts converted at 1 USD = ${rate} CAD` })
        : null,
      el(
        'dl',
        { class: 'rw-osum-lines' },
        el('div', { class: 'rw-osum-row' }, el('dt', { text: `Subtotal at wholesale (${formatCount(data.units)} units)` }), el('dd', { text: money(subtotal) })),
        discountLines.map(({ d, usd }) => el('div', { class: 'rw-osum-row rw-osum-discount' }, el('dt', { text: `${d.label} (${percent(d)}%)` }), el('dd', { text: `−${money(usd)}` }))),
        el('div', { class: 'rw-osum-row rw-osum-total' }, el('dt', { text: 'Order total' }), el('dd', { text: money(total) })),
      ),
      el(
        'div',
        { class: 'rw-osum-credit' },
        el('div', { class: 'rw-osum-creditrow' }, el('span', { text: 'Available credit' }), el('strong', { text: money(available) })),
        el('span', {
          class: 'rw-meter',
          role: 'img',
          'aria-label': `Order total is ${formatPercent(share * 100)} of the available credit`,
          'data-high': String(share > 1),
        }, meterFill),
        el('p', { class: 'rw-muted rw-osum-creditnote', text: `The order total is ${formatPercent(share * 100)} of the available credit` }),
        over > 0
          ? el(
            'div',
            { class: 'rw-osum-warning', role: 'status' },
            el('span', { class: 'rw-pill rw-osum-chip', 'data-tone': 'draft', text: `Exceeds available credit by ${money(over)}` }),
            el('a', { class: 'rw-osum-link', href: '#/commit', text: 'See exceptions' }),
          )
          : el('span', { class: 'rw-pill', 'data-tone': 'committed', text: 'Within available credit' }),
      ),
      el('div', { class: 'rw-osum-terms' }, el('h3', { text: 'Terms' }), el('ul', { class: 'rw-toggles' }, termRows)),
      el(
        'div',
        { class: 'rw-osum-split' },
        el(
          'p',
          { class: 'rw-split-banner', role: 'status' },
          `This order will split into ${data.orders.size} ${data.orders.size === 1 ? 'order' : 'orders'}`,
        ),
        explainButton,
        ui.explain
          ? el(
            'div',
            { class: 'rw-osplit-explain' },
            el('p', { class: 'rw-muted', text: 'One order for each delivery window and currency that has units. Doors invoiced in CAD form their own orders.' }),
            el('ul', { class: 'rw-oorders' }, orderList),
          )
          : null,
      ),
    );
  }

  function paint() {
    const data = compute();
    paintTabs(data);
    paintDoorChips();
    paintLines(data);
    paintSummary(data);
  }

  // the summary sticks just below the context bar, whatever its height
  const placeSummary = () => {
    const context = document.querySelector('.rw-context');
    const top = (context ? context.offsetHeight : 0) + 16;
    summaryHost.style.top = `${top}px`;
    summaryHost.style.maxHeight = `calc(100dvh - ${top + 16}px)`;
  };
  window.addEventListener('resize', placeSummary);
  const onDocClick = (event) => {
    if (ui.menu && !event.target.closest('.rw-menuwrap')) {
      ui.menu = '';
      keep(paint);
    }
  };
  const onDocKey = (event) => {
    if (event.key === 'Escape' && ui.menu) {
      const id = ui.menu;
      ui.menu = '';
      keep(paint);
      root.querySelector(`[data-fk="mv|${CSS.escape(id)}"]`)?.focus();
    }
  };
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onDocKey);
  teardown.push(() => {
    window.removeEventListener('resize', placeSummary);
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onDocKey);
  });

  container.replaceChildren(root);
  placeSummary();
  paint();
  teardown.push(model.subscribe(() => keep(paint)));
}

export function destroy() {
  teardown.forEach((fn) => fn());
  teardown = [];
  ui.menu = '';
}
