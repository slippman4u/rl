import { el } from '../lib/dom.js';
import {
  effectiveUnits, fromPrice, STATUSES,
} from '../lib/data.js';
import { apportion, formatCount } from '../lib/format.js';
import { createLayer, trapFocus } from '../lib/overlay.js';
import {
  STATUS_LABELS, fill, pctOf, swatchDot, thumbBox, toneFor, varianceText,
} from '../lib/wedge-utils.js';

let current;

/** Close the open drawer, if any (also called when leaving the wedge). */
export function closeDrawer() {
  if (current) current.close();
}

function unitsBars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return el(
    'ul',
    { class: 'rw-ubars' },
    rows.map((r) => {
      const fillBar = el('span', { class: 'rw-ubar-fill', 'data-kind': r.kind });
      fillBar.style.setProperty('--w', `${(r.value / max) * 100}%`);
      return el(
        'li',
        {},
        el('span', { class: 'rw-ubar-label', text: r.label }),
        el('span', { class: 'rw-ubar-track' }, fillBar),
        el('strong', { class: 'rw-ubar-value', text: formatCount(r.value) }),
      );
    }),
  );
}

/** Planned units spread over the doors that carry the style, by each door's share. */
function doorUnits(model, tile, planned) {
  const entitled = model.doorsCarrying(tile.id);
  const total = entitled.reduce((sum, d) => sum + d.share, 0);
  const shares = entitled.map((d) => (total ? d.share / total : 1 / entitled.length));
  const parts = entitled.length ? apportion(planned, shares) : [];
  return new Map(entitled.map((d, i) => [d.id, parts[i]]));
}

/**
 * Open the product drawer for a style. It repaints on every model change.
 * @param {{model: Object, tileId: string, restoreFocus: Function}} opts
 */
