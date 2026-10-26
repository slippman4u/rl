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
export default async function decorate(block) {
  // the original stylesheet is written for ".rep-workspace", so give the block that class too
  block.classList.add('rep-workspace');
  await loadCSS(`${window.hlx?.codeBasePath || ''}/blocks/rep-workspace/rep-workspace.css`);
  return decorateOriginal(block);
}
