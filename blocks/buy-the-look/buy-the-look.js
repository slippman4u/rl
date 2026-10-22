const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_QTY = 1;
const MAX_QTY = 99;

let instanceCount = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
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
  const svg = svgEl('svg', {
    viewBox: '0 0 24 24',
    width: '20',
    height: '20',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.5',
    'aria-hidden': 'true',
  });
  svg.append(svgEl('path', { d: 'M3.5 9h17l-1.6 11h-13.8L3.5 9zM8 9V7a4 4 0 0 1 8 0v2' }));
  return svg;
}

function incrementerIcon(type) {
  const svg = svgEl('svg', {
    width: '16',
    height: '16',
    viewBox: '4 2 20 20',
    fill: 'none',
    class: `dropin-icon dropin-icon--shape-stroke-1 dropin-incrementer__${type === 'minus' ? 'down' : 'add'}`,
    'aria-hidden': 'true',
  });
  if (type === 'minus') {
    svg.append(svgEl('path', {
      d: 'M17.3332 11.75H6.6665',
      'stroke-width': '1',
      'stroke-linecap': 'square',
      'stroke-linejoin': 'round',
      'vector-effect': 'non-scaling-stroke',
      fill: 'none',
      stroke: 'currentColor',
    }));
  } else {
    const group = svgEl('g', { transform: 'translate(9.734 9.737)' });
    group.append(
      svgEl('line', {
        y2: '12.7',
        transform: 'translate(2.216 -4.087)',
        'vector-effect': 'non-scaling-stroke',
        fill: 'none',
        stroke: 'currentColor',
      }),
      svgEl('line', {
        x2: '12.7',
        transform: 'translate(-4.079 2.263)',
        'vector-effect': 'non-scaling-stroke',
        fill: 'none',
        stroke: 'currentColor',
      }),
    );
    svg.append(group);
  }
  return svg;
}

/* Same markup and classes as the drop-in incrementer used in the grid. */
function buildIncrementer({ inputId, ariaLabel, onChange }) {
  const root = el('div', 'dropin-incrementer dropin-incrementer--medium');
  const content = el('div', 'dropin-incrementer__content dropin-incrementer__content--medium');

  const decContainer = el('div', 'dropin-incrementer__button-container');
  const decrease = el('button', 'dropin-incrementer__decrease-button');
  decrease.type = 'button';
  decrease.setAttribute('aria-label', 'Decrease Quantity');
  decrease.append(incrementerIcon('minus'));
  decContainer.append(decrease);

  const input = el('input', 'dropin-incrementer__input');
  input.id = inputId;
  input.type = 'number';
  input.min = String(MIN_QTY);
  input.max = String(MAX_QTY);
  input.step = '1';
  input.setAttribute('aria-label', ariaLabel);

  const incContainer = el('div', 'dropin-incrementer__button-container');
  const increase = el('button', 'dropin-incrementer__increase-button');
  increase.type = 'button';
  increase.setAttribute('aria-label', 'Increase Quantity');
  increase.append(incrementerIcon('plus'));
  incContainer.append(increase);

  content.append(decContainer, input, incContainer);
  root.append(content);

  let current = MIN_QTY;

  function paint() {
    input.value = String(current);
    input.setAttribute('aria-valuetext', String(current));
    decrease.disabled = current <= MIN_QTY;
    increase.disabled = current >= MAX_QTY;
  }

  function set(next) {
    const parsed = Number.isNaN(next) ? MIN_QTY : Math.trunc(next);
    current = Math.min(MAX_QTY, Math.max(MIN_QTY, parsed));
    paint();
    if (onChange) onChange(current);
  }

  decrease.addEventListener('click', () => set(current - 1));
  increase.addEventListener('click', () => set(current + 1));
  input.addEventListener('change', () => set(parseInt(input.value, 10)));

  paint();

  return {
    root,
    getValue: () => current,
    reset: () => set(MIN_QTY),
  };
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
  const heart = el('button', 'btl-heart', '♡');
  heart.type = 'button';
  heart.setAttribute('aria-label', `Save ${product.name} to wishlist`);
  heart.setAttribute('aria-pressed', 'false');
  heart.addEventListener('click', () => {
    const on = heart.getAttribute('aria-pressed') !== 'true';
    heart.setAttribute('aria-pressed', String(on));
    heart.textContent = on ? '♥' : '♡';
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

  const qtyId = `${id}-qty-${index}`;
  const qtyLabel = el('label', 'btl-label', 'Quantity:');
  qtyLabel.htmlFor = qtyId;
  const qty = buildIncrementer({
    inputId: qtyId,
    ariaLabel: `Quantity for ${product.name}`,
  });
  const qtyWrap = el('div', 'btl-quantity');
  qtyWrap.append(qty.root);
  info.append(qtyLabel, qtyWrap);

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
    const quantity = qty.getValue();
    clearTimeout(timer);
    addText.textContent = 'Added to Bag ✓';
    add.classList.add('is-added');
    status.textContent = `${quantity} x ${product.name} added to bag`;
    timer = setTimeout(() => {
      addText.textContent = 'Add to Bag';
      add.classList.remove('is-added');
      status.textContent = '';
      qty.reset();
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
