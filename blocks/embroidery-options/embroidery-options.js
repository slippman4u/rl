import { toClassName } from '../../scripts/aem.js';

const QUANTITY_SELECTOR = '.product-details__quantity';
const INSERTION_WAIT_MS = 5000;

/**
 * Groups the authored key/value rows into field definitions. A new field
 * starts each time a "field-type" row is encountered; any row before the
 * first field-type (or an unrecognized key, e.g. gate-add-to-cart, which
 * this display-only block doesn't act on) is ignored.
 */
function parseFields(block) {
  const rows = [...block.querySelectorAll(':scope > div')];
  const fields = [];
  let current = null;

  rows.forEach((row) => {
    const cells = [...row.children];
    if (cells.length < 2) return;

    const key = toClassName(cells[0].textContent);
    const value = cells[1].textContent.trim();

    if (key === 'field-type') {
      current = { fieldType: value.toLowerCase() };
      fields.push(current);
      return;
    }

    if (!current) return;

    switch (key) {
      case 'label':
        current.label = value;
        break;
      case 'options':
        current.options = value.split(',').map((option) => option.trim()).filter(Boolean);
        break;
      case 'maxlength': {
        const parsed = Number(value);
        current.maxlength = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
        break;
      }
      case 'required':
        current.required = value.toLowerCase() === 'true';
        break;
      default:
        break;
    }
  });

  return fields;
}

function renderSelectField(field, fieldId) {
  const wrapper = document.createElement('div');
  wrapper.className = 'embroidery-options-field embroidery-options-field--select';

  const labelEl = document.createElement('label');
  labelEl.setAttribute('for', fieldId);
  labelEl.textContent = field.label ?? '';

  const select = document.createElement('select');
  select.id = fieldId;
  select.name = fieldId;
  if (field.required) select.required = true;

  select.append(new Option('', ''));
  (field.options ?? []).forEach((optionValue) => {
    select.append(new Option(optionValue, optionValue));
  });

  wrapper.append(labelEl, select);
  return wrapper;
}

function renderRadioField(field, fieldId) {
  const wrapper = document.createElement('fieldset');
  wrapper.className = 'embroidery-options-field embroidery-options-field--radio';

  const legend = document.createElement('legend');
  legend.textContent = field.label ?? '';
  wrapper.append(legend);

  (field.options ?? []).forEach((optionValue, optionIndex) => {
    const optionId = `${fieldId}-${optionIndex}`;

    const optionWrapper = document.createElement('div');
    optionWrapper.className = 'embroidery-options-radio-option';

    const input = document.createElement('input');
    input.type = 'radio';
    input.id = optionId;
    input.name = fieldId;
    input.value = optionValue;
    if (field.required) input.required = true;

    const optionLabel = document.createElement('label');
    optionLabel.setAttribute('for', optionId);
    optionLabel.textContent = optionValue;

    optionWrapper.append(input, optionLabel);
    wrapper.append(optionWrapper);
  });

  return wrapper;
}

function renderTextField(field, fieldId) {
  const wrapper = document.createElement('div');
  wrapper.className = 'embroidery-options-field embroidery-options-field--text';

  const labelEl = document.createElement('label');
  labelEl.setAttribute('for', fieldId);
  labelEl.textContent = field.label ?? '';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = fieldId;
  input.name = fieldId;
  if (field.maxlength) input.maxLength = field.maxlength;
  if (field.required) input.required = true;

  wrapper.append(labelEl, input);
  return wrapper;
}

function renderField(field, index) {
  const fieldId = `embroidery-options-field-${index}`;

  switch (field.fieldType) {
    case 'select':
      return renderSelectField(field, fieldId);
    case 'radio':
      return renderRadioField(field, fieldId);
    case 'text':
      return renderTextField(field, fieldId);
    default:
      console.warn(`[embroidery-options] unknown field-type "${field.fieldType}" - skipped`);
      return null;
  }
}

function findQuantityElement() {
  return document.querySelector(QUANTITY_SELECTOR);
}

/**
 * product-details is a first-party block with no shadow DOM; EDS decorates
 * blocks sequentially in document order, so if this block is authored after
 * product-details, the quantity element already exists by the time we get
 * here. The observer is just a defensive fallback for any other ordering.
 */
function waitForQuantityElement(timeoutMs) {
  return new Promise((resolve) => {
    const existing = findQuantityElement();
    if (existing) {
      resolve(existing);
      return;
    }

    let observer;
    const timer = window.setTimeout(() => {
      observer?.disconnect();
      resolve(null);
    }, timeoutMs);

    try {
      observer = new MutationObserver(() => {
        const el = findQuantityElement();
        if (!el) return;
        window.clearTimeout(timer);
        observer.disconnect();
        resolve(el);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    } catch {
      window.clearTimeout(timer);
      resolve(null);
    }
  });
}

export default async function decorate(block) {
  const fields = parseFields(block);

  // Rendered output is injected into product-details, not left at this
  // block's own authored position.
  block.replaceChildren();

  if (fields.length === 0) {
    console.warn('[embroidery-options] no fields configured - nothing to render');
    return;
  }

  const quantityEl = await waitForQuantityElement(INSERTION_WAIT_MS);
  if (!quantityEl) {
    console.warn('[embroidery-options] could not locate product-details quantity element - fields not injected');
    return;
  }

  const container = document.createElement('div');
  container.className = 'embroidery-options-fields';

  fields.forEach((field, index) => {
    const fieldEl = renderField(field, index);
    if (fieldEl) container.append(fieldEl);
  });

  quantityEl.before(container);
}
