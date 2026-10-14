/** Helpers shared by the wedge and its drawer. */
import { el } from './dom.js';
import { effectiveUnits } from './data.js';
import {
  formatPercent, formatSigned, initialsOf, thumbnailUrl,
} from './format.js';

export const BAND = 5; // percent either side of target that still counts as on target
export const STATUS_LABELS = { carryover: 'Carryover', add: 'Add', drop: 'Drop' };

export const round2 = (n) => Math.round(n * 100) / 100;
export const pctOf = (variance, target) => (target > 0 ? (variance / target) * 100 : 0);

export function toneFor(pct) {
  if (pct > BAND) return 'over';
  if (pct < -BAND) return 'under';
  return 'on';
}

export function arrowFor(variance) {
  if (variance > 0) return '▲';
  if (variance < 0) return '▼';
  return '▶';
}

export const signedPct = (pct) => formatPercent(pct, { signed: true });

export function varianceText(t) {
  return `${arrowFor(t.variance)} ${formatSigned(t.variance)} (${signedPct(t.pct)})`;
}

/** Totals for a list of color rows, using the model's rules (dropped styles count zero). */
export function sumRows(rows) {
  const t = rows.reduce((acc, r) => {
    const units = effectiveUnits(r);
    return {
      units: acc.units + units,
      target: acc.target + r.targetUnits,
      lastYear: acc.lastYear + r.lastYearUnits,
      wholesale: acc.wholesale + units * r.wholesale,
      retail: acc.retail + units * r.retail,
    };
  }, {
    units: 0, target: 0, lastYear: 0, wholesale: 0, retail: 0,
  });
  const variance = t.units - t.target;
  return {
    ...t,
    wholesale: round2(t.wholesale),
    retail: round2(t.retail),
    variance,
    pct: pctOf(variance, t.target),
  };
}

export function swatchDot(color) {
  const dot = el('span', { class: 'rw-dot', 'aria-hidden': 'true' });
  dot.style.setProperty('background', color);
  return dot;
}

/**
 * The style image as a box: a resized rendition, then the original, then the style's initials.
 * @param {Object} tile
 * @param {{width: number, className: string}} opts rendition width and the box's class
 */
export function thumbBox(tile, { width, className }) {
  const wrap = el('div', { class: className });
  const placeholder = () => el('span', {
    class: 'rw-thumb-fallback', 'aria-hidden': 'true', text: initialsOf(tile.shortName),
  });
  if (!tile.imageUrl) {
    wrap.append(placeholder());
    return wrap;
  }
  const img = el('img', {
    src: thumbnailUrl(tile.imageUrl, width), alt: '', loading: 'lazy', width: '240', height: '300',
  });
  img.addEventListener('error', () => {
    // resized rendition failed: try the original once, then show the initials
    if (img.getAttribute('src') !== tile.imageUrl) img.src = tile.imageUrl;
    else img.replaceWith(placeholder());
  });
  wrap.append(img);
  return wrap;
}

/** Replace a host's children, skipping empty slots (a raw `null` would be rendered as text). */
export function fill(host, ...nodes) {
  host.replaceChildren(...nodes.flat().filter(Boolean));
}
