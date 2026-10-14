import { el } from '../lib/dom.js';
import {
  addDays, buildIcs, formatDate, formatTime, initialsOf, isoDate, monthLabel, parseDate,
  startOf, timeOf, whenKey,
} from '../lib/format.js';

const VISIT_TYPES = ['Seasonal preview', 'In-depth order session', 'Follow-up'];
const DURATIONS = [60, 90, 120];
const PRE_READ = [
  { key: 'plan', label: 'Account plan', on: true },
  { key: 'assortment', label: 'Visual assortment', on: true },
  { key: 'lookbook', label: 'Look-book link', on: false },
];
const ACTIVE = ['tentative', 'confirmed'];
const OPEN_SHARE = 0.75; // a day is "open" when at least this share of its capacity is free
const FULL_DATE = {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
};
const DAY_LABEL = {
  open: 'open availability', limited: 'limited availability', booked: 'fully booked',
};
const SLOT_LABEL = { open: '', limited: 'Limited', booked: 'Booked' };

/** Labels for the pre-read item keys stored on an appointment. */
const preReadLabels = (keys) => keys
  .map((key) => PRE_READ.find((i) => i.key === key)?.label)
  .filter(Boolean);

const monthIndex = (date) => date.getFullYear() * 12 + date.getMonth();

