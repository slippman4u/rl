import { el } from '../lib/dom.js';
import { effectiveUnits } from '../lib/data.js';
import {
  apportion, formatCount, formatCurrency, formatDate, formatPercent,
} from '../lib/format.js';
import {
  createOrderCalc, getState, loadState, persist, sum,
} from '../lib/order-calc.js';
import {
  readCommitted, readResolution, writeCommitted, writeResolution,
} from '../lib/commit-state.js';
import { fill, pctOf, round2 } from '../lib/wedge-utils.js';

const CLUSTER_LIMIT = 15; // percent over target that needs a decision
const MIN_REASON = 10;
const LIST_OPEN_BY_DEFAULT = 6;

const STATE_LABEL = {
  pass: 'Pass', exception: 'Exception', resolved: 'Resolved', acknowledged: 'Acknowledged',
};
const STATE_TONE = {
  pass: 'committed', exception: 'draft', resolved: 'amber', acknowledged: 'plan',
};

let teardown = [];
const ackOpen = new Set(); // items whose "acknowledge" form is open
const ackDraft = {}; // item id -> text typed so far
const listOpen = new Set(); // detail lists the rep opened or closed by hand
const listClosed = new Set();
const lastState = {}; // item id -> state at the previous paint (drives the flip animation)

const usd = (n) => formatCurrency(round2(n), 'USD');
const plural = (n, one, many) => (n === 1 ? one : many);

// --- minimum per color ------------------------------------------------------------------------

/**
 * For every style with a color under the minimum, take units from that style's largest colors
 * (largest first, never below the minimum) and give them to the short ones, so the style's total
 * stays the same. If the style's total cannot cover the minimum across all of its colors, every
 * color goes to the minimum and the shortfall is added.
 * @returns {Array<{tile, changes, moved, added}>} one entry per style that needs work
 */
function planRebalance(lines, minimum) {
  return lines.map((line) => {
    const colors = line.colors.map(({ row }) => ({ row, from: effectiveUnits(row) }));
    if (!colors.some((c) => c.from < minimum)) return null;
    const total = sum(colors.map((c) => c.from));
    const targets = new Map(colors.map((c) => [c.row.id, c.from]));
    const covered = total >= colors.length * minimum;
    const added = covered ? 0 : colors.length * minimum - total;

    if (covered) {
      let need = sum(colors.filter((c) => c.from < minimum).map((c) => minimum - c.from));
      colors.filter((c) => c.from > minimum).sort((a, b) => b.from - a.from).forEach((donor) => {
        const give = Math.min(donor.from - minimum, need);
        if (give > 0) {
          targets.set(donor.row.id, donor.from - give);
          need -= give;
        }
      });
    } else {
      colors.filter((c) => c.from > minimum).forEach((c) => targets.set(c.row.id, minimum));
    }
    colors.filter((c) => c.from < minimum).forEach((c) => targets.set(c.row.id, minimum));

    const changes = colors
      .filter((c) => targets.get(c.row.id) !== c.from)
      .map((c) => ({ row: c.row, from: c.from, to: targets.get(c.row.id) }));
    const moved = sum(changes.filter((c) => c.to > c.from).map((c) => c.to - c.from)) - added;
    return {
      tile: line.tile, changes, moved, added,
    };
  }).filter(Boolean);
}

/** The sentence that records what a rebalance did. */
function rebalanceNote(plans) {
  const within = plans.filter((p) => !p.added && p.moved > 0);
  const short = plans.filter((p) => p.added > 0);
  const names = (list) => list.map((p) => p.tile.shortName).join(', ');
  const parts = [];
  if (within.length) {
    parts.push(`Moved ${formatCount(sum(within.map((p) => p.moved)))} units between colors in ${names(within)}; style ${plural(within.length, 'total', 'totals')} unchanged.`);
  }
  if (short.length) {
    const moved = sum(short.map((p) => p.moved));
    parts.push(`Added ${formatCount(sum(short.map((p) => p.added)))} units in ${names(short)}${moved ? ` (after moving ${formatCount(moved)} units between colors)` : ''}, because the style total could not cover the minimum across all of its colors.`);
  }
  return parts.join(' ');
}

