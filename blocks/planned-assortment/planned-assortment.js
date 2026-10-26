import { readBlockConfig } from '../../scripts/aem.js';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-US');

// Demo plan data. Replace by pointing the "Data" row of the block at a published sheet.
const SAMPLE_COLUMNS = ['fob', 'name', 'color', 'tier', 'cluster', 'units', 'doors', 'cost', 'retail', 'target', 'tag', 'url'];
const SAMPLE_ROWS = [
  ['Menswear', 'Classic Fit Striped Mesh Polo Shirt', 'Navy', 'Tier 1', 'Cluster 1', 4200, 120, 49, 98.5, 4000, 'Carryover', '/products/classic-fit-striped-mesh-polo-shirt/cfm'],
  ['Menswear', 'Classic Fit Striped Mesh Polo Shirt', 'Hunter Green', 'Tier 1', 'Cluster 1', 3600, 120, 49, 98.5, 4000, 'Carryover', '/products/classic-fit-striped-mesh-polo-shirt/cfm'],
  ['Menswear', 'Relaxed Fit Knit Corduroy Polo Shirt', 'Black', 'Tier 1', 'Cluster 2', 2800, 96, 67.5, 135, 3000, 'New', ''],
  ['Menswear', 'Relaxed Fit Knit Corduroy Polo Shirt', 'Cream', 'Tier 2', 'Cluster 2', 1500, 64, 67.5, 135, 1400, 'New', ''],
  ['Menswear', 'Cotton Oxford Shirt', 'White', 'Tier 2', 'Cluster 1', 2200, 88, 52, 105, 2300, 'Carryover', ''],
  ['Menswear', 'Slim Fit Chino Pant', 'Khaki', 'Tier 2', 'Cluster 3', 1800, 70, 44, 89.5, 2000, 'Carryover', ''],
  ['Menswear', 'Water-Repellent Jacket', 'Navy', 'Tier 1', 'Cluster 3', 1200, 52, 120, 248, 1300, 'New', ''],
  ['Menswear', 'Cable Knit Cotton Sweater', 'Cream', 'Tier 3', 'Cluster 2', 900, 40, 78, 165, 850, 'Carryover', ''],
  ['Womenswear', 'Pleated Cotton Dress', 'Navy', 'Tier 1', 'Cluster 1', 1500, 60, 88, 188, 1500, 'New', ''],
  ['Womenswear', 'Striped Linen Shirt', 'Blue', 'Tier 2', 'Cluster 2', 1300, 58, 55, 115, 1250, 'Carryover', ''],
  ['Womenswear', 'Wide-Leg Cotton Pant', 'Black', 'Tier 3', 'Cluster 3', 700, 30, 58, 125, 800, 'Carryover', ''],
  ['Womenswear', 'Quilted Vest', 'Olive', 'Tier 2', 'Cluster 1', 900, 40, 96, 198, 900, 'New', ''],
  ['Accessories', 'Engine Turned-Buckle Leather Belt', 'Brown', 'Tier 1', 'Cluster 1', 3000, 110, 84, 168, 3200, 'Carryover', ''],
  ['Accessories', 'Embroidered Faille Ball Cap', 'Green', 'Tier 1', 'Cluster 2', 2400, 100, 40, 79.5, 2200, 'New', '/products/embroidered-faille-ball-cap/embroidered-faille-ball-cap'],
  ['Accessories', 'Crew Socks 3-Pack', 'Navy', 'Tier 3', 'Cluster 3', 2000, 90, 12.5, 25, 2000, 'Carryover', ''],
  ['Accessories', 'Leather Card Case', 'Brown', 'Tier 3', 'Cluster 1', 600, 30, 38, 78, 700, 'Carryover', ''],
];

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v === false || v === null || v === undefined) return;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  });
  kids.flat().forEach((c) => {
    if (c === null || c === undefined || c === false) return;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  });
  return n;
}

