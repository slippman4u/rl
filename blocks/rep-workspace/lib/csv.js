/** CSV export helpers. Every cell is quoted and formula-looking cells are neutralised. */

// a byte-order mark makes Excel read the file as UTF-8
const BOM = String.fromCharCode(0xfeff);

/** Quote a cell; a leading `=`, `+`, `-` or `@` (or a control character) gets an apostrophe. */
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** @param {Array<Array<string|number>>} rows header row first */
export const toCsv = (rows) => `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;

/** Download text as a file through a Blob URL, which is revoked afterwards. */
export function downloadFile(filename, text, type) {
  const url = URL.createObjectURL(new Blob([BOM, text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