export function openDrawer({ model, tileId, restoreFocus }) {
  closeDrawer();
  const layer = createLayer('rw-drawer-layer');
  const backdrop = el('div', { class: 'rw-backdrop' });
  const panel = el('aside', {
    class: 'rw-drawer',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'rw-drawer-title',
    tabindex: '-1',
  });
  layer.node.append(backdrop, panel);

  let chosenColor = '';
  let draft = '';
  let release;
  let unsubscribe;
  let painted = false;

  function close() {
    if (!current) return;
    current = undefined;
    if (release) release();
    if (unsubscribe) unsubscribe();
    layer.remove();
    if (restoreFocus) restoreFocus();
  }

  function paint() {
    const tile = model.tiles.find((t) => t.id === tileId);
    if (!tile) {
      close();
      return;
    }
    const body = panel.querySelector('.rw-drawer-body');
    const scrollTop = body ? body.scrollTop : 0;
    const focusKey = panel.contains(document.activeElement)
      ? document.activeElement.dataset.fk : '';

    const planned = effectiveUnits(tile);
    const variance = planned - tile.targetUnits;
    const varPct = pctOf(variance, tile.targetUnits);
    const chosen = tile.colors.find((c) => c.id === chosenColor);

    const closeButton = el('button', {
      class: 'rw-drawer-close', type: 'button', 'aria-label': 'Close details', 'data-fk': 'close', text: '×',
    });
    closeButton.addEventListener('click', close);

    // --- colors ---
    const swatches = tile.colors.map((c) => {
      const b = el(
        'button',
        {
          class: 'rw-dswatch',
          type: 'button',
          'aria-pressed': String(c.id === chosenColor),
          'aria-label': `${c.color}, ${formatCount(effectiveUnits(c))} planned units`,
          title: c.color,
          'data-fk': `color|${c.id}`,
        },
        swatchDot(c.swatch),
      );
      b.addEventListener('click', () => {
        chosenColor = chosenColor === c.id ? '' : c.id;
        paint();
      });
      return el('li', {}, b);
    });
    let colorDetail = el('p', { class: 'rw-muted rw-dcolor-hint', text: 'Pick a swatch to see that color on its own.' });
    if (chosen) {
      const cu = effectiveUnits(chosen);
      const cv = cu - chosen.targetUnits;
      colorDetail = el(
        'div',
        { class: 'rw-dcolor-detail', role: 'status' },
        el('strong', { text: chosen.color }),
        el('span', { text: `${formatCount(cu)} planned` }),
        el('span', { text: `target ${formatCount(chosen.targetUnits)}` }),
        el('span', { text: `last year ${formatCount(chosen.lastYearUnits)}` }),
        el('span', {
          class: 'rw-wvar',
          'data-tone': toneFor(pctOf(cv, chosen.targetUnits)),
          text: varianceText({ variance: cv, pct: pctOf(cv, chosen.targetUnits) }),
        }),
      );
    }

    // --- status control ---
    const statusControl = el(
      'div',
      { class: 'rw-seg-group rw-dstatus', role: 'group', 'aria-label': 'Status' },
      STATUSES.map((status) => {
        const b = el('button', {
          class: 'rw-seg',
          type: 'button',
          'aria-pressed': String(tile.status === status),
          'data-fk': `status|${status}`,
          text: STATUS_LABELS[status],
        });
        b.addEventListener('click', () => {
          if (tile.status !== status) model.setStatus(tile.id, status);
        });
        return b;
      }),
    );

    // --- sizes ---
    const sizeParts = apportion(planned, model.sizeCurve.map((s) => s.share));
    const sizes = el(
      'ul',
      { class: 'rw-dsizes' },
      model.sizeCurve.map((s, i) => el(
        'li',
        {},
        el('span', { class: 'rw-dsize-label', text: s.size }),
        el('strong', { text: formatCount(sizeParts[i]) }),
      )),
    );

    // --- doors ---
    const unitsByDoor = doorUnits(model, tile, planned);
    const doors = el(
      'ul',
      { class: 'rw-ddoors' },
      model.doors.map((door) => {
        const entitled = unitsByDoor.has(door.id);
        const units = entitled ? unitsByDoor.get(door.id) : 0;
        const bar = el('span', { class: 'rw-ubar-fill', 'data-kind': 'door' });
        bar.style.setProperty('--w', `${planned ? (units / planned) * 100 : 0}%`);
        return el(
          'li',
          { class: 'rw-ddoor', 'data-entitled': String(entitled) },
          el('span', { class: 'rw-ddoor-name' }, el('strong', { text: door.name }), el('small', { class: 'rw-ddoor-city', text: entitled ? door.city : `${door.city} · Not entitled` })),
          el('span', { class: 'rw-ubar-track' }, bar),
          el('strong', { class: 'rw-ubar-value', text: formatCount(units) }),
        );
      }),
    );

    // --- notes ---
    const noteInput = el('textarea', {
      id: 'rw-drawer-note', rows: '3', maxlength: '500', placeholder: 'Add a note about this style',
    });
    noteInput.value = draft;
    noteInput.addEventListener('input', () => { draft = noteInput.value; });
    const addNote = el('button', {
      class: 'rw-button rw-button-outline', type: 'button', 'data-fk': 'add-note', text: 'Add note',
    });
    addNote.addEventListener('click', () => {
      const text = noteInput.value.trim();
      if (!text) return;
      draft = '';
      model.addNote(tile.id, text);
      panel.querySelector('#rw-drawer-note')?.focus();
    });
    const notes = el(
      'ul',
      { class: 'rw-dnotes', 'aria-label': 'Notes' },
      tile.notes.length
        ? tile.notes.map((n) => el(
          'li',
          {},
          el('span', { text: n.text }),
          el('small', { class: 'rw-dnote-meta', text: [n.author, n.date].filter(Boolean).join(', ') || 'From the plan sheet' }),
        ))
        : el('li', { class: 'rw-muted', text: 'No notes yet.' }),
    );

    fill(
      panel,
      el(
        'div',
        { class: 'rw-drawer-head' },
        el(
          'div',
          {},
          el('p', { class: 'rw-eyebrow', text: `${tile.cluster} · ${tile.tier}` }),
          el('h2', { id: 'rw-drawer-title', text: tile.shortName }),
        ),
        closeButton,
      ),
      el(
        'div',
        { class: 'rw-drawer-body' },
        thumbBox(tile, { width: 960, className: 'rw-drawer-img' }),
        el(
          'section',
          { 'aria-label': 'Colors' },
          el('h3', { text: `Colors (${tile.colors.length})` }),
          el('ul', { class: 'rw-dswatches' }, swatches),
          colorDetail,
        ),
        el(
          'section',
          { 'aria-label': 'Style' },
          el(
            'dl',
            { class: 'rw-dfacts' },
            el('div', {}, el('dt', { text: 'Name' }), el('dd', { text: tile.name })),
            el('div', {}, el('dt', { text: 'SKU' }), el('dd', { text: tile.parentSku })),
            el('div', {}, el('dt', { text: 'Cluster' }), el('dd', { text: tile.cluster })),
            el('div', {}, el('dt', { text: 'Tier' }), el('dd', { text: tile.tier })),
            el('div', {}, el('dt', { text: 'Price' }), el('dd', { text: fromPrice(tile) })),
          ),
          el('h3', { text: 'Status' }),
          statusControl,
        ),
        el(
          'section',
          { 'aria-label': 'Units' },
          el('h3', { text: 'Units' }),
          unitsBars([
            { label: 'Planned', value: planned, kind: 'planned' },
            { label: 'Target', value: tile.targetUnits, kind: 'target' },
            { label: 'Last year', value: tile.lastYearUnits, kind: 'last' },
          ]),
          el('p', {
            class: 'rw-wvar rw-dvariance',
            'data-tone': toneFor(varPct),
            text: `${varianceText({ variance, pct: varPct })} versus target`,
          }),
        ),
        el('section', { 'aria-label': 'Units by size' }, el('h3', { text: 'Units by size' }), sizes),
        el(
          'section',
          { 'aria-label': 'Doors' },
          el('h3', { text: 'Doors' }),
          el('p', { class: 'rw-muted rw-dhint', text: 'Planned units spread over the doors that carry this style.' }),
          doors,
        ),
        el(
          'section',
          { 'aria-label': 'Notes' },
          el('h3', { text: 'Notes' }),
          notes,
          el('label', { class: 'rw-sr', for: 'rw-drawer-note', text: 'Add a note' }),
          noteInput,
          addNote,
        ),
      ),
    );

    const newBody = panel.querySelector('.rw-drawer-body');
    if (newBody) newBody.scrollTop = scrollTop;
    const target = focusKey ? panel.querySelector(`[data-fk="${CSS.escape(focusKey)}"]`) : null;
    if (target) target.focus({ preventScroll: true });
    else if (!painted) closeButton.focus();
    painted = true;
  }

  current = { close };
  backdrop.addEventListener('click', close);
  release = trapFocus(panel, close);
  unsubscribe = model.subscribe(paint);
  paint();
  requestAnimationFrame(() => layer.node.classList.add('is-open'));
  return current;
}
