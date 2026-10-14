import { el } from '../lib/dom.js';
import { effectiveUnits, formatMoney } from '../lib/data.js';
import {
  formatCount, formatPercent, formatSigned,
} from '../lib/format.js';

const NOTE_KEY = 'rep-workspace-plan-note';
const BAND = 5; // percent either side of target that still counts as on target
const SAVE_DELAY = 400;

const STATUS_LABELS = { carryover: 'Carryover', add: 'Add', drop: 'Drop' };

let unsubscribe;
let saveTimer;
let expanded = new Set(); // row keys that are open; clusters start collapsed

/** over (> +5%), under (< -5%) or on target. */
function toneFor(pct) {
  if (pct > BAND) return 'over';
  if (pct < -BAND) return 'under';
  return 'on';
}

const pctOf = (variance, target) => (target > 0 ? (variance / target) * 100 : 0);

/** The numbers every row shows, from a `totalsFor`-style result. */
function fromTotals(t) {
  return {
    lastYear: t.lastYearUnits,
    target: t.targetUnits,
    planned: t.units,
    variance: t.varianceUnits,
    pct: t.variancePct,
  };
}

function fromColor(color) {
  const planned = effectiveUnits(color);
  return {
    lastYear: color.lastYearUnits,
    target: color.targetUnits,
    planned,
    variance: planned - color.targetUnits,
    pct: pctOf(planned - color.targetUnits, color.targetUnits),
  };
}

// --- 1. title block -------------------------------------------------------------------------

function titleBlock(model) {
  return el(
    'div',
    { class: 'rw-plan-title' },
    el('p', { class: 'rw-eyebrow', text: 'Season, FOB and account' }),
    el('h1', { text: `Account plan: ${model.account.season}` }),
    el(
      'ul',
      { class: 'rw-chips', 'aria-label': 'Plan context' },
      el('li', { class: 'rw-pill rw-pill-lg', 'data-tone': 'neutral', text: 'Polo (FOB)' }),
      el('li', { class: 'rw-pill rw-pill-lg', 'data-tone': 'neutral', text: model.account.name }),
      el('li', { class: 'rw-pill rw-pill-lg', 'data-tone': 'neutral', text: 'Plan source: Anaplan, synced this morning' }),
      el('li', { class: 'rw-pill rw-pill-lg', 'data-tone': 'precommit', text: 'Pre-commit' }),
    ),
  );
}

// --- 2. summary strip -----------------------------------------------------------------------

function summaryCard(label, value, note, tone) {
  return el(
    'li',
    { class: 'rw-kpi', 'data-tone': tone || null },
    el('span', { class: 'rw-kpi-label', text: label }),
    el('strong', { class: 'rw-kpi-value', text: value }),
    note ? el('span', { class: 'rw-kpi-note', text: note }) : null,
  );
}

function summaryStrip(model) {
  const t = model.totalsFor();
  const tone = toneFor(t.variancePct);
  let arrow = '▶';
  if (t.varianceUnits > 0) arrow = '▲';
  else if (t.varianceUnits < 0) arrow = '▼';
  return el(
    'ul',
    { class: 'rw-kpis rw-plan-summary', 'aria-label': 'Plan totals' },
    summaryCard('Planned units', formatCount(t.units), `Target ${formatCount(t.targetUnits)}`),
    summaryCard('Wholesale cost', formatMoney(t.wholesaleCost)),
    summaryCard('Extended retail', formatMoney(t.extendedRetail)),
    el(
      'li',
      { class: 'rw-kpi', 'data-tone': tone },
      el('span', { class: 'rw-kpi-label', text: 'Units versus target' }),
      el(
        'strong',
        { class: 'rw-kpi-value' },
        el('span', { class: 'rw-arrow', 'aria-hidden': 'true', text: arrow }),
        ` ${formatSigned(t.varianceUnits)}`,
      ),
      el('span', { class: 'rw-kpi-note', text: `${formatPercent(t.variancePct, { signed: true, decimals: 1 })} against target` }),
    ),
  );
}

// --- attention strip ------------------------------------------------------------------------

