// Must stay the first import: it points the original code at the second data sheet
// and gives this copy its own saved state.
import './lib/namespace.js';
import { loadCSS } from '../../scripts/aem.js';
import decorateOriginal from '../rep-workspace/rep-workspace.js';

/*
 * Rep Workspace 2: starts as a re-skin of the original rep-workspace block.
 * It reuses the original views and styles, then layers the Ralph Lauren look on top
 * (rep-workspace-2.css). To change a screen, copy that one file from
 * blocks/rep-workspace/views into this folder's views/ folder and point ROUTES at it.
 */

// Words changed for this version. Only a label that is exactly one of these is replaced.
const RELABEL = {
  'picture wedge': 'Grid view',
  'data wedge': 'List view',
};

function relabel(root) {
  root.querySelectorAll('button, a, span, h1, h2, h3, h4, label, option, legend, dt, th, li, p')
    .forEach((node) => {
      if (node.childElementCount) return;
      const next = RELABEL[node.textContent.trim().toLowerCase()];
      if (next && node.textContent !== next) node.textContent = next;
    });
  root.querySelectorAll('[aria-label]').forEach((node) => {
    if (node.getAttribute('aria-label') === 'Wedge view') node.setAttribute('aria-label', 'View');
  });
}

export default async function decorate(block) {
  // the original stylesheet is written for ".rep-workspace", so give the block that class too
  block.classList.add('rep-workspace');

  // keep the new wording in place as screens are drawn
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      relabel(block);
    });
  }).observe(block, { childList: true, subtree: true });

  await loadCSS(`${window.hlx?.codeBasePath || ''}/blocks/rep-workspace/rep-workspace.css`);
  return decorateOriginal(block);
}
