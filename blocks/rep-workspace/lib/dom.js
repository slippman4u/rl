/**
 * Tiny DOM helpers. Everything is built with createElement and textContent;
 * string children become text nodes, never markup.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {string} tag
 * @param {Object} [attrs] `text` sets textContent, `onclick`-style keys add listeners,
 *   everything else becomes an attribute (false/null/undefined are skipped, true is empty).
 * @param {...(Node|string|null|Array)} children
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === undefined || value === null || value === false) return;
    if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : value);
  });
  children.flat().filter((child) => child !== null && child !== undefined && child !== false)
    .forEach((child) => node.append(child));
  return node;
}

/** 24x24 stroke icons, as path data. */
const ICONS = {
  home: 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6',
  prepare: 'M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1zM6 6h12v15H6zM9 13l2 2 4-4',
  visit: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  present: 'M3 4h18v12H3zM8 20h8M12 16v4',
  commit: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12l3 3 5-6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
};

/** @param {keyof ICONS} name */
export function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('rw-icon');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}