function attention(model) {
  const over = model.byCluster().filter((c) => toneFor(c.variancePct) === 'over');
  if (!over.length) return null;
  return el(
    'div',
    { class: 'rw-attention', role: 'status' },
    el('strong', { text: 'Over plan: ' }),
    over.map((c, i) => el('span', {
      text: `${i ? '; ' : ''}${c.key} is planned ${formatPercent(c.variancePct)} over target (${formatSigned(c.varianceUnits)} units)`,
    })),
    '. See the callouts below.',
  );
}

// --- 3. structure table ---------------------------------------------------------------------

function expandButton(key, label, open, onToggle) {
  const button = el('button', {
    class: 'rw-expand',
    type: 'button',
    'aria-expanded': String(open),
    'aria-label': `${open ? 'Collapse' : 'Expand'} ${label}`,
    'data-key': key,
  });
  button.addEventListener('click', () => onToggle(key));
  return button;
}

function swatchDot(color) {
  const dot = el('span', { class: 'rw-dot', 'aria-hidden': 'true' });
  dot.style.setProperty('background', color);
  return dot;
}

function varianceBar(pct) {
  const tone = toneFor(pct);
  const half = Math.min(Math.abs(pct), 50) / 50; // each side of the axis spans 50%
  const fill = el('span', { class: 'rw-vfill', 'data-side': pct < 0 ? 'neg' : 'pos' });
  fill.style.setProperty('--w', `${half * 100}%`);
  return el(
    'span',
    { class: 'rw-vbar-cell', 'data-tone': tone },
    el('span', { class: 'rw-vbar', 'aria-hidden': 'true' }, fill),
    el('span', { class: 'rw-vpct', text: formatPercent(pct, { signed: true }) }),
  );
}

/**
 * @param {Object} spec key, level (0-3), label, sub, swatch, figures, doors, status,
 *   expandable, open, dim, flag
 */
function planRow(spec, onToggle) {
  const f = spec.figures;
  const nameChildren = [
    spec.expandable
      ? expandButton(spec.key, spec.label, spec.open, onToggle)
      : el('span', { class: 'rw-expand-gap', 'aria-hidden': 'true' }),
    spec.swatch ? swatchDot(spec.swatch) : null,
    el(
      'span',
      { class: 'rw-row-label' },
      el('strong', { text: spec.label }),
      spec.sub ? el('small', { text: spec.sub }) : null,
    ),
    spec.flag ? el('span', { class: 'rw-pill', 'data-tone': 'draft', text: 'Over plan' }) : null,
  ];
  const nameCell = el('th', { scope: 'row', class: 'rw-cell-name' }, el('div', { class: 'rw-name-inner' }, nameChildren));
  return el(
    'tr',
    {
      class: 'rw-plan-row',
      'data-level': String(spec.level),
      'data-dim': spec.dim ? 'true' : null,
      'data-flag': spec.flag ? 'true' : null,
    },
    nameCell,
    el('td', { class: 'rw-num', text: formatCount(f.lastYear) }),
    el('td', { class: 'rw-num', text: formatCount(f.target) }),
    el('td', { class: 'rw-num', text: formatCount(f.planned) }),
    el('td', { class: 'rw-num', 'data-tone': toneFor(f.pct), text: formatSigned(f.variance) }),
    el('td', { class: 'rw-cell-bar' }, varianceBar(f.pct)),
    el('td', { class: 'rw-num', text: spec.doors === undefined ? '' : String(spec.doors) }),
    el('td', {}, spec.status ? el('span', { class: 'rw-pill', 'data-tone': `status-${spec.status}`, text: STATUS_LABELS[spec.status] || spec.status }) : null),
  );
}