// --- signature pad ----------------------------------------------------------------------------

/** A canvas signature pad: pointer events (mouse, pen, touch), device-pixel-ratio aware. */
function createPad(onChange) {
  const canvas = el('canvas', {
    class: 'rw-pad',
    role: 'img',
    'aria-label': 'Signature pad. Sign with a mouse, a pen or a finger.',
  });
  const g = canvas.getContext('2d');
  const strokes = [];
  let active = null;
  let size = { w: 0, h: 0 };

  function paintStroke(points) {
    if (points.length === 1) {
      g.beginPath();
      g.arc(points[0].x, points[0].y, 1.4, 0, Math.PI * 2);
      g.fill();
      return;
    }
    g.beginPath();
    g.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((p) => g.lineTo(p.x, p.y));
    g.stroke();
  }

  function redraw() {
    const ink = getComputedStyle(canvas).getPropertyValue('--rw-navy').trim() || 'rgb(0 0 0)';
    g.clearRect(0, 0, size.w, size.h);
    g.lineWidth = 2.4;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = ink;
    g.fillStyle = ink;
    strokes.forEach(paintStroke);
  }

  /** Match the bitmap to the CSS size and the screen's pixel ratio, then redraw the strokes. */
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    size = { w: rect.width, h: rect.height };
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    redraw();
  }

  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    active = [point(event)];
    strokes.push(active);
    redraw();
    onChange();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!active) return;
    event.preventDefault();
    active.push(point(event));
    redraw();
  });
  const finish = () => {
    if (!active) return;
    active = null;
    onChange();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  return {
    canvas,
    count: () => strokes.length,
    clear() {
      strokes.length = 0;
      active = null;
      redraw();
      onChange();
    },
    image: () => canvas.toDataURL('image/png'),
    destroy: () => observer.disconnect(),
  };
}

// --- view -------------------------------------------------------------------------------------

