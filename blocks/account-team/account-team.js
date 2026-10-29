/*
 * Account team card: your rep, with a photo and ways to reach them.
 *
 * Block table, one row per field (field name in the left cell):
 *   Photo     the picture (insert an image in the right cell)
 *   Name      Sofia Alvarez
 *   Title     Senior Account Executive, Wholesale
 *   Phone     555-555-5555
 *   Email     salvarez@adobedemo.com
 *   Button    label of the email button (optional, default "Email <first name>")
 *   Note      small line under the buttons (optional)
 *   Label     small heading above the name (optional, default "Your account team")
 */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export default function decorate(block) {
  const fields = {};
  let picture = null;
  [...block.children].forEach((row) => {
    const [keyCell, valueCell] = [...row.children];
    if (!keyCell || !valueCell) return;
    const key = keyCell.textContent.trim().toLowerCase();
    if (key === 'photo') picture = valueCell.querySelector('picture') || valueCell.querySelector('img');
    else fields[key] = valueCell.textContent.trim();
  });

  const name = fields.name || '';
  const first = name.split(/\s+/)[0] || 'your rep';
  const phone = fields.phone || '';
  const email = EMAIL.test(fields.email || '') ? fields.email : '';

  const card = el('div', 'at-card');

  if (picture) {
    const photo = el('div', 'at-photo');
    photo.append(picture);
    const img = photo.querySelector('img');
    if (img && !img.alt) img.alt = name || 'Account representative';
    card.append(photo);
  }

  const body = el('div', 'at-body');
  body.append(el('p', 'at-label', fields.label || 'Your account team'));
  if (name) body.append(el('h2', 'at-name', name));
  if (fields.title) body.append(el('p', 'at-title', fields.title));

  const lines = el('ul', 'at-lines');
  if (phone) {
    const li = el('li');
    const a = el('a', '', phone);
    a.href = `tel:${phone.replace(/[^\d+]/g, '')}`;
    li.append(a);
    lines.append(li);
  }
  if (email) {
    const li = el('li');
    const a = el('a', '', email);
    a.href = `mailto:${email}`;
    li.append(a);
    lines.append(li);
  }
  if (lines.children.length) body.append(lines);

  if (email) {
    const actions = el('div', 'at-actions');
    const button = el('a', 'at-button', fields.button || `Email ${first}`);
    button.href = `mailto:${email}`;
    actions.append(button);
    body.append(actions);
  }
  if (fields.note) body.append(el('p', 'at-note', fields.note));

  card.append(body);
  block.textContent = '';
  block.append(card);
}