function tableRows(model, onToggle) {
  const rows = [];
  model.byCluster().forEach((cluster) => {
    const clusterKey = `c|${cluster.key}`;
    const clusterOpen = expanded.has(clusterKey);
    rows.push(planRow({
      key: clusterKey,
      level: 0,
      label: cluster.key,
      figures: fromTotals(cluster),
      expandable: true,
      open: clusterOpen,
      flag: toneFor(cluster.variancePct) === 'over',
    }, onToggle));
    if (!clusterOpen) return;

    model.byTier((t) => t.cluster === cluster.key).forEach((tier) => {
      const tierKey = `t|${cluster.key}|${tier.key}`;
      const tierOpen = expanded.has(tierKey);
      rows.push(planRow({
        key: tierKey,
        level: 1,
        label: tier.key,
        figures: fromTotals(tier),
        expandable: true,
        open: tierOpen,
      }, onToggle));
      if (!tierOpen) return;

      const inTier = (t) => t.cluster === cluster.key && t.tier === tier.key;
      model.tiles.filter(inTier).forEach((tile) => {
        const styleKey = `s|${tile.id}`;
        const styleOpen = expanded.has(styleKey);
        const dropped = tile.status === 'drop';
        rows.push(planRow({
          key: styleKey,
          level: 2,
          label: tile.shortName,
          sub: tile.parentSku,
          figures: fromTotals(model.totalsFor((t) => t.id === tile.id)),
          doors: tile.doors,
          status: tile.status,
          expandable: true,
          open: styleOpen,
          dim: dropped,
        }, onToggle));
        if (!styleOpen) return;

        tile.colors.forEach((color) => {
          rows.push(planRow({
            key: `k|${color.id}`,
            level: 3,
            label: color.color,
            swatch: color.swatch,
            figures: fromColor(color),
            expandable: false,
            dim: dropped,
          }, onToggle));
        });
      });
    });
  });
  return rows;
}

function structureTable(model, onToggle) {
  const heading = (text, cls) => el('th', { scope: 'col', class: cls || null, text });
  return el(
    'div',
    { class: 'rw-table-wrap' },
    el(
      'table',
      { class: 'rw-plan-table' },
      el('caption', { class: 'rw-sr', text: 'Plan structure by cluster, tier, style and color' }),
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          heading('Plan level', 'rw-cell-name'),
          heading('Last year', 'rw-num'),
          heading('Target', 'rw-num'),
          heading('Planned', 'rw-num'),
          heading('Variance', 'rw-num'),
          heading('Variance vs target', 'rw-cell-bar'),
          heading('Doors', 'rw-num'),
          heading('Status'),
        ),
      ),
      el('tbody', {}, tableRows(model, onToggle)),
    ),
  );
}

// --- 4. cluster callouts --------------------------------------------------------------------

/** Per-style numbers inside a cluster, from the model (dropped styles count zero). */
function styleFigures(model, cluster) {
  return model.tiles.filter((t) => t.cluster === cluster).map((tile) => {
    const planned = effectiveUnits(tile);
    return {
      tile,
      planned,
      shortfall: tile.targetUnits - planned,
      pct: pctOf(planned - tile.targetUnits, tile.targetUnits),
    };
  });
}

function calloutFor(model, cluster) {
  const tone = toneFor(cluster.variancePct);
  const signedPct = formatPercent(cluster.variancePct, { signed: true });
  const styles = styleFigures(model, cluster.key);

  if (tone === 'over') {
    const [worst] = styles
      .filter((s) => s.tile.status !== 'drop' && s.planned > 0)
      .sort((a, b) => b.pct - a.pct);
    if (worst) {
      const after = pctOf(cluster.units - worst.planned - cluster.targetUnits, cluster.targetUnits);
      return {
        tone,
        title: `${cluster.key}: over plan`,
        text: `${cluster.key} is planned ${signedPct} against target (${formatSigned(cluster.varianceUnits)} units). `
          + `${worst.tile.shortName} is the furthest over at ${formatPercent(worst.pct, { signed: true })}. `
          + `Consider dropping or reducing it: dropping it removes ${formatCount(worst.planned)} units and brings ${cluster.key} from ${signedPct} to ${formatPercent(after, { signed: true })}.`,
      };
    }
  }
  if (tone === 'under') {
    const [short] = [...styles].sort((a, b) => b.shortfall - a.shortfall);
    if (short && short.shortfall > 0) {
      return {
        tone,
        title: `${cluster.key}: under plan`,
        text: `${cluster.key} is planned ${signedPct} against target (${formatSigned(cluster.varianceUnits)} units). `
          + `${short.tile.shortName} has the largest shortfall, ${formatCount(short.shortfall)} units under its target. Consider adding units there.`,
      };
    }
  }
  return {
    tone: 'on',
    title: `${cluster.key}: on target`,
    text: `${cluster.key} is on target at ${signedPct} (${formatSigned(cluster.varianceUnits)} units).`,
  };
}