/** Join names the way a person would: "a, b and c". */
function naturalList(items) {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The account's current tentative hold or confirmed visit, if any. */
function activeVisit(model) {
  return model.appointments
    .filter((a) => a.account === model.account.name && ACTIVE.includes(a.status))
    .sort((a, b) => whenKey(a).localeCompare(whenKey(b)))[0];
}

/** Replace a host's children, skipping empty slots (a raw `null` would be rendered as text). */
function fill(host, ...nodes) {
  host.replaceChildren(...nodes.flat().filter(Boolean));
}

function field(label, id, control) {
  return el('div', { class: 'rw-field' }, el('label', { for: id, text: label }), control);
}

function select(id, options, value) {
  const node = el(
    'select',
    { id, class: 'rw-select' },
    options.map((o) => el('option', { value: String(o.value), text: o.label })),
  );
  node.value = String(value);
  return node;
}

// --- confirmation state ---------------------------------------------------------------------

function inviteEmail(model, appt) {
  const buyerFirst = model.account.buyerName.split(/\s+/)[0];
  const others = appt.attendees
    .filter((n) => n !== model.account.buyerName && n !== model.rep.name);
  const sends = preReadLabels(appt.preRead);
  const paragraphs = [
    `Hi ${buyerFirst},`,
    `Your ${appt.type.toLowerCase()} is confirmed for ${formatDate(appt.date, FULL_DATE)} at `
      + `${formatTime(appt.time)} at our ${appt.showroom} showroom. I have set aside `
      + `${appt.durationMinutes} minutes for us.`,
    others.length ? `Also joining: ${naturalList(others)}.` : null,
    sends.length
      ? `Before we meet I will send you ${naturalList(sends.map((s) => `the ${s.toLowerCase()}`))}.`
      : null,
    'If anything changes, reply to this note and I will find another time.',
  ].filter(Boolean);
  const subject = `${appt.type} confirmed: ${formatDate(appt.date, { weekday: 'long', month: 'long', day: 'numeric' })} at ${formatTime(appt.time)}`;

  return el(
    'section',
    { class: 'rw-card rw-email', 'aria-labelledby': 'rw-email-title' },
    el('h2', { id: 'rw-email-title', text: 'Invite email preview' }),
    el('p', { class: 'rw-muted rw-email-note', text: 'Preview only. Nothing is sent from this prototype.' }),
    el(
      'div',
      { class: 'rw-email-body', role: 'group', 'aria-label': 'Invite email' },
      el(
        'dl',
        { class: 'rw-email-head' },
        el('div', { class: 'rw-email-row' }, el('dt', { text: 'From' }), el('dd', { text: `${model.rep.name}, ${model.rep.title}` })),
        el('div', { class: 'rw-email-row' }, el('dt', { text: 'To' }), el('dd', { text: model.account.buyerName })),
        el('div', { class: 'rw-email-row' }, el('dt', { text: 'Subject' }), el('dd', { text: subject })),
      ),
      paragraphs.map((text) => el('p', { text })),
      el('p', {}, 'Best,', el('br'), model.rep.name, el('br'), model.rep.title),
    ),
  );
}

function downloadIcs(model, appt) {
  const start = startOf(appt.date, appt.time);
  const ics = buildIcs({
    uid: appt.id,
    start,
    durationMinutes: appt.durationMinutes,
    summary: `${appt.type}: ${model.account.name}`,
    location: `${appt.showroom} showroom`,
    description: `Attendees: ${appt.attendees.join(', ')}`,
  });
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const link = el('a', { href: url, download: `showroom-visit-${appt.date}.ics`, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function confirmation(model, ctx, appt) {
  const start = startOf(appt.date, appt.time);
  const end = new Date(start.getTime() + appt.durationMinutes * 60000);
  const sends = preReadLabels(appt.preRead);
  const row = (term, value) => el('div', {}, el('dt', { text: term }), el('dd', { text: value }));

  const calendar = el('button', { class: 'rw-button rw-button-outline', type: 'button', text: 'Add to calendar' });
  calendar.addEventListener('click', () => downloadIcs(model, appt));
  const startVisit = el('button', { class: 'rw-button', type: 'button', text: 'Start visit' });
  startVisit.addEventListener('click', () => {
    ctx.setPresentation(true);
    ctx.navigate('#/wedge');
  });

  return el(
    'div',
    { class: 'rw-confirmed' },
    el(
      'section',
      { class: 'rw-card rw-summary', 'aria-labelledby': 'rw-confirmed-title' },
      el('p', { class: 'rw-eyebrow', text: 'Visit confirmed' }),
      el('h1', { id: 'rw-confirmed-title', tabindex: '-1', text: formatDate(appt.date, FULL_DATE) }),
      el(
        'dl',
        { class: 'rw-summary-list' },
        row('Time', `${formatTime(appt.time)} to ${timeOf(end)}`),
        row('Duration', `${appt.durationMinutes} minutes`),
        row('Showroom', appt.showroom),
        row('Visit type', appt.type),
        row('Attendees', appt.attendees.join(', ')),
        row('Pre-read', sends.length ? sends.join(', ') : 'Nothing selected'),
      ),
    ),
    inviteEmail(model, appt),
    el(
      'div',
      { class: 'rw-actions' },
      startVisit,
      calendar,
      el('a', { class: 'rw-button rw-button-outline', href: '#/home', text: 'Back to home' }),
    ),
  );
}

// --- booking form ---------------------------------------------------------------------------

function bookingForm(model, ctx, showConfirmed) {
  const hold = activeVisit(model);
  const preferred = String(model.account.preferredDay || '').toLowerCase();
  const replacesLine = (visit) => `Replaces your ${visit.status === 'tentative' ? 'tentative hold' : 'confirmed visit'} on `
    + `${formatDate(visit.date)} at ${formatTime(visit.time)}`;
  const showrooms = [...new Set(model.slots.map((s) => s.showroom))];
  const weekdayOf = (date) => date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

  const ui = {
    showroom: showrooms.includes(hold?.showroom) ? hold.showroom : showrooms[0],
    year: 0,
    month: 0,
    focusIso: '',
    selectedDate: '',
    slotId: '',
    type: VISIT_TYPES.includes(hold?.type) ? hold.type : VISIT_TYPES[0],
    duration: DURATIONS.includes(hold?.durationMinutes) ? hold.durationMinutes : DURATIONS[0],
    attendees: [
      { name: model.account.showroomContact.name, role: 'Showroom contact', removable: true },
      { name: model.account.buyerName, role: 'Buyer', removable: true },
      { name: model.rep.name, role: 'Sales representative', removable: false },
    ].filter((a) => a.name),
    preRead: new Set(PRE_READ.filter((i) => i.on).map((i) => i.key)),
  };

  // availability of a slot as the rep sees it: the account's own hold can be re-booked
  const ownHold = (slot) => !!hold && hold.slotId === slot.id;
  const slotState = (slot) => {
    if (slot.booked && !ownHold(slot)) return 'booked';
    return slot.status === 'limited' ? 'limited' : 'open';
  };

  /** Map of ISO date -> { slots, state } for the selected showroom. */
  function dayMap() {
    const days = new Map();
    model.slots.filter((s) => s.showroom === ui.showroom)
      .sort((a, b) => whenKey(a).localeCompare(whenKey(b)))
      .forEach((slot) => {
        if (!days.has(slot.date)) days.set(slot.date, { slots: [] });
        days.get(slot.date).slots.push(slot);
      });
    days.forEach((info) => {
      // open counts 1, limited counts half, booked counts 0
      const weight = { open: 1, limited: 0.5, booked: 0 };
      const score = info.slots.reduce((sum, slot) => sum + weight[slotState(slot)], 0);
      if (score === 0) info.state = 'booked';
      else if (score / info.slots.length >= OPEN_SHARE) info.state = 'open';
      else info.state = 'limited';
    });
    return days;
  }

  function openMonthOnEarliest() {
    const days = dayMap();
    const firstOpen = [...days].find(([, info]) => info.state !== 'booked');
    const iso = (firstOpen || [...days][0] || [isoDate(new Date())])[0];
    const date = parseDate(iso);
    ui.year = date.getFullYear();
    ui.month = date.getMonth();
  }

  /** Keep the roving tab stop on a sensible day of the visible month. */
  function syncFocus() {
    const days = dayMap();
    const inMonth = (iso) => {
      const d = parseDate(iso);
      return d && d.getFullYear() === ui.year && d.getMonth() === ui.month;
    };
    if (inMonth(ui.focusIso)) return;
    if (inMonth(ui.selectedDate)) ui.focusIso = ui.selectedDate;
    else ui.focusIso = [...days.keys()].find(inMonth) || isoDate(new Date(ui.year, ui.month, 1));
  }

  const calHost = el('div', { class: 'rw-cal' });
  const slotsHost = el('div', { class: 'rw-slots-host' });
  const attendeesHost = el('div', {});
  const confirmHost = el('div', { class: 'rw-confirm-host' });

  const focusDay = (iso) => calHost.querySelector(`[data-iso="${iso}"]`)?.focus();

  function moveMonth(delta) {
    const target = new Date(ui.year, ui.month + delta, 1);
    ui.year = target.getFullYear();
    ui.month = target.getMonth();
    ui.focusIso = '';
    syncFocus();
    paintCalendar();
  }

  function selectDay(iso) {
    ui.selectedDate = iso;
    ui.focusIso = iso;
    ui.slotId = '';
    paintCalendar();
    focusDay(iso);
    paintSlots();
    paintConfirm();
  }

  function moveFocus(date) {
    const days = [...dayMap().keys()].map(parseDate);
    if (!days.length) return;
    const lo = Math.min(...days.map(monthIndex));
    const hi = Math.max(...days.map(monthIndex));
    if (monthIndex(date) < lo || monthIndex(date) > hi) return;
    ui.focusIso = isoDate(date);
    ui.year = date.getFullYear();
    ui.month = date.getMonth();
    paintCalendar();
    focusDay(ui.focusIso);
  }

  function onGridKey(event) {
    const button = event.target.closest('.rw-day');
    if (!button) return;
    const current = parseDate(button.dataset.iso);
    const steps = {
      ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
    };
    let next;
    if (steps[event.key]) next = addDays(current, steps[event.key]);
    else if (event.key === 'Home') next = addDays(current, -((current.getDay() + 6) % 7));
    else if (event.key === 'End') next = addDays(current, 6 - ((current.getDay() + 6) % 7));
    else if (event.key === 'PageUp') next = new Date(current.getFullYear(), current.getMonth() - 1, 1);
    else if (event.key === 'PageDown') next = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    else return; // Enter and Space fall through to the button's own click
    event.preventDefault();
    moveFocus(next);
  }

  function dayButton(date, info) {
    const iso = isoDate(date);
    const isPreferred = !!preferred && weekdayOf(date) === preferred;
    const selected = iso === ui.selectedDate;
    const label = info ? DAY_LABEL[info.state] : 'no showroom slots';
    const button = el(
      'button',
      {
        type: 'button',
        class: 'rw-day',
        'data-iso': iso,
        'data-state': info ? info.state : 'none',
        'data-selected': String(selected),
        'data-pref': isPreferred ? 'true' : null,
        'aria-disabled': info ? null : 'true',
        tabindex: iso === ui.focusIso ? '0' : '-1',
        'aria-label': `${formatDate(iso, FULL_DATE)}, ${label}${isPreferred ? ', preferred day' : ''}`,
      },
      el('span', { class: 'rw-day-num', text: String(date.getDate()) }),
      info ? el('span', { class: 'rw-day-dot', 'aria-hidden': 'true' }) : null,
      isPreferred ? el('span', { class: 'rw-day-pref', 'aria-hidden': 'true' }) : null,
    );
    return el('div', { role: 'gridcell', 'aria-selected': String(selected) }, button);
  }

  function paintCalendar() {
    const days = dayMap();
    const monthStart = new Date(ui.year, ui.month, 1);
    const all = [...days.keys()].sort();
    const hasEarlier = all.some((iso) => iso < isoDate(monthStart));
    const hasLater = all.some((iso) => iso >= isoDate(new Date(ui.year, ui.month + 1, 1)));

    const nav = (label, delta, disabled, mark) => {
      const b = el('button', {
        class: 'rw-cal-nav', type: 'button', 'aria-label': label, disabled: disabled || null, text: mark,
      });
      b.addEventListener('click', () => moveMonth(delta));
      return b;
    };

    const offset = (monthStart.getDay() + 6) % 7; // Monday first
    const count = new Date(ui.year, ui.month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < offset; i += 1) cells.push(el('div', { role: 'gridcell', class: 'rw-day-blank' }));
    for (let d = 1; d <= count; d += 1) {
      const date = new Date(ui.year, ui.month, d);
      cells.push(dayButton(date, days.get(isoDate(date))));
    }
    while (cells.length % 7) cells.push(el('div', { role: 'gridcell', class: 'rw-day-blank' }));
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(el('div', { role: 'row', class: 'rw-cal-row' }, cells.slice(i, i + 7)));
    }
    const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i)
      .toLocaleDateString('en-US', { weekday: 'short' }));

    const grid = el(
      'div',
      { role: 'grid', class: 'rw-cal-grid', 'aria-label': monthLabel(ui.year, ui.month) },
      el(
        'div',
        { role: 'row', class: 'rw-cal-row rw-cal-dow' },
        weekdays.map((w) => el('div', { role: 'columnheader', class: 'rw-dow', text: w })),
      ),
      weeks,
    );
    grid.addEventListener('keydown', onGridKey);
    grid.addEventListener('click', (event) => {
      const button = event.target.closest('.rw-day');
      if (button && button.getAttribute('aria-disabled') !== 'true') selectDay(button.dataset.iso);
    });

    const preferredLabel = model.account.preferredDay;
    fill(
      calHost,
      el(
        'div',
        { class: 'rw-cal-head' },
        nav('Previous month', -1, !hasEarlier, ''),
        el('h2', { class: 'rw-cal-title', 'aria-live': 'polite', text: monthLabel(ui.year, ui.month) }),
        nav('Next month', 1, !hasLater, ''),
      ),
      grid,
      el(
        'ul',
        { class: 'rw-cal-legend' },
        ['open', 'limited', 'booked'].map((state) => el(
          'li',
          {},
          el('span', { class: 'rw-legend-dot', 'data-state': state, 'aria-hidden': 'true' }),
          state.charAt(0).toUpperCase() + state.slice(1),
        )),
      ),
      preferredLabel
        ? el(
          'p',
          { class: 'rw-cal-note' },
          el('span', { class: 'rw-day-pref', 'aria-hidden': 'true' }),
          ` ${model.account.name.split(/\s+/)[0]} prefers ${preferredLabel}s`,
        )
        : null,
    );
  }

  function paintSlots() {
    const info = dayMap().get(ui.selectedDate);
    if (!info) {
      fill(
        slotsHost,
        el('h3', { text: 'Time' }),
        el('p', { class: 'rw-muted', text: 'Choose a day on the calendar to see the times.' }),
      );
      return;
    }
    const allBooked = info.slots.every((s) => slotState(s) === 'booked');
    const buttons = info.slots.map((slot) => {
      const state = slotState(slot);
      const note = ownHold(slot) ? 'Your hold' : SLOT_LABEL[state];
      const b = el(
        'button',
        {
          type: 'button',
          class: 'rw-slot',
          'data-state': state,
          'data-id': slot.id,
          'aria-pressed': String(ui.slotId === slot.id),
          disabled: state === 'booked' || null,
          'aria-label': `${formatTime(slot.time)}${note ? `, ${note.toLowerCase()}` : ''}`,
        },
        el('strong', { text: formatTime(slot.time) }),
        note ? el('small', { text: note }) : null,
      );
      b.addEventListener('click', () => {
        ui.slotId = slot.id;
        paintSlots();
        slotsHost.querySelector(`[data-id="${slot.id}"]`)?.focus();
        paintConfirm();
      });
      return b;
    });
    fill(
      slotsHost,
      el('h3', { text: `Times on ${formatDate(ui.selectedDate, { weekday: 'long', month: 'long', day: 'numeric' })}` }),
      allBooked ? el('p', { class: 'rw-muted', text: 'Every time on this day is booked. Pick another day.' }) : null,
      el('div', { class: 'rw-slots' }, buttons),
    );
  }

  function paintAttendees() {
    const input = el('input', {
      id: 'rw-attendee-name', type: 'text', maxlength: '60', autocomplete: 'off', placeholder: 'Name',
    });
    const message = el('p', { class: 'rw-muted rw-form-note', role: 'status' });
    const form = el(
      'form',
      { class: 'rw-add-attendee', novalidate: true },
      el('label', { class: 'rw-sr', for: 'rw-attendee-name', text: 'Add attendee' }),
      input,
      el('button', { class: 'rw-button rw-button-outline', type: 'submit', text: 'Add attendee' }),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      if (ui.attendees.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
        message.textContent = `${name} is already on the list.`;
        return;
      }
      ui.attendees.push({ name, role: 'Guest', removable: true });
      paintAttendees();
      attendeesHost.querySelector('input')?.focus();
    });

    const chips = ui.attendees.map((a) => {
      const remove = a.removable
        ? el('button', {
          class: 'rw-chip-remove', type: 'button', 'aria-label': `Remove ${a.name}`, text: '×',
        })
        : null;
      if (remove) {
        remove.addEventListener('click', () => {
          ui.attendees = ui.attendees.filter((x) => x !== a);
          paintAttendees();
          attendeesHost.querySelector('input')?.focus();
        });
      }
      return el(
        'li',
        { class: 'rw-attendee' },
        el('span', { class: 'rw-avatar-chip', 'aria-hidden': 'true', text: initialsOf(a.name) }),
        el('span', { class: 'rw-attendee-text' }, el('strong', { text: a.name }), el('small', { text: a.role })),
        remove,
      );
    });
    fill(
      attendeesHost,
      el('h3', { text: 'Attendees' }),
      el('ul', { class: 'rw-attendees', 'aria-label': 'Attendees' }, chips),
      form,
      message,
    );
  }

  function paintConfirm() {
    const ready = !!ui.slotId;
    const button = el('button', {
      class: 'rw-button rw-confirm', type: 'button', disabled: ready ? null : true, text: 'Confirm appointment',
    });
    button.addEventListener('click', () => {
      if (!ui.slotId) return;
      const appt = model.bookAppointment({
        slotId: ui.slotId,
        accountId: model.account.id,
        type: ui.type,
        status: 'confirmed',
        durationMinutes: ui.duration,
        attendees: ui.attendees.map((a) => a.name),
        preRead: PRE_READ.filter((i) => ui.preRead.has(i.key)).map((i) => i.key),
      });
      ctx.completeStage('visit');
      showConfirmed(appt);
    });
    fill(
      confirmHost,
      button,
      ready ? null : el('p', { class: 'rw-muted rw-form-note', text: 'Choose a day and a time to confirm.' }),
    );
  }

  // --- static controls ---
  const showroomSelect = select('rw-showroom', showrooms.map((s) => ({ value: s, label: s })), ui.showroom);
  showroomSelect.addEventListener('change', () => {
    ui.showroom = showroomSelect.value;
    const days = dayMap();
    if (!days.has(ui.selectedDate)) ui.selectedDate = '';
    const slot = model.slots.find((s) => s.id === ui.slotId);
    if (!slot || slot.showroom !== ui.showroom) ui.slotId = '';
    const monthHasSlots = [...days.keys()].some((iso) => {
      const d = parseDate(iso);
      return d.getFullYear() === ui.year && d.getMonth() === ui.month;
    });
    if (!monthHasSlots) openMonthOnEarliest();
    ui.focusIso = '';
    syncFocus();
    paintCalendar();
    paintSlots();
    paintConfirm();
  });

  const typeSelect = select('rw-type', VISIT_TYPES.map((t) => ({ value: t, label: t })), ui.type);
  typeSelect.addEventListener('change', () => { ui.type = typeSelect.value; });
  const durationSelect = select(
    'rw-duration',
    DURATIONS.map((d) => ({ value: d, label: `${d} minutes` })),
    ui.duration,
  );
  durationSelect.addEventListener('change', () => { ui.duration = Number(durationSelect.value); });

  const toggles = PRE_READ.map((item) => {
    const box = el('input', {
      type: 'checkbox', role: 'switch', id: `rw-preread-${item.key}`, class: 'rw-switch',
    });
    box.checked = ui.preRead.has(item.key);
    box.addEventListener('change', () => {
      if (box.checked) ui.preRead.add(item.key);
      else ui.preRead.delete(item.key);
    });
    return el('li', {}, el('label', { class: 'rw-toggle', for: box.id }, box, el('span', { text: item.label })));
  });

  openMonthOnEarliest();
  syncFocus();
  paintCalendar();
  paintSlots();
  paintAttendees();
  paintConfirm();

  return el(
    'div',
    { class: 'rw-appt-grid' },
    el('section', { class: 'rw-card rw-pane', 'aria-label': 'Choose a day' }, calHost),
    el(
      'section',
      { class: 'rw-card rw-pane', 'aria-label': 'Visit details' },
      hold
        ? el('p', { class: 'rw-replaces', role: 'status', text: replacesLine(hold) })
        : null,
      field('Showroom', 'rw-showroom', showroomSelect),
      slotsHost,
      el('div', { class: 'rw-field-row' }, field('Visit type', 'rw-type', typeSelect), field('Duration', 'rw-duration', durationSelect)),
      attendeesHost,
      el('h3', { text: 'Share before the visit' }),
      el('ul', { class: 'rw-toggles' }, toggles),
      confirmHost,
    ),
  );
}

// --- view -----------------------------------------------------------------------------------

export function render(container, model, ctx) {
  const root = el('div', { class: 'rw-appt' });
  const showConfirmed = (appt) => {
    root.replaceChildren(confirmation(model, ctx, appt));
    window.scrollTo(0, 0);
    root.querySelector('h1')?.focus({ preventScroll: true });
  };
  root.append(
    el(
      'div',
      { class: 'rw-appt-title' },
      el('p', { class: 'rw-eyebrow', text: 'Visit' }),
      el('h1', { text: 'Book the visit' }),
      el('p', { class: 'rw-muted', text: `${model.account.name} · ${model.account.season}` }),
    ),
  );
  const form = bookingForm(model, ctx, (appt) => showConfirmed(appt));
  root.append(form);
  container.replaceChildren(root);
}
