/** Display formatting for sheet values (ISO dates, 24-hour times). */

/** Local date from `YYYY-MM-DD`, or null when it does not parse. */
export function parseDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(iso, options = { weekday: 'long', month: 'long', day: 'numeric' }) {
  const date = parseDate(iso);
  return date ? date.toLocaleDateString('en-US', options) : String(iso);
}

/** `14:00` -> `2:00 PM`. */
export function formatTime(time) {
  const [h, m] = String(time).split(':').map(Number);
  if (Number.isNaN(h)) return String(time);
  const hour = h % 12 || 12;
  return `${hour}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Sortable key for an appointment or slot. */
export const whenKey = (item) => `${item.date}T${item.time}`;

export function greetingFor(hour) {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export const initialsOf = (name) => String(name)
  .split(/\s+/)
  .filter(Boolean)
  .map((part) => part[0])
  .slice(0, 2)
  .join('')
  .toUpperCase();

export const formatCount = (n) => Number(n).toLocaleString('en-US');

/** `28.57` -> `+29%` (signed) or `29%`; `decimals` keeps fractions. Uses a true minus sign. */
export function formatPercent(value, { signed = false, decimals = 0 } = {}) {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  if (rounded === 0) return '0%';
  let sign = '';
  if (rounded < 0) sign = '\u2212'; // true minus sign
  else if (signed) sign = '+';
  return `${sign}${Math.abs(rounded).toLocaleString('en-US', { maximumFractionDigits: decimals })}%`;
}

/** `150` -> `+150`, `-900` -> `−900`, `0` -> `0`. */
export function formatSigned(n) {
  if (n > 0) return `+${formatCount(n)}`;
  if (n < 0) return `\u2212${formatCount(-n)}`;
  return '0';
}

/**
 * Smaller rendition of an AEM Assets delivery image, the way the storefront requests them
 * (`<asset>/as/<name>.webp?width=...&quality=80`). Other URLs are returned unchanged.
 */
export function thumbnailUrl(url, width) {
  try {
    const parsed = new URL(url);
    if (!parsed.pathname.startsWith('/adobe/assets/urn:aaid:aem')) return url;
    return `${parsed.origin}${parsed.pathname}/as/thumbnail.webp?width=${width}&quality=80`;
  } catch (e) {
    return url;
  }
}

const pad2 = (n) => String(n).padStart(2, '0');

/** Local `YYYY-MM-DD` for a Date. */
export const isoDate = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export const addDays = (date, days) => new Date(
  date.getFullYear(),
  date.getMonth(),
  date.getDate() + days,
);

/** `November 2026` for a year and zero-based month. */
export const monthLabel = (year, month) => new Date(year, month, 1)
  .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

/** Local Date from an ISO date and a `HH:MM` time. */
export function startOf(iso, time) {
  const date = parseDate(iso) || new Date();
  const [h, m] = String(time).split(':').map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h || 0, m || 0);
}

/** `2:00 PM` for a Date. */
export const timeOf = (date) => formatTime(`${date.getHours()}:${pad2(date.getMinutes())}`);

/** Floating local time for iCalendar, e.g. `20261110T140000` (no zone, no `Z`). */
export const icsLocal = (d) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
  + `T${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;

const icsUtc = (d) => `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`
  + `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;

const icsEscape = (text) => String(text)
  .replace(/\\/g, '\\\\')
  .replace(/;/g, '\\;')
  .replace(/,/g, '\\,')
  .replace(/\r?\n/g, '\\n');

/**
 * A calendar file with one VEVENT in floating local time (DTEND from the duration).
 * @param {{uid: string, start: Date, durationMinutes: number, summary: string,
 *   location?: string, description?: string}} event
 */
export function buildIcs(event) {
  const end = new Date(event.start.getTime() + event.durationMinutes * 60000);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//rep-workspace//Showroom visit//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${icsEscape(event.uid)}@rep-workspace`,
    `DTSTAMP:${icsUtc(new Date())}`,
    `DTSTART:${icsLocal(event.start)}`,
    `DTEND:${icsLocal(end)}`,
    `SUMMARY:${icsEscape(event.summary)}`,
    event.location ? `LOCATION:${icsEscape(event.location)}` : null,
    event.description ? `DESCRIPTION:${icsEscape(event.description)}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].filter((line) => line !== null).join('\r\n');
}

/** Split a whole-number total across shares so the parts sum exactly (largest remainder). */
export function apportion(total, shares) {
  const quotas = shares.map((s) => total * s);
  const parts = quotas.map(Math.floor);
  const left = total - parts.reduce((a, b) => a + b, 0);
  quotas
    .map((q, i) => ({ i, frac: q - Math.floor(q) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
    .slice(0, left)
    .forEach(({ i }) => { parts[i] += 1; });
  return parts;
}

/** `751000` -> `$751,000` (whole amounts show no decimals). */
export function formatCurrency(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Fill a rows-by-columns grid of whole numbers whose row sums equal `rowTotals` and whose
 * column sums equal `colTotals` (both must add up to the same total). Each cell starts at the
 * floor of its proportional share; the remaining units go to the cells with the largest
 * remainders that still have room in both their row and their column.
 */
export function apportionMatrix(rowTotals, colTotals) {
  const sum = (list) => list.reduce((a, b) => a + b, 0);
  const total = sum(rowTotals);
  const ideal = rowTotals.map((r) => colTotals.map((c) => (total ? (r * c) / total : 0)));
  const grid = ideal.map((row) => row.map(Math.floor));
  const rowLeft = rowTotals.map((r, i) => r - sum(grid[i]));
  const colLeft = colTotals.map((c, j) => c - sum(grid.map((row) => row[j])));
  const order = ideal
    .flatMap((row, i) => row.map((v, j) => ({ i, j, frac: v - Math.floor(v) })))
    .sort((a, b) => b.frac - a.frac || a.i - b.i || a.j - b.j);
  for (let remaining = sum(rowLeft); remaining > 0; remaining -= 1) {
    // the best cell that still has room in both its row and its column
    const { i, j } = order.find((cell) => rowLeft[cell.i] > 0 && colLeft[cell.j] > 0);
    grid[i][j] += 1;
    rowLeft[i] -= 1;
    colLeft[j] -= 1;
  }
  return grid;
}
