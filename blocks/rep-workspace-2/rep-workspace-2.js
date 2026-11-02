// Must stay the first import: it points the original code at the second data sheet
// and gives this copy its own saved state.
import './lib/namespace.js';
import { loadCSS } from '../../scripts/aem.js';
import decorateOriginal from '../rep-workspace/rep-workspace.js';
import {
  getCommit, setStatus, clearCommit, onCommitChange, dateText,
} from '../../scripts/plan-commit.js';

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

const moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * A strip above the workspace that shows when the buyer has committed their planned assortment,
 * with Confirm and Ask for changes. It sits outside the block so the original code never removes it.
 */
function planStatus(block) {
  const bar = document.createElement('div');
  bar.className = 'rw2-plan';
  bar.hidden = true;
  block.before(bar);

  const text = (tag, cls, value) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    n.textContent = value;
    return n;
  };
  const button = (label, cls, onClick) => {
    const b = text('button', `rw2-plan-btn ${cls}`, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };

  function draw(c) {
    if (!c) { bar.hidden = true; return; }
    const who = c.account || 'The buyer';
    const facts = `${c.styles} styles · ${c.units.toLocaleString('en-US')} units · ${moneyFmt.format(c.retail)} retail`;
    const parts = [];
    if (c.status === 'submitted') {
      parts.push(
        text('span', 'rw2-plan-state', 'Plan committed'),
        text('span', 'rw2-plan-text', `${who} committed the ${c.season || 'season'} plan on ${dateText(c.at)}. ${facts}. Ref ${c.ref}.`),
        button('Confirm plan', 'is-primary', () => setStatus('confirmed')),
        button('Ask for changes', '', () => {
          const note = window.prompt('What should change?', '') || '';
          setStatus('changes', note.trim());
        }),
      );
    } else if (c.status === 'changes') {
      parts.push(
        text('span', 'rw2-plan-state', 'Changes requested'),
        text('span', 'rw2-plan-text', `${who} has been asked to revise the plan${c.note ? `: ${c.note}` : ''}. Ref ${c.ref}.`),
        button('Reset demo', '', () => clearCommit()),
      );
    } else {
      parts.push(
        text('span', 'rw2-plan-state is-ok', 'Plan confirmed'),
        text('span', 'rw2-plan-text', `${who} · ${c.season || 'season'} plan confirmed ${dateText(c.updatedAt)}. ${facts}. Ref ${c.ref}.`),
        button('Reset demo', '', () => clearCommit()),
      );
    }
    bar.replaceChildren(...parts);
    bar.hidden = false;
  }

  draw(getCommit());
  onCommitChange(draw);
}

export default async function decorate(block) {
  planStatus(block);

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
