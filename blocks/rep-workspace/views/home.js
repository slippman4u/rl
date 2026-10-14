import { el, icon } from '../lib/dom.js';
import {
  formatDate, formatTime, whenKey, greetingFor, initialsOf,
} from '../lib/format.js';

const JOURNEY = [
  { stage: 'prepare', label: 'Prepare the account', href: '#/account/acme' },
  { stage: 'visit', label: 'Shape the visit', href: '#/appointment' },
  { stage: 'present', label: 'Tell the collection story', href: '#/wedge' },
  { stage: 'commit', label: 'Commit the order', href: '#/commit' },
];

const APPOINTMENT_STATUS = {
  tentative: { label: 'Tentative hold', tone: 'tentative' },
  confirmed: { label: 'Confirmed', tone: 'confirmed' },
};

const ACCOUNT_STATUS_TONE = {
  'plan received': 'plan',
  'order draft': 'draft',
  committed: 'committed',
};

const UPCOMING_COUNT = 5;

let unsubscribe;

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function appointmentChip(status) {
  const known = APPOINTMENT_STATUS[String(status).toLowerCase()];
  return el('span', {
    class: 'rw-pill',
    'data-tone': known ? known.tone : 'neutral',
    text: known ? known.label : capitalise(String(status)),
  });
}

function journeyStrip(ctx) {
  const done = JOURNEY.map((step) => ctx.isDone(step.stage));
  const activeIndex = done.indexOf(false); // the first step that is not done
  return el(
    'ol',
    { class: 'rw-journey', 'aria-label': 'Your journey' },
    JOURNEY.map((step, i) => el(
      'li',
      {},
      el(
        'a',
        {
          class: 'rw-step',
          href: step.href,
          'data-done': String(done[i]),
          'data-active': String(i === activeIndex),
          'aria-current': i === activeIndex ? 'step' : null,
        },
        el('span', { class: 'rw-step-num', 'aria-hidden': 'true', text: String(i + 1) }),
        el('span', { class: 'rw-step-label', text: step.label }),
        done[i] ? el('span', { class: 'rw-step-check' }, icon('check'), el('span', { class: 'rw-sr', text: 'Done' })) : null,
      ),
    )),
  );
}

function attendee(name, role) {
  return el(
    'li',
    { class: 'rw-attendee' },
    el('span', { class: 'rw-avatar-chip', 'aria-hidden': 'true', text: initialsOf(name) }),
    el('span', { class: 'rw-attendee-text' }, el('strong', { text: name }), el('small', { text: role })),
  );
}

function featuredCard(model, ctx, appointment) {
  if (!appointment) {
    return el(
      'section',
      { class: 'rw-card rw-featured', 'aria-labelledby': 'rw-featured-title' },
      el('p', { class: 'rw-eyebrow', text: `${model.account.name} appointment` }),
      el('h2', { id: 'rw-featured-title', text: 'No visit booked yet' }),
      el('div', { class: 'rw-actions' }, el('a', { class: 'rw-button', href: '#/appointment', text: 'Book a visit' })),
    );
  }
  const { showroomContact, buyerName } = model.account;
  const attendees = [
    [showroomContact.name, 'Showroom contact'],
    [buyerName, 'Buyer'],
    [model.rep.name, 'Sales representative'],
  ].filter(([name]) => name);

  const startVisit = el('button', { class: 'rw-button', type: 'button', text: 'Start visit' });
  startVisit.addEventListener('click', () => {
    ctx.setPresentation(true);
    ctx.navigate('#/wedge');
  });

  return el(
    'section',
    { class: 'rw-card rw-featured', 'aria-labelledby': 'rw-featured-title' },
    el(
      'div',
      { class: 'rw-featured-head' },
      el('p', { class: 'rw-eyebrow', text: `${model.account.name} appointment` }),
      appointmentChip(appointment.status),
    ),
    el('h2', { id: 'rw-featured-title', text: formatDate(appointment.date) }),
    el('p', { class: 'rw-featured-time', text: formatTime(appointment.time) }),
    el(
      'dl',
      { class: 'rw-facts' },
      el('div', {}, el('dt', { text: 'Showroom' }), el('dd', { text: appointment.showroom })),
      el('div', {}, el('dt', { text: 'Visit type' }), el('dd', { text: appointment.type })),
    ),
    el('ul', { class: 'rw-attendees', 'aria-label': 'Attendees' }, attendees.map(([name, role]) => attendee(name, role))),
    el(
      'div',
      { class: 'rw-actions' },
      el('a', { class: 'rw-button rw-button-outline', href: '#/account/acme', text: 'Open account' }),
      startVisit,
    ),
  );
}

