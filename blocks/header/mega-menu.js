import { loadCSS } from '../../scripts/aem.js';

loadCSS(`${window.hlx?.codeBasePath ?? ''}/blocks/header/mega-menu.css`);

const SHORTCUT_LABELS = ['shortcuts', 'buyer shortcuts'];
const FEATURE_LABELS = ['featured', 'feature'];

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v === false || v === null || v === undefined) return;
    if (k === 'class') n.className = v;
    else n.setAttribute(k, v === true ? '' : v);
  });
  kids.flat().forEach((c) => {
    if (c === null || c === undefined || c === false) return;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  });
  return n;
}

/** Only allow site-relative and http(s) links. */
function safeHref(href) {
  if (!href) return '';
  try {
    const u = new URL(href, window.location.href);
    return ['http:', 'https:'].includes(u.protocol) ? href : '';
  } catch (e) {
    return '';
  }
}

/** Reads one authored list item: its label, link and nested list. */
function parseItem(li) {
  const sub = li.querySelector(':scope > ul');
  const anchor = li.querySelector(':scope > a') || li.querySelector(':scope > p > a');
  let label = '';
  if (anchor) {
    label = anchor.textContent.trim();
  } else {
    label = [...li.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').trim();
    if (!label) label = li.querySelector(':scope > p')?.textContent.trim() || '';
  }
  return {
    li, sub, label, href: safeHref(anchor?.getAttribute('href')),
  };
}

function linkOrText(item, cls) {
  return item.href
    ? el('a', { href: item.href, class: cls }, item.label)
    : el('span', { class: cls }, item.label);
}

function linkList(ul, cls) {
  return el('ul', { class: cls },
    [...ul.children].map(parseItem).filter((i) => i.label).map((i) => el('li', {}, linkOrText(i, 'mega-link'))));
}

function buildFeature(item) {
  const pic = item.li.querySelector('picture') || item.li.querySelector('img');
  const anchor = item.li.querySelector('a');
  const href = safeHref(anchor?.getAttribute('href'));
  const caption = anchor?.textContent.trim() || '';
  if (!pic && !caption) return null;
  const inner = [pic ? el('div', { class: 'mega-feature-media' }, pic.cloneNode(true)) : null,
    caption ? el('span', { class: 'mega-feature-caption' }, caption) : null];
  return href
    ? el('a', { href, class: 'mega-feature' }, inner)
    : el('div', { class: 'mega-feature' }, inner);
}

/**
 * Builds a mega menu panel from an authored nav section.
 * Authoring pattern (nested lists under a top-level item such as "Catalog"):
 *   Category           -> Column heading -> links
 *   "Shortcuts"        -> shown as the buyer shortcuts column
 *   "Featured"         -> image + link, shown as the feature tile
 * If no categories are found, the original dropdown is left as is.
 */
export default function buildMegaMenu(navSection) {
  const sourceList = navSection.querySelector('.submenu-wrapper > ul');
  if (!sourceList) return;

  const cats = [];
  let shortcuts = null;
  let feature = null;
  [...sourceList.children].map(parseItem).forEach((item) => {
    const key = item.label.toLowerCase();
    if (SHORTCUT_LABELS.includes(key) && item.sub) shortcuts = item;
    else if (FEATURE_LABELS.includes(key)) feature = item;
    else if (item.label) cats.push(item);
  });
  if (!cats.length) return;

  const catList = el('ul', { class: 'mega-cats' });
  const subWrap = el('div', { class: 'mega-subs' });
  const catEls = [];
  const subEls = [];

  const activate = (idx) => {
    catEls.forEach((c, i) => {
      c.classList.toggle('is-active', i === idx);
      if (i === idx) c.setAttribute('aria-current', 'true'); else c.removeAttribute('aria-current');
    });
    subEls.forEach((s, i) => { s.hidden = i !== idx; });
  };

  cats.forEach((cat, idx) => {
    const control = cat.href
      ? el('a', { href: cat.href, class: 'mega-cat' }, cat.label)
      : el('button', { type: 'button', class: 'mega-cat' }, cat.label);
    control.addEventListener('mouseenter', () => activate(idx));
    control.addEventListener('focus', () => activate(idx));
    catEls.push(control);
    catList.append(el('li', {}, control));

    const cols = [];
    const loose = [];
    if (cat.sub) {
      [...cat.sub.children].map(parseItem).filter((i) => i.label).forEach((child) => {
        if (child.sub) {
          cols.push(el('div', { class: 'mega-col' },
            el('p', { class: 'mega-heading' }, child.href ? el('a', { href: child.href }, child.label) : child.label),
            linkList(child.sub, 'mega-links')));
        } else {
          loose.push(el('li', {}, linkOrText(child, 'mega-link')));
        }
      });
    }
    if (loose.length) cols.unshift(el('div', { class: 'mega-col' }, el('p', { class: 'mega-heading' }, 'Shop'), el('ul', { class: 'mega-links' }, loose)));
    const sub = el('div', { class: 'mega-sub', hidden: true },
      el('div', { class: 'mega-cols' }, cols),
      cat.href ? el('a', { href: cat.href, class: 'mega-all' }, `View all ${cat.label}`) : null);
    subEls.push(sub);
    subWrap.append(sub);
  });

  const inner = el('div', { class: 'mega-inner' }, el('div', { class: 'mega-nav' }, catList), subWrap);

  if (shortcuts) {
    inner.append(el('div', { class: 'mega-shortcuts' },
      el('p', { class: 'mega-heading' }, shortcuts.label),
      linkList(shortcuts.sub, 'mega-links')));
  }
  const featureEl = feature ? buildFeature(feature) : null;
  if (featureEl) inner.append(el('div', { class: 'mega-feature-wrap' }, featureEl));
  if (!shortcuts) inner.classList.add('no-shortcuts');
  if (!featureEl) inner.classList.add('no-feature');

  activate(0);
  navSection.classList.add('has-mega');
  navSection.append(el('div', { class: 'mega-panel' }, inner));
}
