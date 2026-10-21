let instanceCount = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function getText(cell) {
  return cell ? cell.textContent.trim() : '';
}

function clonePicture(source, alt) {
  if (!source) return null;
  const picture = source.cloneNode(true);
  const img = picture.querySelector('img');
  if (img) img.alt = alt;
  return picture;
}

function bagIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M3.5 9h17l-1.6 11h-13.8L3.5 9zM8 9V7a4 4 0 0 1 8 0v2');
  svg.append(path);
  return svg;
}

function parseProducts(rows) {
  return rows
    .map((row) => {
      const [
        imageCell, nameCell, priceCell, colorCell, optionsCell, labelCell,
      ] = [...row.children];
      return {
        picture: imageCell ? imageCell.querySelector('picture') : null,
        name: getText(nameCell),
        price: getText(priceCell),
        color: getText(colorCell),
        options: getText(optionsCell).split(',').map((s) => s.trim()).filter(Boolean),
        label: getText(labelCell) || 'Size',
      };
    })
    .filter((product) => product.name);
}

function buildProduct(product, index, id) {
  const panel = el('div', 'btl-product');
  panel.id = `${id}-product-${index}`;

  const media = el('div', 'btl-product-media');
  const picture = clonePicture(product.picture, product.name);
  if (picture) media.append(picture);
  const heart = el('button', 'btl-heart', '\u2661');
  heart.type = 'button';
  heart.setAttribute('aria-label', `Save ${product.name} to wishlist`);
  heart.setAttribute('aria-pressed', 'false');
  heart.addEventListener('click', () => {
    const on = heart.getAttribute('aria-pressed') !== 'true';
    heart.setAttribute('aria-pressed', String(on));
    heart.textContent = on ? '\u2665' : '\u2661';
  });
  media.append(heart);

  const info = el('div', 'btl-product-info');
  info.append(el('p', 'btl-name', product.name));
  if (product.price) info.append(el('p', 'btl-price', product.price));
  if (product.color) {
    const color = el('p', 'btl-color');
    color.append(el('span', 'btl-label', 'Color: '), product.color);
    info.append(color);
  }

  let select = null;
  let error = null;
  if (product.options.length) {
    const selectId = `${id}-option-${index}`;
    const label = el('label', 'btl-label', `${product.label}:`);
    label.htmlFor = selectId;
    select = el('select', 'btl-select');
    select.id = selectId;
    select.append(new Option('Please select', ''));
    product.options.forEach((option) => select.append(new Option(option, option)));
    error = el('p', 'btl-error', `Please select a ${product.label.toLowerCase()}`);
    error.setAttribute('role', 'alert');
    error.hidden = true;
    select.addEventListener('change', () => { error.hidden = true; });
    info.append(label, select, error);
  }

  const status = el('p', 'btl-status');
  status.setAttribute('role', 'status');
  const add = el('button', 'btl-add');
  add.type = 'button';
  const addText = el('span', 'btl-add-text', 'Add to Bag');
  add.append(bagIcon(), addText);
  let timer;
  add.addEventListener('click', () => {
    if (select && !select.value) {
      error.hidden = false;
      select.focus();
      return;
    }
    clearTimeout(timer);
    addText.textContent = 'Added to Bag \u2713';
    add.classList.add('is-added');
    status.textContent = `${product.name} added to bag`;
    timer = setTimeout(() => {
      addText.textContent = 'Add to Bag';
      add.classList.remove('is-added');
      status.textContent = '';
    }, 2500);
  });

  const similar = el('button', 'btl-similar', 'See Similar');
  similar.type = 'button';

  const actions = el('div', 'btl-actions');
  actions.append(add, similar);
  info.append(actions, status);
  panel.append(media, info);
  return panel;
}

export default function decorate(block) {
  instanceCount += 1;
  const id = `btl-${instanceCount}`;

  const [headerRow, mainRow, ...productRows] = [...block.children];
  const headerCells = headerRow ? [...headerRow.children] : [];
  const title = getText(headerCells[0]);
  const subtitle = getText(headerCells[1]);
  const mainPicture = mainRow ? mainRow.querySelector('picture') : null;
  const products = parseProducts(productRows);

  block.textContent = '';
  if (!products.length) return;

  const header = el('div', 'btl-header');
  const heading = el('div', 'btl-heading');
  if (title) heading.append(el('h2', 'btl-title', title));
  if (subtitle) heading.append(el('p', 'btl-subtitle', subtitle));
  const count = `${products.length} ${products.length === 1 ? 'item' : 'items'}`;
  header.append(heading, el('p', 'btl-count', count));

  const body = el('div', 'btl-body');
  if (mainPicture) {
    const main = el('div', 'btl-main');
    const picture = clonePicture(mainPicture, title || 'Model wearing the full look');
    if (picture) main.append(picture);
    body.append(main);
  } else {
    body.classList.add('btl-no-main');
  }

  const panel = el('div', 'btl-panel');
  const thumbs = el('div', 'btl-thumbs');
  thumbs.setAttribute('role', 'group');
  thumbs.setAttribute('aria-label', 'Products in this look');
  const details = el('div', 'btl-details');

  const thumbButtons = [];
  const productPanels = [];

  function show(selected) {
    thumbButtons.forEach((btn, i) => btn.setAttribute('aria-pressed', String(i === selected)));
    productPanels.forEach((p, i) => { p.hidden = i !== selected; });
  }

  products.forEach((product, i) => {
    const productPanel = buildProduct(product, i, id);
    productPanels.push(productPanel);
    details.append(productPanel);

    const thumb = el('button', 'btl-thumb');
    thumb.type = 'button';
    thumb.setAttribute('aria-label', product.name);
    thumb.setAttribute('aria-controls', productPanel.id);
    const thumbPicture = clonePicture(product.picture, '');
    if (thumbPicture) thumb.append(thumbPicture);
    thumb.addEventListener('click', () => show(i));
    thumbButtons.push(thumb);
    thumbs.append(thumb);
  });

  panel.append(thumbs, details);
  body.append(panel);
  block.append(header, body);
  show(0);
}
