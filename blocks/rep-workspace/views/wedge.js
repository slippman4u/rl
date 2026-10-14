import { el } from '../lib/dom.js';
import {
  effectiveUnits, formatMoney, fromPrice, loadSheets, STATUSES,
} from '../lib/data.js';
import {
  apportion, formatCount, formatPercent, formatSigned,
} from '../lib/format.js';
import { downloadFile, toCsv } from '../lib/csv.js';
import { removeToast, showToast } from '../lib/overlay.js';
import {
  BAND, STATUS_LABELS, arrowFor, fill, pctOf, round2, signedPct, sumRows, swatchDot, thumbBox,
  toneFor, varianceText,
} from '../lib/wedge-utils.js';
import { closeDrawer, openDrawer } from './product-drawer.js';
import { closeShareModal, openShareModal } from './share-modal.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const THUMB_WIDTH = 480;
const MAX_DOTS = 8;
const SAVED_KEY = 'rep-workspace-wedge-views';
const SYNC_MS = 8000;

const GROUPINGS = [
  { id: 'cluster-tier', label: 'Cluster then tier' },
  { id: 'cluster', label: 'Cluster' },
  { id: 'tier', label: 'Tier' },
  { id: 'status', label: 'Status' },
  { id: 'none', label: 'None' },
];
const COLUMNS = [
  { key: 'style', label: 'Style' },
  { key: 'color', label: 'Color' },
  { key: 'cluster', label: 'Cluster' },
  { key: 'tier', label: 'Tier' },
  { key: 'status', label: 'Status' },
  { key: 'lastYear', label: 'Last year', num: true },
  { key: 'target', label: 'Target', num: true },
  { key: 'planned', label: 'Planned', num: true },
  { key: 'variance', label: 'Variance', num: true },
  { key: 'wholesale', label: 'Wholesale cost', num: true },
  { key: 'retail', label: 'Extended retail', num: true },
];

/** UI state lives at module level so leaving and returning to #/wedge keeps it. */
const ui = {
  view: 'picture',
  filters: {
    cluster: '', tier: '', status: '', colors: new Set(), search: '',
  },
  groupBy: 'cluster-tier',
  collapsed: new Set(),
  openTiles: new Set(),
  sort: { key: '', dir: 'asc' },
  scope: 'plan',
  selected: new Set(), // style ids chosen for bulk actions
  updated: new Set(), // style ids flagged by the plan sync simulation
};

let unsubscribe;
let teardown = [];
let syncTimer;

function svgIcon(paths, extra) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('rw-icon', extra);
  paths.forEach((d) => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  });
  return svg;
}

