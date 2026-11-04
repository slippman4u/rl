import { loadCSS } from '../../scripts/aem.js';
import decorateGrid from '../size-grid/size-grid.js';

/*
 * Size grid with paste: the same order grid as size-grid, plus the ability to paste quantities
 * copied from a spreadsheet.
 *   - Click any box and paste "0 1 1 1 4" (or cells copied from Excel) and the numbers fill that
 *     row, left to right, starting at the box you clicked. Several rows pasted at once fill the
 *     rows below too.
 *   - Or paste into the "Paste from your spreadsheet" box above the grid. If a row starts with a
 *     color name (Clubhouse Cream, Polo Black) the numbers go to that color.
 * It reuses size-grid for everything else, so Add to cart works the same way.
 */
const isNumber = (s) => /^\d+$/.test(String(s).trim());

function parse(text) {
  return String(text).replace(/\r/g, '').split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '')
    .map((line) => {
      const cells = line.includes('\t')
        ? line.split('\t').map((c) => c.trim())
        : line.trim().split(/[,\s]+/);
      let label = '';
      if (cells.length > 1 && !isNumber(cells[0])) label = cells.shift();
      return { label, values: cells };
    });
}

export default async function decorate(block) {
  block.classList.add('size-grid');
  await loadCSS(`${window.hlx?.codeBasePath || ''}/blocks/size-grid/size-grid.css`);
  await decorateGrid(block);

  const table = block.querySelector('.size-grid-table');
  if (!table) return;
  const message = block.querySelector('.size-grid-message');
  const rows = [...table.querySelectorAll('tbody tr:not(.size-grid-footer)')];
  const setMessage = (text, ok = true) => {
    if (!message) return;
    message.className = `size-grid-message ${ok ? 'is-ok' : 'is-error'}`;
    message.textContent = text;
  };

  const rowByLabel = (label) => rows.findIndex((tr) => tr.cells[0].textContent.trim().toLowerCase()
    .includes(label.trim().toLowerCase()));

  // put values into row `r`, starting at size column `c`; returns how many boxes were filled
  function fill(r, c, values) {
    let n = 0;
    values.forEach((v, i) => {
      const input = rows[r]?.cells[c + i + 1]?.querySelector('input');
      if (!input || !isNumber(v)) return;
      input.value = String(Number(v));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      n += 1;
    });
    return n;
  }

  function apply(lines, startRow, startCol) {
    let filled = 0;
    let r = startRow;
    lines.forEach((line) => {
      if (line.label) {
        const at = rowByLabel(line.label);
        if (at >= 0) filled += fill(at, startCol, line.values);
        return; // header or unknown label rows are skipped
      }
      if (r < rows.length) filled += fill(r, startCol, line.values);
      r += 1;
    });
    return filled;
  }

  // 1. paste straight into a box
  table.addEventListener('paste', (e) => {
    const input = e.target.closest('.size-grid-qty');
    if (!input) return;
    const text = e.clipboardData?.getData('text') || '';
    const lines = parse(text);
    if (!lines.length || (lines.length === 1 && lines[0].values.length < 2 && !lines[0].label)) return;
    e.preventDefault();
    const td = input.closest('td');
    const r = rows.indexOf(td.parentElement);
    const c = td.cellIndex - 1;
    const n = apply(lines, r, c);
    setMessage(n ? `Pasted ${n} quantit${n === 1 ? 'y' : 'ies'}.` : 'Nothing to paste. Copy numbers like 0 1 1 1 4.', n > 0);
  });

  // 2. a dedicated paste box above the grid
  const wrap = document.createElement('div');
  wrap.className = 'size-grid-paste';
  const label = document.createElement('label');
  label.textContent = 'Paste from your spreadsheet';
  const area = document.createElement('textarea');
  area.rows = 2;
  area.placeholder = 'Copy a row of quantities (S, M, L, XL, XXL) from Excel and paste here, e.g. 0 1 1 1 4';
  label.append(area);
  wrap.append(label);
  block.querySelector('.size-grid-scroll')?.before(wrap);
  area.addEventListener('paste', (e) => {
    e.preventDefault();
    const n = apply(parse(e.clipboardData?.getData('text') || ''), 0, 0);
    area.value = '';
    setMessage(n ? `Pasted ${n} quantit${n === 1 ? 'y' : 'ies'}. Check the grid, then Add to cart.` : 'Nothing to paste. Copy numbers like 0 1 1 1 4.', n > 0);
  });
}