const toNum = (v) => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;
const isSitePath = (p) => typeof p === 'string' && /^\/(?!\/)[\w\-./%]*$/.test(p);
const safeImage = (u) => (typeof u === 'string' && (isSitePath(u) || /^https:\/\//i.test(u)) ? u : '');

function normalize(rows) {
  return rows.map((raw, i) => {
    const r = {};
    Object.entries(raw).forEach(([k, v]) => { r[k.toLowerCase().replace(/[^a-z]/g, '')] = v; });
    const name = String(r.name || r.style || '');
    const color = String(r.color || '');
    return {
      id: `${name}|${color}|${i}`,
      fob: String(r.fob || 'General'),
      name,
      color,
      image: safeImage(String(r.image || '')),
      tier: String(r.tier || 'Unassigned'),
      cluster: String(r.cluster || 'Unassigned'),
      units: toNum(r.units),
      doors: toNum(r.doors),
      cost: toNum(r.cost),
      retail: toNum(r.retail),
      target: toNum(r.target),
      tag: String(r.tag || ''),
      url: isSitePath(String(r.url || '')) ? String(r.url) : '',
    };
  }).filter((r) => r.name);
}

function sampleRows() {
  return SAMPLE_ROWS.map((row) => Object.fromEntries(SAMPLE_COLUMNS.map((c, i) => [c, row[i]])));
}

function totals(list) {
  return list.reduce((t, it) => ({
    units: t.units + it.units,
    target: t.target + it.target,
    doors: t.doors + it.doors,
    cost: t.cost + it.units * it.cost,
    retail: t.retail + it.units * it.retail,
  }), { units: 0, target: 0, doors: 0, cost: 0, retail: 0 });
}

function csvCell(v) {
  let s = String(v ?? '');
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default async function decorate(block) {
  const cfg = readBlockConfig(block);
  const season = cfg.season || 'Fall 2027';
  const account = cfg.account || 'Customer account';
  const dataPath = cfg.data || '';

  let rows = sampleRows();
  if (isSitePath(dataPath)) {
    try {
      const resp = await fetch(dataPath);
      if (resp.ok) {
        const json = await resp.json();
        if (Array.isArray(json.data) && json.data.length) rows = json.data;
      }
    } catch (e) {
      // fall back to sample data
    }
  }

  const baseline = normalize(rows);
  const state = {
    items: baseline.map((i) => ({ ...i })),
    view: 'picture',
    fob: 'all',
    q: '',
    tier: '',
    cluster: '',
    group: 'none',
    canEdit: false, // buyer view: read-only
    selected: new Set(),
    notes: new Map(),
    changed: new Map(),
    updateSummary: '',
  };

  const notesKey = `pa-notes:${season}:${account}`;
  try {
    const saved = JSON.parse(localStorage.getItem(notesKey) || '{}');
    Object.entries(saved).forEach(([k, v]) => { if (typeof v === 'string') state.notes.set(k, v.slice(0, 500)); });
  } catch (e) { /* storage unavailable */ }
  const saveNotes = () => {
    try { localStorage.setItem(notesKey, JSON.stringify(Object.fromEntries(state.notes))); } catch (e) { /* ignore */ }
  };

  try {
    const hp = new URLSearchParams(window.location.hash.slice(1));
    if (['picture', 'data'].includes(hp.get('view'))) state.view = hp.get('view');
    if (hp.get('fob')) state.fob = hp.get('fob');
  } catch (e) { /* ignore */ }

  // RFP labels removed from the buyer view; kept as a no-op so the calls below stay harmless.
  const fit = () => null;

  const status = el('p', { class: 'pa-status', role: 'status', 'aria-live': 'polite' });
  const say = (m) => { status.textContent = m; };

  /* ---------- derived data ---------- */
  const fobs = () => [...new Set(state.items.map((i) => i.fob))];
  const matchesQuery = (i) => {
    if (!state.q) return true;
    const q = state.q.toLowerCase();
    return [i.name, i.color, i.tier, i.cluster, i.fob].some((s) => s.toLowerCase().includes(q));
  };
  const base = () => state.items.filter((i) => (state.fob === 'all' || i.fob === state.fob) && matchesQuery(i));
  const visible = () => base().filter((i) => (!state.tier || i.tier === state.tier) && (!state.cluster || i.cluster === state.cluster));

  /* ---------- static shell ---------- */
  const kpis = el('div', { class: 'pa-kpis' });
  const pivot = el('div', { class: 'pa-pivot' });
  const chips = el('div', { class: 'pa-chips' });
  const bulk = el('div', { class: 'pa-bulk', hidden: true });
  const content = el('div', { class: 'pa-content' });
  const banner = el('div', { class: 'pa-banner', hidden: true });

  const fobSelect = el('select', { id: 'pa-fob', 'aria-label': 'Family of business' });
  const search = el('input', { type: 'search', id: 'pa-search', placeholder: 'Search style, colour, tier', 'aria-label': 'Search assortment' });
  const btnPicture = el('button', { type: 'button', class: 'pa-toggle', 'aria-pressed': 'true' }, 'Grid view');
  const btnData = el('button', { type: 'button', class: 'pa-toggle', 'aria-pressed': 'false' }, 'List view');
  const selectAll = el('input', { type: 'checkbox', id: 'pa-all', 'aria-label': 'Select all visible' });

  const dialog = el('dialog', { class: 'pa-dialog', 'aria-labelledby': 'pa-note-title' });
  const noteTitle = el('h3', { id: 'pa-note-title' }, 'Add note');
  const noteText = el('textarea', { maxlength: '500', rows: '5', 'aria-label': 'Note text' });
  let noteIds = [];
  const noteForm = el('form', { method: 'dialog' },
    noteTitle, noteText,
    el('div', { class: 'pa-dialog-actions' },
      el('button', { type: 'button', class: 'pa-btn', onclick: () => dialog.close() }, 'Cancel'),
      el('button', { type: 'submit', class: 'pa-btn pa-btn-primary' }, 'Save note')));
  noteForm.addEventListener('submit', () => {
    const text = noteText.value.trim().slice(0, 500);
    noteIds.forEach((id) => { if (text) state.notes.set(id, text); else state.notes.delete(id); });
    saveNotes();
    say(text ? `Note saved on ${noteIds.length} product(s).` : 'Note removed.');
    render();
  });
  dialog.append(noteForm);

  function openNote(ids) {
    noteIds = ids;
    noteTitle.textContent = ids.length === 1 ? 'Product note' : `Note for ${ids.length} products`;
    noteText.value = ids.length === 1 ? (state.notes.get(ids[0]) || '') : '';
    dialog.showModal();
    noteText.focus();
  }

  /* ---------- actions ---------- */
  function move(id, dir) {
    if (!state.canEdit) return;
    const vis = visible().map((i) => i.id);
    const pos = vis.indexOf(id);
    const other = vis[pos + dir];
    if (!other) return;
    const a = state.items.findIndex((i) => i.id === id);
    const b = state.items.findIndex((i) => i.id === other);
    [state.items[a], state.items[b]] = [state.items[b], state.items[a]];
    say('Merchandising sequence updated.');
    render();
  }

  function exportCsv(list, label) {
    const head = ['Sequence', 'FOB', 'Style', 'Colour', 'Tier', 'Cluster', 'Planned units', 'Doors', 'Wholesale cost', 'Extended retail', 'Note'];
    const lines = [head.map(csvCell).join(',')];
    list.forEach((i, n) => {
      lines.push([n + 1, i.fob, i.name, i.color, i.tier, i.cluster, i.units, i.doors, (i.units * i.cost).toFixed(2),
        (i.units * i.retail).toFixed(2), state.notes.get(i.id) || ''].map(csvCell).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `planned-assortment-${label}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    say(`Exported ${list.length} styles to CSV.`);
  }

  function setHash() {
    try {
      const hp = new URLSearchParams({ view: state.view, fob: state.fob });
      window.history.replaceState(null, '', `#${hp.toString()}`);
    } catch (e) { /* ignore */ }
  }

  async function share() {
    setHash();
    try {
      await navigator.clipboard.writeText(window.location.href);
      say('Link copied. Demo only: secure sharing with version and access tracking is custom work.');
    } catch (e) {
      say('Copy the address bar link to share this view.');
    }
  }

  function simulateUpdate() {
    const it = state.items;
    const find = (n, c) => it.find((i) => i.name === n && i.color === c);
    state.changed = new Map();
    const parts = [];
    let changes = 0;
    const jacket = find('Water-Repellent Jacket', 'Navy');
    if (jacket) { jacket.units += 300; state.changed.set(jacket.id, 'chg'); changes += 1; }
    const cap = find('Embroidered Faille Ball Cap', 'Green');
    if (cap) { cap.units -= 400; state.changed.set(cap.id, 'chg'); changes += 1; }
    if (changes) parts.push(`${changes} quantity change${changes > 1 ? 's' : ''}`);
    const drop = find('Leather Card Case', 'Brown');
    if (drop) { it.splice(it.indexOf(drop), 1); parts.push('1 drop (Leather Card Case)'); }
    const added = {
      id: `add|${Date.now()}`, fob: 'Accessories', name: 'Suede Baseball Cap', color: 'Tan', image: '', tier: 'Tier 2', cluster: 'Cluster 2',
      units: 800, doors: 44, cost: 52, retail: 109, target: 700, tag: 'New', url: '',
    };
    it.splice(Math.min(it.length, 14), 0, added);
    state.changed.set(added.id, 'add');
    parts.push('1 add (Suede Baseball Cap)');
    state.updateSummary = `Plan synced from Anaplan: ${parts.join(', ')}.`;
    say(state.updateSummary);
    render();
  }

  function resetPlan() {
    state.items = baseline.map((i) => ({ ...i }));
    state.changed = new Map();
    state.updateSummary = '';
    state.selected.clear();
    say('Plan reset to the original version.');
    render();
  }

  /* ---------- renderers ---------- */
  function renderKpis(list) {
    const t = totals(list);
    const card = (label, value, extra) => el('div', { class: 'pa-kpi' },
      el('span', { class: 'pa-kpi-label' }, label), el('strong', { class: 'pa-kpi-value' }, value), extra);
    kpis.replaceChildren(
      card('Planned units', num.format(t.units)),
      card('Door placements', num.format(t.doors)),
      card('Wholesale cost', money.format(t.cost)),
      card('Extended retail', money.format(t.retail)),
      fit('custom', 'PAP-4.1, 4.2'),
    );
  }

  function renderPivot() {
    const items = base();
    const tiers = [...new Set(items.map((i) => i.tier))].sort();
    const clusters = [...new Set(items.map((i) => i.cluster))].sort();
    const cellBtn = (tier, cluster, list) => {
      const t = totals(list);
      const active = state.tier === tier && state.cluster === cluster;
      return el('td', {},
        el('button', {
          type: 'button',
          class: `pa-cell${active ? ' is-active' : ''}`,
          'aria-pressed': active ? 'true' : 'false',
          'aria-label': `${tier}, ${cluster}: ${num.format(t.units)} units, ${num.format(t.doors)} doors. Filter to this cell.`,
          onclick: () => {
            if (active) { state.tier = ''; state.cluster = ''; } else { state.tier = tier; state.cluster = cluster; }
            render();
          },
        }, el('span', {}, num.format(t.units)), el('small', {}, `${num.format(t.doors)} doors`)));
    };
    const table = el('table', { class: 'pa-pivot-table' },
      el('caption', {}, 'Units and door placements by tier and cluster. Select a cell to drill in.', fit('custom', 'PAP-3.5')),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Tier'),
        clusters.map((c) => el('th', { scope: 'col' }, c)), el('th', { scope: 'col' }, 'Total'))),
      el('tbody', {}, tiers.map((tier) => {
        const row = items.filter((i) => i.tier === tier);
        const t = totals(row);
        return el('tr', {}, el('th', { scope: 'row' }, tier),
          clusters.map((c) => cellBtn(tier, c, row.filter((i) => i.cluster === c))),
          el('td', { class: 'pa-total' }, num.format(t.units)));
      })));
    pivot.replaceChildren(table);
  }

  function renderChips() {
    const out = [];
    const chip = (text, clear) => el('button', { type: 'button', class: 'pa-chip', onclick: clear, 'aria-label': `Remove filter ${text}` }, `${text} ×`);
    if (state.tier) out.push(chip(state.tier, () => { state.tier = ''; state.cluster = ''; render(); }));
    if (state.cluster) out.push(chip(state.cluster, () => { state.cluster = ''; render(); }));
    chips.replaceChildren(...out);
  }

  function tile(it, list) {
    const idx = list.indexOf(it);
    const ch = state.changed.get(it.id);
    const note = state.notes.get(it.id);
    const media = el('div', { class: 'pa-tile-media' });
    if (it.image) media.append(el('img', { src: it.image, alt: '', loading: 'lazy' }));
    else media.append(el('span', { class: 'pa-ph', 'aria-hidden': 'true' }, it.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('')));
    const cb = el('input', {
      type: 'checkbox',
      class: 'pa-check',
      'aria-label': `Select ${it.name}, ${it.color}`,
      checked: state.selected.has(it.id),
      onchange: (e) => { if (e.target.checked) state.selected.add(it.id); else state.selected.delete(it.id); render(); },
    });
    media.prepend(cb);
    if (it.tag) media.append(el('span', { class: `pa-tag pa-tag-${it.tag.toLowerCase()}` }, it.tag));
    if (ch) media.append(el('span', { class: 'pa-flag' }, ch === 'add' ? 'Added' : 'Changed'));
    const title = it.url
      ? el('a', { href: it.url, class: 'pa-name' }, it.name)
      : el('span', { class: 'pa-name' }, it.name);
    const dis = !state.canEdit;
    return el('article', { class: `pa-tile${state.selected.has(it.id) ? ' is-selected' : ''}${ch ? ' is-changed' : ''}` },
      media,
      el('div', { class: 'pa-tile-info' },
        title,
        el('span', { class: 'pa-color' }, it.color),
        el('span', { class: 'pa-meta' }, `${it.tier} · ${it.cluster}`),
        el('span', { class: 'pa-meta' }, `${num.format(it.units)} units · ${num.format(it.doors)} doors`),
        note ? el('p', { class: 'pa-note', title: note }, `Note: ${note}`) : null),
      dis ? null : el('div', { class: 'pa-tile-actions' },
        el('button', { type: 'button', class: 'pa-icon', disabled: idx === 0, 'aria-label': `Move ${it.name} earlier`, onclick: () => move(it.id, -1) }, '←'),
        el('button', { type: 'button', class: 'pa-icon', disabled: idx === list.length - 1, 'aria-label': `Move ${it.name} later`, onclick: () => move(it.id, 1) }, '→'),
        el('button', { type: 'button', class: 'pa-icon pa-icon-note', 'aria-label': `${note ? 'Edit' : 'Add'} note for ${it.name}`, onclick: () => openNote([it.id]) }, note ? 'Edit note' : 'Note')));
  }

  const groupsOf = (list) => [['', list]];
  const groupHead = () => null;

  function renderPicture(list) {
    const nodes = [];
    groupsOf(list).forEach(([name, items]) => {
      nodes.push(groupHead(name, items));
      nodes.push(el('div', { class: 'pa-grid' }, items.map((it) => tile(it, list))));
    });
    return nodes;
  }

  function renderData(list) {
    const cols = ['', 'Seq', 'Style', 'Colour', 'FOB', 'Tier', 'Cluster', 'Units', 'Doors', 'Wholesale', 'Ext. retail', 'Note'];
    const nodes = [];
    groupsOf(list).forEach(([name, items]) => {
      nodes.push(groupHead(name, items));
      const t = totals(items);
      nodes.push(el('div', { class: 'pa-table-wrap' }, el('table', { class: 'pa-table' },
        el('thead', {}, el('tr', {}, cols.map((c) => el('th', { scope: 'col' }, c)))),
        el('tbody', {}, items.map((it) => {
          const ch = state.changed.get(it.id);
          const note = state.notes.get(it.id);
          return el('tr', { class: `${state.selected.has(it.id) ? 'is-selected' : ''}${ch ? ' is-changed' : ''}` },
            el('td', {}, el('input', {
              type: 'checkbox',
              'aria-label': `Select ${it.name}, ${it.color}`,
              checked: state.selected.has(it.id),
              onchange: (e) => { if (e.target.checked) state.selected.add(it.id); else state.selected.delete(it.id); render(); },
            })),
            el('td', {}, String(list.indexOf(it) + 1)),
            el('td', {}, it.url ? el('a', { href: it.url }, it.name) : it.name, ch ? el('span', { class: 'pa-flag pa-flag-inline' }, ch === 'add' ? 'Added' : 'Changed') : null),
            el('td', {}, it.color), el('td', {}, it.fob), el('td', {}, it.tier), el('td', {}, it.cluster),
            el('td', { class: 'pa-num' }, num.format(it.units)),
            el('td', { class: 'pa-num' }, num.format(it.doors)),
            el('td', { class: 'pa-num' }, money.format(it.units * it.cost)), el('td', { class: 'pa-num' }, money.format(it.units * it.retail)),
            el('td', {}, state.canEdit
              ? el('button', { type: 'button', class: 'pa-link', onclick: () => openNote([it.id]) }, note ? note.slice(0, 28) + (note.length > 28 ? '…' : '') : 'Add')
              : (note || '')));
        })),
        el('tfoot', {}, el('tr', {},
          el('td', { colspan: '7' }, 'Total'), el('td', { class: 'pa-num' }, num.format(t.units)),
          el('td', { class: 'pa-num' }, num.format(t.doors)),
          el('td', { class: 'pa-num' }, money.format(t.cost)), el('td', { class: 'pa-num' }, money.format(t.retail)), el('td', {}))))));
    });
    return nodes;
  }

  function updateBulk(list) {
    const n = [...state.selected].filter((id) => state.items.some((i) => i.id === id)).length;
    bulk.hidden = n === 0;
    bulk.replaceChildren(
      el('strong', {}, `${n} selected`),
      state.canEdit ? el('button', { type: 'button', class: 'pa-btn', onclick: () => openNote([...state.selected]) }, 'Add note') : null,
      el('button', { type: 'button', class: 'pa-btn', onclick: () => exportCsv(state.items.filter((i) => state.selected.has(i.id)), 'selected') }, 'Export selected'),
      el('button', { type: 'button', class: 'pa-btn', onclick: () => { state.selected.clear(); render(); } }, 'Clear'),
      fit('custom', 'PAP-3.4'));
    const visibleIds = list.map((i) => i.id);
    selectAll.checked = visibleIds.length > 0 && visibleIds.every((id) => state.selected.has(id));
  }

  function render() {
    const list = visible();
    fobSelect.replaceChildren(el('option', { value: 'all' }, 'All FOBs'), ...fobs().map((f) => el('option', { value: f }, f)));
    if (![...fobSelect.options].some((o) => o.value === state.fob)) state.fob = 'all';
    fobSelect.value = state.fob;
    btnPicture.setAttribute('aria-pressed', state.view === 'picture' ? 'true' : 'false');
    btnData.setAttribute('aria-pressed', state.view === 'data' ? 'true' : 'false');
    banner.hidden = !state.updateSummary;
    banner.replaceChildren(
      el('span', {}, state.updateSummary),
      el('button', { type: 'button', class: 'pa-btn', onclick: resetPlan }, 'Reset demo'),
      fit('ootb', 'PAP-7.1, 7.2'));
    renderKpis(list);
    renderPivot();
    renderChips();
    content.replaceChildren(...(list.length
      ? (state.view === 'picture' ? renderPicture(list) : renderData(list))
      : [el('p', { class: 'pa-empty' }, 'No styles match these filters.')]).filter(Boolean));
    updateBulk(list);
    setHash();
  }

  /* ---------- wire up ---------- */
  fobSelect.addEventListener('change', () => { state.fob = fobSelect.value; state.tier = ''; state.cluster = ''; render(); });
  search.addEventListener('input', () => { state.q = search.value.trim(); render(); });
  btnPicture.addEventListener('click', () => { state.view = 'picture'; render(); });
  btnData.addEventListener('click', () => { state.view = 'data'; render(); });
  selectAll.addEventListener('change', () => {
    visible().forEach((i) => { if (selectAll.checked) state.selected.add(i.id); else state.selected.delete(i.id); });
    render();
  });

  const head = el('div', { class: 'pa-head' },
    el('div', {},
      el('p', { class: 'pa-eyebrow' }, 'Planned assortment'),
      el('h2', { class: 'pa-title' }, `${season} · ${account}`),
      el('p', { class: 'pa-sub' }, 'Season × FOB × account plan, synced from the planning system.', fit('ootb', 'PAP-1.1 to 1.4, 2.1 to 2.4'))),
    el('div', { class: 'pa-head-actions' },
      el('button', { type: 'button', class: 'pa-btn', onclick: simulateUpdate }, 'Simulate plan update'),
      el('button', { type: 'button', class: 'pa-btn', onclick: () => exportCsv(visible(), 'view') }, 'Export to Excel (CSV)'),
      el('button', { type: 'button', class: 'pa-btn', onclick: share }, 'Copy share link')));

  const controls = el('div', { class: 'pa-controls' },
    el('div', { class: 'pa-view' }, btnPicture, btnData),
    fobSelect, search,
    el('label', { class: 'pa-all' }, selectAll, ' Select all'));

  block.classList.add('pa-ready');
  block.replaceChildren(head, banner, kpis, pivot, chips, controls, bulk, status, content, dialog);
  render();
}