export function render(container, model, ctx) {
  loadState();
  const calc = createOrderCalc(model);
  const saved = getState();
  const resolution = readResolution();
  const { doors } = calc;
  const entitled = new Map(model.tiles.map((t) => [
    t.id, new Set(model.doorsCarrying(t.id).map((d) => d.id)),
  ]));

  const saveResolution = () => writeResolution(resolution);

  /** Re-run every check against the model and the saved order. */
  function evaluate() {
    const data = calc.compute();
    const t = calc.totals(data);
    const credit = calc.credit(t.total);
    const minimum = Number(model.term('minimum-units-per-color')) || 0;
    const items = [];

    // a. credit
    const keep = 1 - t.pct / 100;
    const windowTotals = calc.windows.map((w) => ({
      w, total: round2(data.carts.get(w.id).usd * keep),
    }));
    items.push({
      id: 'credit',
      title: 'Credit',
      ok: !credit.exceeds,
      summary: credit.exceeds
        ? `The order total of ${usd(t.total)} exceeds the available credit of ${usd(credit.available)} by ${usd(credit.over)}.`
        : `The order total of ${usd(t.total)} is within the available credit of ${usd(credit.available)}.`,
      details: {
        label: 'Order total by delivery window, and the available credit',
        countless: true,
        rows: [
          ...windowTotals.map(({ w, total }) => `${w.label} window: ${usd(total)}`),
          `Available credit: ${usd(credit.available)}`,
        ],
      },
      note: 'Splitting the order into more orders does not change the total, so it cannot clear this exception.',
      actions: [{
        key: 'request',
        label: 'Request credit approval',
        run() {
          resolution.creditRequested = true;
          saveResolution();
        },
      }],
    });

    // b. door entitlement
    const issues = new Map();
    data.lines.forEach((line) => line.colors.forEach(({ matrix }) => doors.forEach((door, j) => {
      if (entitled.get(line.tile.id).has(door.id)) return;
      const units = matrix.reduce((a, r) => a + r[j], 0);
      if (!units) return;
      const key = `${line.tile.id}|${door.id}`;
      const found = issues.get(key) || { tile: line.tile, door, units: 0 };
      found.units += units;
      issues.set(key, found);
    })));
    const issueList = [...issues.values()];
    const affected = sum(issueList.map((i) => i.units));
    items.push({
      id: 'doors',
      title: 'Door entitlement',
      ok: !issueList.length,
      summary: issueList.length
        ? `${formatCount(affected)} ${plural(affected, 'unit is', 'units are')} on doors that are not entitled to the style.`
        : 'Every line is on a door that is entitled to the style.',
      details: {
        label: 'Lines on doors without entitlement',
        rows: issueList.map((i) => `${i.tile.shortName} on ${i.door.name}: ${formatCount(i.units)} units`),
      },
      actions: [{
        key: 'reallocate',
        label: 'Reallocate to entitled doors',
        run() {
          let moved = 0;
          const from = new Set();
          data.lines.forEach((line) => {
            const ok = entitled.get(line.tile.id);
            const goodCols = doors.map((d, j) => j).filter((j) => ok.has(doors[j].id));
            const badCols = doors.map((d, j) => j).filter((j) => !ok.has(doors[j].id));
            if (!goodCols.length) return;
            line.colors.forEach(({ row, matrix }) => {
              const next = matrix.map((r) => [...r]);
              let changed = false;
              next.forEach((cells) => {
                const units = sum(badCols.map((j) => cells[j]));
                if (!units) return;
                const shares = goodCols.map((j) => doors[j].share);
                const parts = apportion(units, shares.map((s) => s / sum(shares)));
                badCols.forEach((j) => {
                  if (cells[j]) from.add(doors[j].name);
                  cells[j] = 0;
                });
                goodCols.forEach((j, k) => { cells[j] += parts[k]; });
                moved += units;
                changed = true;
              });
              if (changed) saved.matrices[row.id] = next; // the color's total is unchanged
            });
          });
          persist();
          resolution.done.doors = `Moved ${formatCount(moved)} units from ${[...from].join(', ')} to the entitled doors, by their shares.`;
          saveResolution();
        },
      }],
    });

    // c. minimum per color
    const failing = [];
    data.lines.forEach((line) => line.colors.forEach(({ row }) => {
      const units = effectiveUnits(row);
      if (units < minimum) failing.push({ tile: line.tile, row, units });
    }));
    const plans = planRebalance(data.lines, minimum);
    const movedTotal = sum(plans.map((p) => p.moved));
    const addedTotal = sum(plans.map((p) => p.added));
    const addedStyles = plans.filter((p) => p.added > 0).map((p) => p.tile.shortName);
    let effect = `Rebalancing moves ${formatCount(movedTotal)} units between colors within their styles`;
    effect += addedTotal
      ? ` and adds ${formatCount(addedTotal)} units in ${addedStyles.join(', ')}, whose total cannot cover the minimum.`
      : ' and adds none.';
    items.push({
      id: 'minimum',
      title: 'Minimum per color',
      ok: !failing.length,
      summary: failing.length
        ? `${formatCount(failing.length)} ${plural(failing.length, 'color is', 'colors are')} below the minimum of ${formatCount(minimum)} units per color. ${effect}`
        : `Every color has at least ${formatCount(minimum)} units.`,
      details: {
        label: 'Colors below the minimum',
        rows: failing.map((f) => `${f.tile.shortName}, ${f.row.color}: ${formatCount(f.units)} units`),
      },
      actions: [{
        key: 'rebalance',
        label: 'Rebalance colors to minimum',
        hint: 'Each style keeps its total unless it cannot cover the minimum.',
        run() {
          plans.forEach((p) => p.changes.forEach((c) => model.setPlannedUnits(c.row.id, c.to)));
          resolution.done.minimum = rebalanceNote(plans);
          saveResolution();
        },
      }],
    });

    // d. cluster versus target
    const over = model.byCluster().filter((c) => c.variancePct > CLUSTER_LIMIT).map((c) => {
      const [worst] = data.lines
        .filter((l) => l.tile.cluster === c.key)
        .map((l) => ({
          tile: l.tile,
          pct: pctOf(effectiveUnits(l.tile) - l.tile.targetUnits, l.tile.targetUnits),
          units: effectiveUnits(l.tile),
        }))
        .sort((a, b) => b.pct - a.pct);
      return { cluster: c, worst };
    });
    items.push({
      id: 'clusters',
      title: 'Cluster versus target',
      ok: !over.length,
      summary: over.length
        ? `${over.map((o) => o.cluster.key).join(' and ')} ${plural(over.length, 'is', 'are')} more than ${CLUSTER_LIMIT}% over target.`
        : `No cluster is more than ${CLUSTER_LIMIT}% over target.`,
      details: {
        label: 'Clusters over target',
        rows: over.map((o) => `${o.cluster.key}: ${formatPercent(o.cluster.variancePct, { signed: true })} over target (${formatCount(o.cluster.varianceUnits)} units)${o.worst ? `. Highest style: ${o.worst.tile.shortName}, ${formatPercent(o.worst.pct, { signed: true })}` : ''}`),
      },
      actions: over.filter((o) => o.worst).map((o) => ({
        key: `drop-${o.worst.tile.id}`,
        label: `Drop ${o.worst.tile.shortName}`,
        hint: `Removes ${formatCount(o.worst.units)} planned units from ${o.cluster.key}.`,
        run() {
          model.setStatus(o.worst.tile.id, 'drop');
          resolution.done.clusters = `Dropped ${o.worst.tile.shortName} from ${o.cluster.key}.`;
          saveResolution();
        },
      })),
    });

    // e. delivery windows
    const unassigned = data.lines.filter((l) => !calc.windowById.has(l.window));
    items.push({
      id: 'windows',
      title: 'Delivery windows',
      ok: !unassigned.length,
      summary: unassigned.length
        ? `${unassigned.length} ${plural(unassigned.length, 'style has', 'styles have')} no delivery window.`
        : 'Every line sits in a cart with a delivery window.',
      details: { label: 'Styles without a window', rows: unassigned.map((l) => l.tile.shortName) },
      actions: [],
    });

    items.forEach((item) => {
      if (item.ok) item.state = 'pass';
      else if (item.id === 'credit' && resolution.creditRequested) item.state = 'resolved';
      else if (resolution.acks[item.id]) item.state = 'acknowledged';
      else item.state = 'exception';
      if (!item.ok) delete resolution.done[item.id]; // a note describes a fix that has held
    });
    return {
      data, t, credit, items,
    };
  }

  // --- hosts ---
  const recapHost = el('ul', { class: 'rw-recap', 'aria-label': 'Order recap' });
  const itemsHost = el('ul', { class: 'rw-vlist', 'aria-label': 'Validations' });
  const barHost = el('div', { class: 'rw-commit-bar' });
  const sigSummary = el('dl', { class: 'rw-sig-summary' });
  const nameInput = el('input', {
    class: 'rw-sig-name', id: 'rw-sig-name', type: 'text', autocomplete: 'off', maxlength: '80',
  });
  const submit = el('button', {
    class: 'rw-button', type: 'button', text: 'Submit order', disabled: true,
  });
  const padHint = el('p', { class: 'rw-muted rw-pad-hint', text: 'Sign in the box above.' });
  const pad = createPad(() => syncSubmit());
  const clearPad = el('button', { class: 'rw-button rw-button-outline', type: 'button', text: 'Clear' });
  clearPad.addEventListener('click', () => pad.clear());

  function syncSubmit() {
    const ready = pad.count() > 0 && nameInput.value.trim().length > 0;
    submit.disabled = !ready;
    padHint.textContent = pad.count() ? 'Signature captured.' : 'Sign in the box above.';
  }
  nameInput.addEventListener('input', syncSubmit);

  const sigPanel = el(
    'section',
    { class: 'rw-card rw-sig', 'aria-labelledby': 'rw-sig-title', hidden: true },
    el('p', { class: 'rw-eyebrow', text: 'Buyer acceptance' }),
    el('h2', { id: 'rw-sig-title', text: 'Accept and sign' }),
    sigSummary,
    el('p', { class: 'rw-sig-terms', text: `By signing, ${model.account.buyerName} accepts this order for ${model.account.name}.` }),
    el('div', { class: 'rw-pad-wrap' }, pad.canvas),
    el('div', { class: 'rw-pad-row' }, padHint, clearPad),
    el('label', { class: 'rw-sig-label', for: 'rw-sig-name', text: 'Type your full name' }),
    nameInput,
    el('div', { class: 'rw-actions' }, submit),
  );

  const committed = readCommitted();
  const root = el(
    'div',
    { class: 'rw-commit' },
    el(
      'div',
      { class: 'rw-order-head' },
      el('p', { class: 'rw-eyebrow', text: 'Commit' }),
      el('h1', { text: 'Review and commit' }),
      el('p', { class: 'rw-muted', text: `${model.account.name} · ${model.account.season}` }),
    ),
    committed
      ? el(
        'p',
        { class: 'rw-order-note' },
        'An order was already committed in this session. ',
        el('a', { href: '#/confirmation', text: 'View the confirmation' }),
      )
      : null,
    recapHost,
    el('section', { 'aria-labelledby': 'rw-checks-title' }, el('h2', { id: 'rw-checks-title', class: 'rw-section-title', text: 'Validations' }), itemsHost),
    sigPanel,
    barHost,
  );

  /** Repaint without losing the page scroll or keyboard focus. */
  function keepView(fn) {
    const y = window.scrollY;
    const focusKey = document.activeElement?.dataset?.fk;
    fn();
    if (focusKey) {
      root.querySelector(`[data-fk="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    }
    window.scrollTo(0, y);
  }

  // --- painting ---
  function actionButton(item, action) {
    const b = el('button', {
      class: 'rw-button',
      type: 'button',
      'data-fk': `act|${item.id}|${action.key}`,
      text: action.label,
    });
    b.addEventListener('click', () => {
      action.run();
      keepView(paint);
    });
    return el('div', { class: 'rw-vaction' }, b, action.hint ? el('small', { class: 'rw-vhint', text: action.hint }) : null);
  }

  function detailsBlock(item) {
    const { label, rows } = item.details;
    if (!rows.length) return null;
    const open = listOpen.has(item.id)
      || (rows.length <= LIST_OPEN_BY_DEFAULT && !listClosed.has(item.id));
    const block = el(
      'details',
      { class: 'rw-vdetails', open: open || null },
      el('summary', {
        class: 'rw-vtoggle',
        'data-fk': `list|${item.id}`,
        text: item.details.countless ? label : `${label} (${rows.length})`,
      }),
      el('ul', {}, rows.map((r) => el('li', { text: r }))),
    );
    block.addEventListener('toggle', () => {
      if (block.open) {
        listOpen.add(item.id);
        listClosed.delete(item.id);
      } else {
        listOpen.delete(item.id);
        listClosed.add(item.id);
      }
    });
    return block;
  }

  function ackForm(item) {
    const open = ackOpen.has(item.id);
    const toggle = el('button', {
      class: 'rw-button rw-button-outline',
      type: 'button',
      'aria-expanded': String(open),
      'data-fk': `ack|${item.id}`,
      text: 'Acknowledge instead',
    });
    toggle.addEventListener('click', () => {
      if (open) ackOpen.delete(item.id);
      else ackOpen.add(item.id);
      keepView(paint);
      if (!open) root.querySelector(`#rw-ack-${item.id}`)?.focus();
    });
    if (!open) return toggle;

    const input = el('input', {
      class: 'rw-ack-input',
      id: `rw-ack-${item.id}`,
      type: 'text',
      maxlength: '200',
      autocomplete: 'off',
      'aria-describedby': `rw-ack-hint-${item.id}`,
    });
    input.value = ackDraft[item.id] || '';
    const hint = el('small', { id: `rw-ack-hint-${item.id}`, class: 'rw-muted' });
    const confirm = el('button', { class: 'rw-button', type: 'button', text: 'Acknowledge' });
    const sync = () => {
      const { length } = input.value.trim();
      confirm.disabled = length < MIN_REASON;
      hint.textContent = length < MIN_REASON
        ? `Give a reason of at least ${MIN_REASON} characters (${length} so far).`
        : 'Thanks. This will be kept with the order.';
    };
    input.addEventListener('input', () => {
      ackDraft[item.id] = input.value;
      sync();
    });
    sync();
    confirm.addEventListener('click', () => {
      const reason = input.value.trim();
      if (reason.length < MIN_REASON) return;
      resolution.acks[item.id] = reason;
      saveResolution();
      ackOpen.delete(item.id);
      delete ackDraft[item.id];
      keepView(paint);
    });
    return el(
      'div',
      { class: 'rw-ack' },
      toggle,
      el('label', { class: 'rw-sig-label', for: input.id, text: 'Reason for acknowledging' }),
      el('div', { class: 'rw-ack-row' }, input, confirm),
      hint,
    );
  }

  function itemCard(item) {
    const flipped = lastState[item.id] && lastState[item.id] !== item.state;
    lastState[item.id] = item.state;

    let body;
    if (item.state === 'pass') {
      body = [
        el('p', { class: 'rw-vsummary', text: item.summary }),
        resolution.done[item.id]
          ? el('p', { class: 'rw-vdone', text: `Resolved: ${resolution.done[item.id]}` })
          : null,
      ];
    } else if (item.state === 'resolved') {
      const withdraw = el('button', {
        class: 'rw-button rw-button-outline', type: 'button', 'data-fk': 'act|credit|withdraw', text: 'Withdraw the request',
      });
      withdraw.addEventListener('click', () => {
        resolution.creditRequested = false;
        saveResolution();
        keepView(paint);
      });
      body = [
        el('p', { class: 'rw-vsummary', text: item.summary }),
        el('p', { class: 'rw-vdone', text: 'Resolved: credit approval requested. This stays amber until the credit is approved.' }),
        detailsBlock(item),
        withdraw,
      ];
    } else if (item.state === 'acknowledged') {
      const remove = el('button', {
        class: 'rw-button rw-button-outline', type: 'button', 'data-fk': `unack|${item.id}`, text: 'Remove acknowledgement',
      });
      remove.addEventListener('click', () => {
        delete resolution.acks[item.id];
        saveResolution();
        keepView(paint);
      });
      body = [
        el('p', { class: 'rw-vsummary', text: item.summary }),
        el('p', { class: 'rw-vdone', text: `Acknowledged: ${resolution.acks[item.id]}` }),
        detailsBlock(item),
        remove,
      ];
    } else {
      body = [
        el('p', { class: 'rw-vsummary', text: item.summary }),
        item.note ? el('p', { class: 'rw-muted rw-vnote', text: item.note }) : null,
        detailsBlock(item),
        el('div', { class: 'rw-vactions' }, item.actions.map((a) => actionButton(item, a)), ackForm(item)),
      ];
    }

    return el(
      'li',
      {
        class: 'rw-vitem',
        'data-state': item.state,
        'data-flip': flipped ? 'true' : null,
      },
      el(
        'div',
        { class: 'rw-vhead' },
        el('span', { class: 'rw-vmark', 'aria-hidden': 'true', text: item.state === 'pass' ? '✓' : '!' }),
        el('h3', { text: item.title }),
        el('span', { class: 'rw-pill', 'data-tone': STATE_TONE[item.state], text: STATE_LABEL[item.state] }),
      ),
      body,
    );
  }

  function paint() {
    const {
      data, t, credit, items,
    } = evaluate();
    const outstanding = items.filter((i) => i.state === 'exception').length;

    const recap = (label, value, tone) => el(
      'li',
      { class: 'rw-recap-item', 'data-tone': tone || null },
      el('span', { class: 'rw-recap-label', text: label }),
      el('strong', { class: 'rw-recap-value', text: value }),
    );
    let creditText = 'Within available credit';
    let creditTone = 'on';
    if (credit.exceeds) {
      const requested = resolution.creditRequested;
      creditText = requested
        ? `Exceeds by ${usd(credit.over)}, approval requested`
        : `Exceeds by ${usd(credit.over)}`;
      creditTone = requested ? 'amber' : 'over';
    }
    fill(
      recapHost,
      recap('Units', formatCount(data.units)),
      recap('Order total', usd(t.total)),
      recap('Orders', formatCount(t.orders.length)),
      recap('Credit', creditText, creditTone),
    );
    fill(itemsHost, items.map(itemCard));

    // the buyer's acceptance appears once nothing is outstanding
    sigPanel.hidden = outstanding > 0;
    const usedWindows = calc.windows.filter((w) => data.carts.get(w.id).units > 0);
    const row = (term, value) => el('div', {}, el('dt', { text: term }), el('dd', { text: value }));
    fill(
      sigSummary,
      row('Units', formatCount(data.units)),
      row('Order total', `${calc.money(t.total, 'USD')} (${calc.money(t.total, 'CAD')})`),
      row('Delivery windows', usedWindows.map((w) => `${w.label}, ${formatDate(w.date, { month: 'short', day: 'numeric', year: 'numeric' })}`).join(' and ')),
      row('Orders', formatCount(t.orders.length)),
    );

    const commit = el('button', {
      class: 'rw-button',
      type: 'button',
      disabled: outstanding > 0 || null,
      'data-fk': 'commit',
      text: 'Commit order',
    });
    commit.addEventListener('click', () => {
      sigPanel.scrollIntoView({ block: 'center' });
      nameInput.focus({ preventScroll: true });
    });
    fill(
      barHost,
      el('a', { class: 'rw-button rw-button-outline', href: '#/order', text: 'Back to the order' }),
      commit,
      el('p', {
        class: 'rw-commit-line',
        role: 'status',
        text: outstanding
          ? `${outstanding} of ${items.length} ${plural(outstanding, 'item is', 'items are')} outstanding. Resolve or acknowledge each one to commit.`
          : 'Every item is a pass, resolved or acknowledged. Sign above to commit.',
      }),
    );
    syncSubmit();
    return { data, t };
  }

  submit.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name || pad.count() === 0) return;
    const { data, t } = evaluate();
    writeCommitted({
      at: new Date().toISOString(),
      name,
      signature: pad.image(),
      totals: {
        units: data.units,
        subtotalUsd: t.subtotal,
        totalUsd: t.total,
        totalCad: calc.convert(t.total, 'CAD'),
        discounts: t.discountLines.map((x) => ({
          label: x.d.label, pct: t.percent(x.d), usd: x.usd,
        })),
      },
      orders: t.orders.map((o) => ({
        window: o.window,
        windowLabel: calc.windowById.get(o.window).label,
        windowDate: calc.windowById.get(o.window).date,
        currency: o.currency,
        units: o.units,
        usd: o.total,
        native: o.native,
      })),
      creditRequested: resolution.creditRequested,
      handled: Object.entries(resolution.acks).map(([id, reason]) => ({
        id, state: 'acknowledged', reason,
      })),
    });
    ctx.navigate('#/confirmation');
  });

  container.replaceChildren(root);
  paint();
  teardown.push(model.subscribe(() => keepView(paint)));
  teardown.push(() => pad.destroy());
}

export function destroy() {
  teardown.forEach((fn) => fn());
  teardown = [];
}
