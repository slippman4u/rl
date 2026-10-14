import { el } from '../lib/dom.js';

/** Prototype sign-in: no authentication, nothing typed here is stored or sent. */
export function render(container, model, ctx) {
  const username = el('input', {
    id: 'rw-username', name: 'username', type: 'text', value: 'sofia', autocomplete: 'off', spellcheck: 'false',
  });
  const password = el('input', {
    id: 'rw-password', name: 'password', type: 'password', value: 'showroom-demo', autocomplete: 'off',
  });
  const form = el(
    'form',
    { class: 'rw-signin-form', novalidate: true },
    el('div', { class: 'rw-field' }, el('label', { for: 'rw-username', text: 'Username' }), username),
    el('div', { class: 'rw-field' }, el('label', { for: 'rw-password', text: 'Password' }), password),
    el('button', { class: 'rw-button', type: 'submit', text: 'Sign in' }),
    el('p', { class: 'rw-signin-note', text: 'Prototype sign-in. No credentials are checked or stored.' }),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    ctx.signIn({ name: 'Sofia', title: 'Sales Representative' });
  });

  container.append(el(
    'div',
    { class: 'rw-signin' },
    el(
      'div',
      { class: 'rw-signin-card' },
      el('p', { class: 'rw-eyebrow', text: 'Sales representative workspace' }),
      el('h1', { text: 'Showroom' }),
      el('span', { class: 'rw-rule', 'aria-hidden': 'true' }),
      form,
    ),
  ));
  username.focus({ preventScroll: true });
}