function callouts(model) {
  return el(
    'section',
    { 'aria-labelledby': 'rw-plan-callouts' },
    el('h2', { id: 'rw-plan-callouts', class: 'rw-section-title', text: 'Cluster callouts' }),
    el(
      'ul',
      { class: 'rw-callouts' },
      model.byCluster().map((cluster) => {
        const c = calloutFor(model, cluster);
        return el(
          'li',
          { class: 'rw-callout', 'data-tone': c.tone },
          el('h3', { text: c.title }),
          el('p', { text: c.text }),
          el('a', {
            class: 'rw-callout-link',
            href: '#/wedge',
            'aria-label': `Open in assortment: ${cluster.key}`,
            text: 'Open in assortment',
          }),
        );
      }),
    ),
  );
}

// --- 5. notes -------------------------------------------------------------------------------

function readNote() {
  try {
    return window.sessionStorage.getItem(NOTE_KEY) || '';
  } catch (e) {
    return '';
  }
}

function notesSection() {
  const area = el('textarea', {
    id: 'rw-plan-note', rows: '4', maxlength: '2000', placeholder: 'Anything to settle before the visit',
  });
  area.value = readNote();
  const saved = el('span', { class: 'rw-saved', role: 'status', 'aria-live': 'polite' });

  area.addEventListener('input', () => {
    saved.textContent = '';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        window.sessionStorage.setItem(NOTE_KEY, area.value);
        saved.textContent = 'Saved';
      } catch (e) {
        saved.textContent = 'Not saved: storage is unavailable';
      }
    }, SAVE_DELAY);
  });

  return el(
    'section',
    { class: 'rw-card', 'aria-labelledby': 'rw-plan-notes' },
    el(
      'div',
      { class: 'rw-notes-head' },
      el('h2', { id: 'rw-plan-notes', text: 'Pre-commit notes' }),
      saved,
    ),
    el('label', { class: 'rw-sr', for: 'rw-plan-note', text: 'Pre-commit notes' }),
    area,
  );
}

// --- view -----------------------------------------------------------------------------------

export function render(container, model) {
  expanded = new Set(); // every visit starts with the clusters collapsed

  const summaryHost = el('div', { class: 'rw-host' });
  const tableHost = el('div', { class: 'rw-host' });
  const calloutHost = el('div', { class: 'rw-host' });

  function paintTable() {
    const focusKey = document.activeElement?.dataset?.key;
    tableHost.replaceChildren(structureTable(model, toggle));
    if (focusKey) tableHost.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
  }

  function toggle(key) {
    if (expanded.has(key)) {
      expanded.delete(key);
      // closing a row also closes everything beneath it
      const prefix = key.startsWith('c|') ? `t|${key.slice(2)}|` : null;
      [...expanded]
        .filter((k) => prefix && k.startsWith(prefix))
        .forEach((k) => expanded.delete(k));
    } else {
      expanded.add(key);
    }
    paintTable();
  }

  function paint() {
    summaryHost.replaceChildren(summaryStrip(model), attention(model) || '');
    paintTable();
    calloutHost.replaceChildren(callouts(model));
  }

  container.replaceChildren(el(
    'div',
    { class: 'rw-plan' },
    titleBlock(model),
    summaryHost,
    el(
      'section',
      { 'aria-labelledby': 'rw-plan-structure' },
      el('h2', { id: 'rw-plan-structure', class: 'rw-section-title', text: 'Plan structure' }),
      tableHost,
    ),
    calloutHost,
    notesSection(),
    el(
      'div',
      { class: 'rw-plan-footer' },
      el('a', { class: 'rw-button', href: '#/appointment', text: 'Book the visit' }),
      el('a', { class: 'rw-button rw-button-outline', href: '#/wedge', text: 'Skip to assortment' }),
    ),
  ));
  paint();
  // the plan can change under us (status, units); the note textarea is not repainted
  unsubscribe = model.subscribe(paint);
}

export function destroy() {
  if (unsubscribe) unsubscribe();
  unsubscribe = undefined;
  clearTimeout(saveTimer);
}