function loadSaved() {
  try {
    const list = JSON.parse(window.sessionStorage.getItem(SAVED_KEY));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function persistSaved(list) {
  try {
    window.sessionStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch (e) {
    // storage unavailable: the views last for this page view only
  }
}

const slugify = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// --- the wedge ------------------------------------------------------------------------------

export async function render(container, model) {
  const sheets = await loadSheets();
  const original = new Map(sheets.styles.map((s) => [s.sku, s.status]));
  const restoreStatus = (tile) => {
    const was = original.get(tile.parentSku);
    return was && was !== 'drop' ? was : STATUSES[0];
  };

  const tileById = new Map();
  const clusters = [...new Set(model.tiles.map((t) => t.cluster))];
  const tiers = [...new Set(model.tiles.map((t) => t.tier))];
  const colorNames = new Map(); // distinct color name -> swatch
  model.colorRows.forEach((r) => {
    if (!colorNames.has(r.color)) colorNames.set(r.color, r.swatch);
  });
  const colorList = [...colorNames].sort((a, b) => a[0].localeCompare(b[0]));

  // --- filtering ---
  function refreshTiles() {
    tileById.clear();
    model.tiles.forEach((t) => tileById.set(t.id, t));
  }

  function rowMatches(row) {
    const tile = tileById.get(row.tileId);
    const f = ui.filters;
    if (f.cluster && tile.cluster !== f.cluster) return false;
    if (f.tier && tile.tier !== f.tier) return false;
    if (f.status && tile.status !== f.status) return false;
    if (f.colors.size && !f.colors.has(row.color)) return false;
    const q = f.search.trim().toLowerCase();
    if (!q) return true;
    return tile.name.toLowerCase().includes(q)
      || tile.shortName.toLowerCase().includes(q)
      || row.color.toLowerCase().includes(q);
  }

  /** One entry per visible style, holding only the colors that match the filters. */
  function pictureEntries() {
    const rows = model.colorRows.filter(rowMatches);
    return model.tiles
      .map((tile) => ({ tile, rows: rows.filter((r) => r.tileId === tile.id) }))
      .filter((e) => e.rows.length);
  }

  /** One entry per visible style-color row. */
  function dataEntries() {
    return model.colorRows.filter(rowMatches)
      .map((row) => ({ tile: tileById.get(row.tileId), rows: [row] }));
  }

  // --- grouping ---
  function buildTree(entries, keyFns, path) {
    if (!keyFns.length) return null;
    const [keyFn, ...rest] = keyFns;
    const map = new Map();
    entries.forEach((e) => {
      const k = keyFn(e);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    });
    let keys = [...map.keys()];
    if (ui.groupBy === 'status') keys = STATUSES.filter((s) => map.has(s));
    return keys.map((k) => ({
      key: `${ui.groupBy}|${[...path, k].join('|')}`,
      label: ui.groupBy === 'status' ? STATUS_LABELS[k] : k,
      entries: map.get(k),
      children: buildTree(map.get(k), rest, [...path, k]),
    }));
  }

  function groupTree(entries) {
    const fns = {
      'cluster-tier': [(e) => e.tile.cluster, (e) => e.tile.tier],
      cluster: [(e) => e.tile.cluster],
      tier: [(e) => e.tile.tier],
      status: [(e) => e.tile.status],
      none: [],
    }[ui.groupBy];
    return buildTree(entries, fns, []);
  }

  // --- DOM hosts ---
  const bar = el('div', { class: 'rw-wbar' });
  const contentHost = el('div', { class: 'rw-wcontent' });
  const finHost = el('div', { class: 'rw-fin' });
  const bulkHost = el('div', { class: 'rw-bulk', hidden: true });
  const savedHost = el('div', { class: 'rw-savedviews' });
  let bulkMode = ''; // '' | 'note' | 'name'
  let bulkDraft = '';
  let menuOpen = false;
  let saved = loadSaved();
  const root = el(
    'div',
    { class: 'rw-wedge' },
    el('h1', { class: 'rw-sr', text: `Assortment wedge, ${model.account.season}` }),
    bar,
    contentHost,
    el(
      'div',
      { class: 'rw-actions rw-wedge-actions' },
      el('a', { class: 'rw-button rw-button-outline', href: '#/plan', text: 'Back to plan' }),
      el('a', { class: 'rw-button', href: '#/order', text: 'Build the order' }),
    ),
    bulkHost,
    finHost,
  );

  /** Run a repaint without losing the page scroll, the table scroll or keyboard focus. */
  function keep(fn) {
    const y = window.scrollY;
    const focusKey = document.activeElement?.dataset?.fk;
    const table = contentHost.querySelector('.rw-dtable-wrap');
    const inner = table ? [table.scrollTop, table.scrollLeft] : null;
    fn();
    const newTable = contentHost.querySelector('.rw-dtable-wrap');
    if (inner && newTable) {
      [newTable.scrollTop, newTable.scrollLeft] = inner;
    }
    if (focusKey) {
      root.querySelector(`[data-fk="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    }
    window.scrollTo(0, y);
  }

  function openTile(tile) {
    openDrawer({
      model,
      tileId: tile.id,
      restoreFocus: () => {
        root.querySelector(`[data-fk="open|${CSS.escape(tile.id)}"]`)?.focus({ preventScroll: true });
      },
    });
  }

  function toggleSelected(id) {
    if (ui.selected.has(id)) ui.selected.delete(id);
    else ui.selected.add(id);
    keep(paintBody);
  }

  // --- picture wedge ---
  function sizeCurve(units) {
    const parts = apportion(units, model.sizeCurve.map((s) => s.share));
    const max = Math.max(1, ...parts);
    const summary = model.sizeCurve.map((s, i) => `${s.size} ${formatCount(parts[i])}`).join(', ');
    return el(
      'div',
      { class: 'rw-sizes', role: 'img', 'aria-label': `Units by size: ${summary}` },
      model.sizeCurve.map((s, i) => {
        const bar2 = el('span', { class: 'rw-size-bar' });
        bar2.style.setProperty('--h', `${(parts[i] / max) * 100}%`);
        return el(
          'span',
          { class: 'rw-size', title: `${s.size}: ${formatCount(parts[i])} units` },
          el('span', { class: 'rw-size-units', text: formatCount(parts[i]) }),
          bar2,
          el('span', { class: 'rw-size-label', text: s.size }),
        );
      }),
    );
  }

  function tileCard(entry) {
    const { tile, rows } = entry;
    const t = sumRows(rows);
    const dropped = tile.status === 'drop';
    const open = ui.openTiles.has(tile.id);
    const headingId = `rw-tile-${tile.id}`;
    const minRetail = Math.min(...rows.map((r) => r.retail));

    const colorsButton = el('button', {
      class: 'rw-wbtn',
      type: 'button',
      'aria-expanded': String(open),
      'data-fk': `colors|${tile.id}`,
      text: 'Colors',
    });
    colorsButton.addEventListener('click', () => {
      if (ui.openTiles.has(tile.id)) ui.openTiles.delete(tile.id);
      else ui.openTiles.add(tile.id);
      keep(paintBody);
    });

    const dropButton = el('button', {
      class: 'rw-wbtn rw-wbtn-drop',
      type: 'button',
      'data-fk': `drop|${tile.id}`,
      'data-restore': String(dropped),
      'aria-label': `${dropped ? 'Restore' : 'Drop'} ${tile.shortName}`,
      text: dropped ? 'Restore' : 'Drop',
    });
    dropButton.addEventListener('click', () => {
      model.setStatus(tile.id, dropped ? restoreStatus(tile) : 'drop');
    });

    const dots = rows.slice(0, MAX_DOTS).map((r) => swatchDot(r.swatch));
    const noteText = tile.notes.map((n) => n.text).join(' ');

    const openThis = () => openTile(tile);
    const titleButton = el('button', {
      class: 'rw-wtitle-btn',
      type: 'button',
      'aria-haspopup': 'dialog',
      'data-fk': `open|${tile.id}`,
      text: tile.shortName,
    });
    titleButton.addEventListener('click', openThis);
    const imageButton = el(
      'button',
      {
        class: 'rw-wimg-btn', type: 'button', tabindex: '-1', 'aria-label': `Open details for ${tile.shortName}`,
      },
      thumbBox(tile, { width: THUMB_WIDTH, className: 'rw-wthumb' }),
    );
    imageButton.addEventListener('click', openThis);

    const checkbox = el('input', {
      class: 'rw-wcheck-input', type: 'checkbox', 'data-fk': `sel|${tile.id}`, 'aria-label': `Select ${tile.shortName}`,
    });
    checkbox.checked = ui.selected.has(tile.id);
    checkbox.addEventListener('change', () => toggleSelected(tile.id));
    const selectBox = el(
      'label',
      { class: 'rw-wcheck' },
      checkbox,
      el('span', { class: 'rw-wcheck-box', 'aria-hidden': 'true' }),
    );

    return el(
      'article',
      {
        class: 'rw-wtile',
        'data-status': tile.status,
        'data-dim': dropped ? 'true' : null,
        'data-selected': ui.selected.has(tile.id) ? 'true' : null,
        'data-updated': ui.updated.has(tile.id) ? 'true' : null,
        'aria-labelledby': headingId,
      },
      el(
        'div',
        { class: 'rw-wtile-media' },
        imageButton,
        selectBox,
        ui.updated.has(tile.id) ? el('span', { class: 'rw-updated', text: 'Updated' }) : null,
        tile.notes.length
          ? el(
            'span',
            {
              class: 'rw-pin', role: 'img', 'aria-label': `Notes: ${noteText}`, title: noteText,
            },
            svgIcon(['M9 3h6l-1 6 3 3v2h-4v6l-1 1-1-1v-6H7v-2l3-3z'], 'rw-pin-icon'),
            tile.notes.length > 1 ? el('span', { text: String(tile.notes.length) }) : null,
          )
          : null,
      ),
      el(
        'div',
        { class: 'rw-wtile-body' },
        el(
          'div',
          { class: 'rw-wtile-title' },
          el('h4', { id: headingId, title: tile.name }, titleButton),
          el('span', { class: 'rw-pill', 'data-tone': `status-${tile.status}`, text: STATUS_LABELS[tile.status] }),
        ),
        el('div', { class: 'rw-wdots' }, dots, el('span', {
          class: 'rw-wdots-text',
          text: `${rows.length} ${rows.length === 1 ? 'color' : 'colors'}`,
        })),
        el(
          'div',
          { class: 'rw-wplanned' },
          el('strong', { class: 'rw-wplanned-value', text: formatCount(t.units) }),
          el('span', { class: 'rw-wplanned-label', text: 'planned' }),
          el('span', { class: 'rw-wvar', 'data-tone': toneFor(t.pct), text: varianceText(t) }),
        ),
        el(
          'p',
          { class: 'rw-wmeta' },
          el('span', { text: fromPrice({ retail: minRetail }) }),
          el('span', { text: `${tile.doors} doors` }),
        ),
        sizeCurve(t.units),
        el('div', { class: 'rw-wbtns' }, colorsButton, dropButton),
        open ? colorsPanel(tile, rows) : null,
      ),
    );
  }

  function colorsPanel(tile, rows) {
    return el(
      'div',
      { class: 'rw-wcolors-panel' },
      el(
        'ul',
        { class: 'rw-wcolors', 'aria-label': `Colors of ${tile.shortName}` },
        rows.map((r) => el(
          'li',
          {},
          swatchDot(r.swatch),
          el('span', { class: 'rw-wcolor-name', text: r.color }),
          el('span', { class: 'rw-wcolor-units', text: formatCount(effectiveUnits(r)) }),
        )),
      ),
      tile.notes.length
        ? el('ul', { class: 'rw-wnotes', 'aria-label': 'Notes' }, tile.notes.map((n) => el('li', { text: n.text })))
        : null,
    );
  }

  // --- group headers ---
  function groupHeader(node, level) {
    const t = sumRows(node.entries.flatMap((e) => e.rows));
    const collapsed = ui.collapsed.has(node.key);
    const toggle = el('button', {
      class: 'rw-wgroup-toggle',
      type: 'button',
      'aria-expanded': String(!collapsed),
      'data-fk': `grp|${node.key}`,
    }, el('span', { class: 'rw-chevron', 'aria-hidden': 'true' }), el('span', { text: node.label }));
    toggle.addEventListener('click', () => {
      if (ui.collapsed.has(node.key)) ui.collapsed.delete(node.key);
      else ui.collapsed.add(node.key);
      keep(paintBody);
    });
    return el(
      'div',
      { class: 'rw-wgroup-head', 'data-level': String(level) },
      toggle,
      el('span', { class: 'rw-wgroup-count', text: `${node.entries.length} ${ui.view === 'picture' ? 'styles' : 'colors'}` }),
      el('span', { class: 'rw-wgroup-units', text: `${formatCount(t.units)} planned` }),
      el('span', { class: 'rw-wvar', 'data-tone': toneFor(t.pct), text: varianceText(t) }),
    );
  }

  function groupBody(node, level) {
    if (node.children) return pictureGroups(node.children, level + 1);
    return el('div', { class: 'rw-wgrid' }, node.entries.map(tileCard));
  }

  function pictureGroups(nodes, level) {
    return nodes.map((node) => {
      const collapsed = ui.collapsed.has(node.key);
      return el(
        'section',
        { class: 'rw-wgroup', 'data-level': String(level), 'aria-label': node.label },
        groupHeader(node, level),
        collapsed ? null : groupBody(node, level),
      );
    });
  }

  function pictureView() {
    const entries = pictureEntries();
    if (!entries.length) {
      return el('p', { class: 'rw-wempty', text: 'No styles match the current filters.' });
    }
    const tree = groupTree(entries);
    if (!tree) return el('div', { class: 'rw-wgrid' }, entries.map(tileCard));
    return pictureGroups(tree, 0);
  }

  // --- data wedge ---
  function rowFigures(entry) {
    const r = entry.rows[0];
    const units = effectiveUnits(r);
    const variance = units - r.targetUnits;
    return {
      entry,
      row: r,
      style: entry.tile.shortName,
      color: r.color,
      cluster: entry.tile.cluster,
      tier: entry.tile.tier,
      status: entry.tile.status,
      lastYear: r.lastYearUnits,
      target: r.targetUnits,
      planned: units,
      variance,
      pct: pctOf(variance, r.targetUnits),
      wholesale: round2(units * r.wholesale),
      retail: round2(units * r.retail),
    };
  }

  function sorted(entries) {
    const figures = entries.map(rowFigures);
    const { key, dir } = ui.sort;
    if (!key) return figures;
    const sign = dir === 'desc' ? -1 : 1;
    return [...figures].sort((a, b) => {
      const x = a[key];
      const y = b[key];
      if (typeof x === 'number') return (x - y) * sign;
      return String(x).localeCompare(String(y)) * sign;
    });
  }

  function dataRow(f, level) {
    const dropped = f.entry.tile.status === 'drop';
    return el(
      'tr',
      { class: 'rw-drow', 'data-dim': dropped ? 'true' : null, 'data-level': String(level) },
      el('th', { scope: 'row', class: 'rw-dc rw-dstyle' }, el('span', { class: 'rw-dstyle-name', text: f.style }), el('span', { class: 'rw-dstyle-sku', text: f.entry.tile.parentSku })),
      el('td', { class: 'rw-dc' }, el('span', { class: 'rw-dcolor' }, swatchDot(f.row.swatch), el('span', { text: f.color }))),
      el('td', { class: 'rw-dc', text: f.cluster }),
      el('td', { class: 'rw-dc', text: f.tier }),
      el('td', { class: 'rw-dc' }, el('span', { class: 'rw-pill', 'data-tone': `status-${f.status}`, text: STATUS_LABELS[f.status] })),
      el('td', { class: 'rw-dc rw-num', text: formatCount(f.lastYear) }),
      el('td', { class: 'rw-dc rw-num', text: formatCount(f.target) }),
      el('td', { class: 'rw-dc rw-num', text: formatCount(f.planned) }),
      el('td', { class: 'rw-dc rw-num rw-dvar', 'data-tone': toneFor(f.pct), text: `${formatSigned(f.variance)} (${signedPct(f.pct)})` }),
      el('td', { class: 'rw-dc rw-num', text: formatMoney(f.wholesale) }),
      el('td', { class: 'rw-dc rw-num', text: formatMoney(f.retail) }),
    );
  }

  function groupRow(node, level) {
    const t = sumRows(node.entries.flatMap((e) => e.rows));
    const collapsed = ui.collapsed.has(node.key);
    const toggle = el('button', {
      class: 'rw-wgroup-toggle',
      type: 'button',
      'aria-expanded': String(!collapsed),
      'data-fk': `grp|${node.key}`,
    }, el('span', { class: 'rw-chevron', 'aria-hidden': 'true' }), el('span', { text: `${node.label} (${node.entries.length})` }));
    toggle.addEventListener('click', () => {
      if (ui.collapsed.has(node.key)) ui.collapsed.delete(node.key);
      else ui.collapsed.add(node.key);
      keep(paintBody);
    });
    return el(
      'tr',
      { class: 'rw-dgroup', 'data-level': String(level) },
      el('th', { scope: 'rowgroup', colspan: '5', class: 'rw-dc' }, toggle),
      el('td', { class: 'rw-dc rw-num', text: formatCount(t.lastYear) }),
      el('td', { class: 'rw-dc rw-num', text: formatCount(t.target) }),
      el('td', { class: 'rw-dc rw-num', text: formatCount(t.units) }),
      el('td', { class: 'rw-dc rw-num rw-dvar', 'data-tone': toneFor(t.pct), text: `${formatSigned(t.variance)} (${signedPct(t.pct)})` }),
      el('td', { class: 'rw-dc rw-num', text: formatMoney(t.wholesale) }),
      el('td', { class: 'rw-dc rw-num', text: formatMoney(t.retail) }),
    );
  }

  function tableRows(nodes, level) {
    return nodes.flatMap((node) => {
      const head = groupRow(node, level);
      if (ui.collapsed.has(node.key)) return [head];
      if (node.children) return [head, ...tableRows(node.children, level + 1)];
      return [head, ...sorted(node.entries).map((f) => dataRow(f, level + 1))];
    });
  }

  function sortMark(active) {
    if (!active) return '';
    return ui.sort.dir === 'desc' ? '\u25BC' : '\u25B2';
  }

  function sortHeader(col) {
    const active = ui.sort.key === col.key;
    let ariaSort = 'none';
    if (active) ariaSort = ui.sort.dir === 'desc' ? 'descending' : 'ascending';
    const button = el(
      'button',
      {
        class: 'rw-sort', type: 'button', 'data-fk': `sort|${col.key}`, 'data-active': String(active),
      },
      el('span', { text: col.label }),
      el('span', { class: 'rw-sort-mark', 'aria-hidden': 'true', text: sortMark(active) }),
    );
    button.addEventListener('click', () => {
      if (ui.sort.key === col.key && ui.sort.dir === 'asc') ui.sort = { key: col.key, dir: 'desc' };
      else if (ui.sort.key === col.key) ui.sort = { key: '', dir: 'asc' }; // third click clears
      else ui.sort = { key: col.key, dir: 'asc' };
      keep(paintBody);
    });
    return el('th', { scope: 'col', 'aria-sort': ariaSort, class: col.num ? 'rw-dhead rw-num' : 'rw-dhead' }, button);
  }

  function dataView() {
    const entries = dataEntries();
    if (!entries.length) {
      return el('p', { class: 'rw-wempty', text: 'No colors match the current filters.' });
    }
    const tree = groupTree(entries);
    const body = tree ? tableRows(tree, 0) : sorted(entries).map((f) => dataRow(f, 0));
    return el(
      'div',
      { class: 'rw-dtable-wrap' },
      el(
        'table',
        { class: 'rw-dtable' },
        el('caption', { class: 'rw-sr', text: 'Planned assortment by style and color' }),
        el('thead', {}, el('tr', {}, COLUMNS.map(sortHeader))),
        el('tbody', {}, body),
      ),
    );
  }

  // --- financial bar ---
  const previous = {};

  function paintFin() {
    let t;
    if (ui.scope === 'plan') {
      const m = model.totalsFor();
      t = {
        units: m.units,
        wholesale: m.wholesaleCost,
        retail: m.extendedRetail,
        variance: m.varianceUnits,
        pct: m.variancePct,
      };
    } else {
      t = sumRows(model.colorRows.filter(rowMatches));
    }
    const values = {
      units: formatCount(t.units),
      wholesale: formatMoney(t.wholesale),
      retail: formatMoney(t.retail),
      variance: `${arrowFor(t.variance)} ${formatSigned(t.variance)} units (${formatPercent(t.pct, { signed: true, decimals: 1 })})`,
    };
    const before = previous[ui.scope];
    const metric = (key, label, tone) => el(
      'div',
      {
        class: 'rw-fin-metric',
        'data-tone': tone || null,
        'data-changed': before && before[key] !== values[key] ? 'true' : null,
      },
      el('span', { class: 'rw-fin-label', text: label }),
      el('strong', { class: 'rw-fin-value', text: values[key] }),
    );
    previous[ui.scope] = values;

    const scopeButton = (id, label) => {
      const b = el('button', {
        class: 'rw-seg', type: 'button', 'aria-pressed': String(ui.scope === id), 'data-fk': `scope|${id}`, text: label,
      });
      b.addEventListener('click', () => {
        ui.scope = id;
        keep(() => { paintFin(); placeBulk(); });
      });
      return b;
    };
    fill(
      finHost,
      el(
        'div',
        { class: 'rw-seg-group', role: 'group', 'aria-label': 'Totals for' },
        scopeButton('plan', 'Whole plan'),
        scopeButton('filter', 'Current filter'),
      ),
      el(
        'div',
        { class: 'rw-fin-metrics', role: 'status', 'aria-label': 'Plan totals' },
        metric('units', 'Planned units'),
        metric('wholesale', 'Wholesale cost'),
        metric('retail', 'Extended retail'),
        metric('variance', 'Versus target', toneFor(t.pct)),
      ),
    );
  }

  // --- header bar ---
  const countText = el('p', { class: 'rw-wcount', role: 'status', 'aria-live': 'polite' });
  const chipsHost = el('div', { class: 'rw-wchips' });
  const colorPanel = el('div', { class: 'rw-colorpanel', hidden: true });
  const colorButton = el('button', {
    class: 'rw-wfilter-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'rw-colorpanel',
  });
  colorPanel.id = 'rw-colorpanel';

  const viewButtons = [['picture', 'Picture Wedge'], ['data', 'Data Wedge']].map(([id, label]) => {
    const b = el('button', {
      class: 'rw-seg rw-seg-lg', type: 'button', 'data-view': id, text: label,
    });
    b.addEventListener('click', () => {
      ui.view = id;
      keep(() => { paintBar(); paintBody(); });
    });
    return b;
  });

  const groupSelect = el(
    'select',
    { class: 'rw-select', id: 'rw-wgroup', 'aria-label': 'Group by' },
    GROUPINGS.map((g) => el('option', { value: g.id, text: `Group: ${g.label}` })),
  );
  groupSelect.addEventListener('change', () => {
    ui.groupBy = groupSelect.value;
    keep(paintBody);
  });

  const makeSelect = (name, allLabel, values, labelOf) => {
    const s = el(
      'select',
      { class: 'rw-select', 'aria-label': allLabel, 'data-filter': name },
      el('option', { value: '', text: allLabel }),
      values.map((v) => el('option', { value: v, text: labelOf ? labelOf(v) : v })),
    );
    s.addEventListener('change', () => {
      ui.filters[name] = s.value;
      keep(() => { paintBar(); paintBody(); });
    });
    return s;
  };
  const clusterSelect = makeSelect('cluster', 'All clusters', clusters);
  const tierSelect = makeSelect('tier', 'All tiers', tiers);
  const statusSelect = makeSelect('status', 'All statuses', STATUSES, (s) => STATUS_LABELS[s]);

  const search = el('input', {
    class: 'rw-wsearch', type: 'search', placeholder: 'Search styles and colors', 'aria-label': 'Search styles and colors', autocomplete: 'off',
  });
  search.addEventListener('input', () => {
    ui.filters.search = search.value;
    keep(() => { paintChips(); paintCount(); paintBody(); });
  });

  const clearAll = el('button', { class: 'rw-wclear', type: 'button', text: 'Clear all' });
  clearAll.addEventListener('click', () => {
    ui.filters = {
      cluster: '', tier: '', status: '', colors: new Set(), search: '',
    };
    keep(() => { paintBar(); paintBody(); });
  });

  function closeColorPanel(returnFocus) {
    if (colorPanel.hidden) return;
    colorPanel.hidden = true;
    colorButton.setAttribute('aria-expanded', 'false');
    if (returnFocus) colorButton.focus();
  }

  colorButton.addEventListener('click', () => {
    const open = colorPanel.hidden;
    colorPanel.hidden = !open;
    colorButton.setAttribute('aria-expanded', String(open));
    if (open) paintColorPanel();
  });
  const onDocClick = (event) => {
    if (!colorPanel.hidden && !event.target.closest('.rw-colorwrap')) closeColorPanel(false);
    if (menuOpen && !event.target.closest('.rw-menuwrap')) {
      menuOpen = false;
      paintBulk();
    }
  };
  const onDocKey = (event) => {
    if (event.key !== 'Escape') return;
    closeColorPanel(true);
    if (menuOpen) {
      menuOpen = false;
      paintBulk();
      bulkHost.querySelector('[data-fk="bulk|status"]')?.focus();
    }
  };
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onDocKey);
  teardown.push(() => {
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onDocKey);
  });

  function paintColorPanel() {
    fill(
      colorPanel,
      el('div', { class: 'rw-colorpanel-head' }, el('strong', { text: 'Filter by color' })),
      el(
        'ul',
        { class: 'rw-colorlist' },
        colorList.map(([name, swatch]) => {
          const on = ui.filters.colors.has(name);
          const b = el(
            'button',
            {
              class: 'rw-colorbtn', type: 'button', 'aria-pressed': String(on), 'data-fk': `color|${name}`,
            },
            swatchDot(swatch),
            el('span', { text: name }),
          );
          b.addEventListener('click', () => {
            if (ui.filters.colors.has(name)) ui.filters.colors.delete(name);
            else ui.filters.colors.add(name);
            keep(() => { paintColorPanel(); paintChips(); paintCount(); paintBody(); });
          });
          return el('li', {}, b);
        }),
      ),
    );
  }

  function paintChips() {
    const f = ui.filters;
    colorButton.textContent = f.colors.size ? `Color (${f.colors.size})` : 'Color';
    const chips = [];
    const chip = (label, onRemove, swatch) => {
      const b = el(
        'button',
        { class: 'rw-wchip', type: 'button', 'aria-label': `Remove filter ${label}` },
        swatch ? swatchDot(swatch) : null,
        el('span', { text: label }),
        el('span', { class: 'rw-wchip-x', 'aria-hidden': 'true', text: '×' }),
      );
      b.addEventListener('click', () => {
        onRemove();
        keep(() => { paintBar(); paintBody(); });
        search.focus({ preventScroll: true });
      });
      return b;
    };
    if (f.cluster) chips.push(chip(f.cluster, () => { f.cluster = ''; }));
    if (f.tier) chips.push(chip(`Tier: ${f.tier}`, () => { f.tier = ''; }));
    if (f.status) chips.push(chip(STATUS_LABELS[f.status], () => { f.status = ''; }));
    f.colors.forEach((name) => {
      chips.push(chip(name, () => f.colors.delete(name), colorNames.get(name)));
    });
    if (f.search.trim()) chips.push(chip(`Search: ${f.search.trim()}`, () => { f.search = ''; search.value = ''; }));
    fill(chipsHost, chips);
    clearAll.hidden = chips.length === 0;
    return chips.length;
  }

  function paintCount() {
    if (ui.view === 'picture') {
      countText.textContent = `Showing ${pictureEntries().length} of ${model.tiles.length} styles`;
    } else {
      countText.textContent = `Showing ${dataEntries().length} of ${model.colorRows.length} colors`;
    }
  }

  function paintBar() {
    viewButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === ui.view)));
    groupSelect.value = ui.groupBy;
    clusterSelect.value = ui.filters.cluster;
    tierSelect.value = ui.filters.tier;
    statusSelect.value = ui.filters.status;
    search.value = ui.filters.search;
    paintChips();
    paintCount();
    paintSaved();
    if (!colorPanel.hidden) paintColorPanel();
  }

  function paintBody() {
    refreshTiles();
    fill(contentHost, ui.view === 'picture' ? pictureView() : dataView());
    paintCount();
    paintFin();
    paintBulk();
    placeBulk();
  }

  // --- bulk bar, saved views, export, share and plan sync ---
  const selectedTiles = () => model.tiles.filter((t) => ui.selected.has(t.id));

  function placeBulk() {
    bulkHost.style.bottom = `${finHost.offsetHeight}px`;
  }

  function saveView(name) {
    const f = ui.filters;
    const entry = {
      id: String(Date.now()),
      name,
      view: ui.view,
      groupBy: ui.groupBy,
      filters: {
        cluster: f.cluster, tier: f.tier, status: f.status, colors: [...f.colors], search: f.search,
      },
    };
    saved = [...saved.filter((v) => v.name !== name), entry];
    persistSaved(saved);
    paintSaved();
  }

  function applySaved(v) {
    const f = v.filters || {};
    ui.view = v.view === 'data' ? 'data' : 'picture';
    ui.groupBy = GROUPINGS.some((g) => g.id === v.groupBy) ? v.groupBy : GROUPINGS[0].id;
    ui.filters = {
      cluster: f.cluster || '',
      tier: f.tier || '',
      status: f.status || '',
      colors: new Set(f.colors || []),
      search: f.search || '',
    };
    keep(() => { paintBar(); paintBody(); });
  }

  function paintSaved() {
    savedHost.hidden = saved.length === 0;
    fill(
      savedHost,
      el('span', { class: 'rw-saved-label', text: 'Saved views' }),
      saved.map((v) => {
        const apply = el('button', {
          class: 'rw-savedchip-apply', type: 'button', 'data-fk': `view|${v.id}`, text: v.name,
        });
        apply.addEventListener('click', () => applySaved(v));
        const remove = el('button', {
          class: 'rw-savedchip-x', type: 'button', 'aria-label': `Remove saved view ${v.name}`, text: '×',
        });
        remove.addEventListener('click', () => {
          saved = saved.filter((x) => x.id !== v.id);
          persistSaved(saved);
          paintSaved();
          search.focus({ preventScroll: true });
        });
        return el('span', { class: 'rw-savedchip' }, apply, remove);
      }),
    );
  }

  function paintBulk() {
    const tiles = selectedTiles();
    ui.selected = new Set(tiles.map((t) => t.id));
    bulkHost.hidden = tiles.length === 0;
    if (!tiles.length) {
      bulkMode = '';
      bulkDraft = '';
      menuOpen = false;
      fill(bulkHost);
      return;
    }
    const showing = new Set(pictureEntries().map((e) => e.tile.id));
    const hidden = tiles.filter((t) => !showing.has(t.id)).length;

    const button = (text, fk, onClick, extra) => {
      const b = el('button', {
        class: 'rw-bulk-btn', type: 'button', 'data-fk': fk, text, ...extra,
      });
      b.addEventListener('click', onClick);
      return b;
    };

    const statusButton = button('Set status', 'bulk|status', () => {
      menuOpen = !menuOpen;
      paintBulk();
      bulkHost.querySelector(menuOpen ? '.rw-menuitem' : '[data-fk="bulk|status"]')?.focus();
    }, { 'aria-haspopup': 'menu', 'aria-expanded': String(menuOpen) });
    const menu = menuOpen
      ? el('ul', { class: 'rw-menu', role: 'menu', 'aria-label': 'Set status' }, STATUSES.map((status) => {
        const item = el('button', {
          class: 'rw-menuitem', type: 'button', role: 'menuitem', 'data-fk': `bulk|set|${status}`, text: STATUS_LABELS[status],
        });
        item.addEventListener('click', () => {
          menuOpen = false;
          tiles.forEach((t) => model.setStatus(t.id, status));
          bulkHost.querySelector('[data-fk="bulk|status"]')?.focus();
        });
        return el('li', { role: 'none' }, item);
      }))
      : null;

    const openMode = (mode) => () => {
      bulkMode = bulkMode === mode ? '' : mode;
      bulkDraft = '';
      menuOpen = false;
      paintBulk();
      bulkHost.querySelector('.rw-bulk-input')?.focus();
    };

    let form = null;
    if (bulkMode) {
      const isNote = bulkMode === 'note';
      const input = el('input', {
        class: 'rw-bulk-input',
        type: 'text',
        maxlength: isNote ? '300' : '60',
        placeholder: isNote ? 'Note for every selected style' : 'Name this view',
        'aria-label': isNote ? 'Note for the selected styles' : 'Name for the focused view',
        autocomplete: 'off',
      });
      input.value = bulkDraft;
      input.addEventListener('input', () => { bulkDraft = input.value; });
      form = el(
        'form',
        { class: 'rw-bulk-form', novalidate: true },
        input,
        el('button', { class: 'rw-button', type: 'submit', text: isNote ? 'Add to selected' : 'Save view' }),
        button('Cancel', 'bulk|cancel', () => {
          bulkMode = '';
          bulkDraft = '';
          paintBulk();
        }),
      );
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        const mode = bulkMode;
        bulkMode = '';
        bulkDraft = '';
        if (mode === 'note') tiles.forEach((t) => model.addNote(t.id, text));
        else saveView(text);
        paintBulk();
      });
    }

    fill(
      bulkHost,
      el(
        'div',
        { class: 'rw-bulk-main' },
        el('strong', { class: 'rw-bulk-count', role: 'status', text: `${tiles.length} selected${hidden ? ` (${hidden} hidden by filters)` : ''}` }),
        el('div', { class: 'rw-menuwrap' }, statusButton, menu),
        button('Add note', 'bulk|note', openMode('note'), { 'aria-expanded': String(bulkMode === 'note') }),
        button('Save as focused view', 'bulk|save', openMode('name'), { 'aria-expanded': String(bulkMode === 'name') }),
        button('Clear selection', 'bulk|clear', () => {
          ui.selected = new Set();
          keep(paintBody);
        }),
      ),
      form,
    );
  }

  function exportCsv() {
    const header = [
      'Style', 'Color', 'Cluster', 'Tier', 'Status', 'Last year', 'Target', 'Planned',
      'Wholesale cost', 'Extended retail', 'Notes',
    ];
    const rows = model.colorRows.filter(rowMatches).map((r) => {
      const tile = tileById.get(r.tileId);
      const units = effectiveUnits(r);
      return [
        tile.shortName, r.color, tile.cluster, tile.tier, STATUS_LABELS[tile.status],
        r.lastYearUnits, r.targetUnits, units,
        round2(units * r.wholesale), round2(units * r.retail),
        tile.notes.map((n) => n.text).join(' | '),
      ];
    });
    const name = slugify(`${model.account.name} ${model.account.season} assortment`);
    downloadFile(`${name}.csv`, toCsv([header, ...rows]), 'text/csv;charset=utf-8');
  }

  /** Flags the first added style and the first style more than 5% under target. No data changes. */
  function simulateSync() {
    const firstAdd = model.tiles.find((t) => t.status === 'add');
    const firstUnder = model.tiles.find(
      (t) => pctOf(effectiveUnits(t) - t.targetUnits, t.targetUnits) < -BAND,
    );
    const ids = [...new Set([firstAdd, firstUnder].filter(Boolean).map((t) => t.id))];
    ui.updated = new Set(ids);
    showToast(`Anaplan sync: ${ids.length} ${ids.length === 1 ? 'change' : 'changes'} received`, SYNC_MS);
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      ui.updated = new Set();
      keep(paintBody);
    }, SYNC_MS);
    keep(paintBody);
  }

  const exportButton = el('button', { class: 'rw-wtool', type: 'button', text: 'Export to Excel' });
  exportButton.addEventListener('click', exportCsv);
  const shareButton = el('button', { class: 'rw-wtool', type: 'button', text: 'Share presentation link' });
  shareButton.addEventListener('click', () => {
    openShareModal({ model, restoreFocus: () => shareButton.focus({ preventScroll: true }) });
  });
  const syncButton = el('button', { class: 'rw-wtool rw-wtool-quiet', type: 'button', text: 'Simulate plan sync' });
  syncButton.addEventListener('click', simulateSync);

  fill(
    bar,
    el(
      'div',
      { class: 'rw-wbar-row' },
      el('div', { class: 'rw-seg-group', role: 'group', 'aria-label': 'Wedge view' }, viewButtons),
      groupSelect,
      search,
      countText,
    ),
    el(
      'div',
      { class: 'rw-wbar-row rw-wbar-filters' },
      clusterSelect,
      tierSelect,
      statusSelect,
      el('div', { class: 'rw-colorwrap' }, colorButton, colorPanel),
      chipsHost,
      clearAll,
    ),
    el(
      'div',
      { class: 'rw-wbar-row rw-wbar-tools' },
      exportButton,
      shareButton,
      syncButton,
      savedHost,
    ),
  );

  // the filter bar sticks directly under the context bar, whatever height that has
  const placeBar = () => {
    const context = document.querySelector('.rw-context');
    bar.style.top = `${context ? context.offsetHeight : 0}px`;
  };
  window.addEventListener('resize', placeBar);
  teardown.push(() => window.removeEventListener('resize', placeBar));

  container.replaceChildren(root);
  placeBar();
  refreshTiles();
  paintBar();
  paintBody();
  unsubscribe = model.subscribe(() => keep(paintBody));
}

export function destroy() {
  clearTimeout(syncTimer);
  ui.updated = new Set(); // the sync highlight must not come back with the next visit
  removeToast();
  closeDrawer();
  closeShareModal();
  if (unsubscribe) unsubscribe();
  unsubscribe = undefined;
  teardown.forEach((fn) => fn());
  teardown = [];
}