function accountsList(model) {
  return el(
    'section',
    { class: 'rw-card', 'aria-labelledby': 'rw-accounts-title' },
    el('h2', { id: 'rw-accounts-title', text: 'Your accounts' }),
    el(
      'ul',
      { class: 'rw-accounts' },
      model.accounts.map((account) => {
        const selectable = account.id === model.account.id;
        const tone = ACCOUNT_STATUS_TONE[account.status.toLowerCase()] || 'neutral';
        const body = [
          el('span', { class: 'rw-account-text' }, el('strong', { text: account.name }), el('small', { text: account.nextStep })),
          el('span', { class: 'rw-pill', 'data-tone': tone, text: account.status }),
        ];
        return el(
          'li',
          {},
          selectable
            ? el('a', { class: 'rw-account', href: '#/account/acme' }, body)
            : el(
              'span',
              {
                class: 'rw-account', 'aria-disabled': 'true', tabindex: '0', 'data-tooltip': 'Not part of this demo',
              },
              body,
            ),
        );
      }),
    ),
  );
}

function upcomingVisits(model, visits) {
  return el(
    'section',
    { class: 'rw-card', 'aria-labelledby': 'rw-upcoming-title' },
    el('h2', { id: 'rw-upcoming-title', text: 'Upcoming visits' }),
    visits.length
      ? el(
        'ol',
        { class: 'rw-visits' },
        visits.map((visit) => el(
          'li',
          { class: 'rw-visit', 'data-own': String(visit.account === model.account.name) },
          el(
            'span',
            { class: 'rw-visit-date' },
            el('strong', { text: formatDate(visit.date, { day: 'numeric' }) }),
            el('small', { text: formatDate(visit.date, { month: 'short' }) }),
          ),
          el(
            'span',
            { class: 'rw-visit-text' },
            el('strong', { text: visit.account }),
            el('small', { text: `${formatDate(visit.date, { weekday: 'short' })} ${formatTime(visit.time)} · ${visit.showroom}` }),
            el('small', { text: visit.type }),
          ),
          appointmentChip(visit.status),
        )),
      )
      : el('p', { class: 'rw-muted', text: 'No visits are booked.' }),
  );
}

function sourceLine(model) {
  const { cached, fetchedAt } = model.source;
  const when = new Date(fetchedAt).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  return el('p', {
    class: 'rw-home-source',
    text: cached
      ? `Cached product data from ${when}. The live catalog was unavailable.`
      : `Live catalog data, loaded ${when}.`,
  });
}

function build(model, ctx) {
  const now = new Date();
  const visits = model.appointments
    .filter((a) => a.status !== 'cancelled')
    .sort((a, b) => whenKey(a).localeCompare(whenKey(b)));
  const featured = visits.find((a) => a.account === model.account.name);
  const showroom = featured?.showroom || visits[0]?.showroom || '';
  const firstName = model.rep.name.split(/\s+/)[0];

  return el(
    'div',
    { class: 'rw-home' },
    el(
      'div',
      { class: 'rw-greeting' },
      el('h1', { text: `${greetingFor(now.getHours())}, ${firstName}` }),
      el('p', {
        class: 'rw-greeting-sub',
        text: [now.toLocaleDateString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
        }), showroom ? `${showroom} showroom` : ''].filter(Boolean).join(' · '),
      }),
    ),
    journeyStrip(ctx),
    featuredCard(model, ctx, featured),
    el('div', { class: 'rw-home-grid' }, accountsList(model), upcomingVisits(model, visits.slice(0, UPCOMING_COUNT))),
    sourceLine(model),
  );
}

export function render(container, model, ctx) {
  const paint = () => container.replaceChildren(build(model, ctx));
  paint();
  // appointments change when the visit is booked or confirmed elsewhere
  unsubscribe = model.subscribe(paint);
}

export function destroy() {
  if (unsubscribe) unsubscribe();
  unsubscribe = undefined;
}
