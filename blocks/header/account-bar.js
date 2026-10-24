import { events } from '@dropins/tools/event-bus.js';
import { CORE_FETCH_GRAPHQL } from '../../scripts/commerce.js';

/*
 * Account bar: a slim strip above the main nav, shown only when the buyer is signed in.
 * - Login state comes from the "authenticated" event (no network call, no reCAPTCHA).
 * - Company name, first name and credit come from three small READ queries (reCAPTCHA
 *   only protects forms such as sign in). Any query that fails falls back to the demo values.
 * Edit the demo values below.
 */
const FALLBACK_COMPANY = 'Acme';
const SEASON_TEXT = 'Season: Fall 2027';
const WINDOW_TEXT = 'Order window closes Dec 15';
const MOCK_CREDIT = 250000; // used only if the real credit query returns nothing

const money = (value, currency = 'USD') => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch (e) {
    return `$${Math.round(value)}`;
  }
};

async function gql(query) {
  try {
    const res = await CORE_FETCH_GRAPHQL.fetchGraphQl(query);
    return res?.data ?? null;
  } catch (e) {
    return null;
  }
}

async function loadInfo() {
  let ctx = '';
  try { ctx = sessionStorage.getItem('DROPIN__COMPANYSWITCHER__COMPANY__CONTEXT') || ''; } catch (e) { /* ignore */ }
  const key = `rl-account-bar:${ctx}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (cached && cached.company) return cached;
  } catch (e) { /* ignore */ }

  const [who, co, credit] = await Promise.all([
    gql('{ customer { firstname } }'),
    gql('{ company { name } }'),
    gql('{ company { credit { available_credit { currency value } } } }'),
  ]);

  const avail = credit?.company?.credit?.available_credit;
  const info = {
    company: String(co?.company?.name || FALLBACK_COMPANY),
    first: String(who?.customer?.firstname || ''),
    credit: avail && Number.isFinite(Number(avail.value))
      ? money(Number(avail.value), avail.currency || 'USD')
      : money(MOCK_CREDIT),
  };
  // Only remember a real answer, so a failed lookup is retried on the next page.
  if (co?.company?.name) {
    try { sessionStorage.setItem(key, JSON.stringify(info)); } catch (e) { /* ignore */ }
  }
  return info;
}

function part(text, cls) {
  const s = document.createElement('span');
  if (cls) s.className = cls;
  s.textContent = text;
  return s;
}

function fill(bar, info) {
  const inner = document.createElement('div');
  inner.className = 'account-bar-inner';
  inner.append(
    part(info.company, 'account-bar-company'),
    part(info.first ? `Welcome back, ${info.first}` : 'Welcome back', 'account-bar-item'),
    part(SEASON_TEXT, 'account-bar-item account-bar-extra'),
    part(WINDOW_TEXT, 'account-bar-item account-bar-extra'),
    part(`Credit available ${info.credit}`, 'account-bar-item account-bar-extra'),
  );
  bar.replaceChildren(inner);
}

export default function renderAccountBar(block) {
  if (!block || block.querySelector('.account-bar')) return;

  const bar = document.createElement('div');
  bar.className = 'account-bar';
  bar.hidden = true;
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Account');
  block.prepend(bar);

  let loadedFor = false;
  events.on('authenticated', async (isAuthenticated) => {
    if (!isAuthenticated) {
      bar.hidden = true;
      bar.replaceChildren();
      loadedFor = false;
      return;
    }
    if (loadedFor) {
      bar.hidden = false;
      return;
    }
    loadedFor = true;
    const info = await loadInfo();
    fill(bar, info);
    bar.hidden = false;
  }, { eager: true });
}
