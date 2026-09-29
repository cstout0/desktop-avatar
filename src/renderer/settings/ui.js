// Tiny DOM helpers and the settings controls (switch, segmented, slider...).

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

export function section(emoji, title, blurb, ...cards) {
  return h('div', {}, h('div', { class: 'section-head' }, h('span', { class: 'big' }, emoji), h('div', {}, h('h1', {}, title), h('p', {}, blurb))), h('div', { class: 'cards' }, ...cards));
}

export function card(title, sub, ...kids) {
  const wide = typeof title === 'object' && title?.wide;
  const t = typeof title === 'object' ? title.title : title;
  return h('div', { class: `card${wide ? ' wide' : ''}` }, h('h3', {}, t), sub ? h('p', { class: 'sub' }, sub) : null, ...kids);
}

export function row(label, hint, control, { stack = false, disabled = false } = {}) {
  return h('div', { class: `row${stack ? ' stack' : ''}${disabled ? ' disabled' : ''}` }, h('div', { class: 'label' }, h('strong', {}, label), hint ? h('small', {}, hint) : null), h('div', { class: 'control' }, control));
}

export function toggle(value, onChange, label = 'toggle') {
  return h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: value, 'aria-label': label, onChange: (e) => onChange(e.target.checked) }));
}

export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup' });
  for (const o of options) {
    const btn = h('button', { type: 'button', role: 'radio', 'aria-checked': String(o.value === value), class: o.value === value ? 'on' : '', title: o.title ?? null }, o.label);
    btn.addEventListener('click', () => {
      for (const b of wrap.children) {
        b.classList.remove('on');
        b.setAttribute('aria-checked', 'false');
      }
      btn.classList.add('on');
      btn.setAttribute('aria-checked', 'true');
      onChange(o.value);
    });
    wrap.append(btn);
  }
  return wrap;
}

export function slider({ min, max, step = 1, value, format = (v) => v, onChange, onInput }) {
  const out = h('output', {}, format(value));
  const input = h('input', { type: 'range', min, max, step, value });
  input.addEventListener('input', () => {
    out.textContent = format(Number(input.value));
    onInput?.(Number(input.value));
  });
  input.addEventListener('change', () => onChange(Number(input.value)));
  return h('div', { class: 'slider' }, input, out);
}

export function textInput({ value = '', placeholder = '', onChange, width, maxlength, type = 'text' }) {
  const el = h('input', { class: 'text', type, value, placeholder, maxlength: maxlength ?? null, style: width ? { width } : null });
  el.addEventListener('change', () => onChange(el.value));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.blur();
  });
  return el;
}

export function select(options, value, onChange) {
  const el = h('select', { class: 'text' }, options.map((o) => h('option', { value: o.value, selected: o.value === value ? true : null }, o.label)));
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

export function button(label, onClick, { kind = '', title, small = false, disabled = false } = {}) {
  const b = h('button', { type: 'button', class: `btn ${kind}${small ? ' small' : ''}`, title: title ?? null, disabled: disabled || null }, label);
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await onClick(b);
    } finally {
      if (b.isConnected) b.disabled = false;
    }
  });
  return b;
}

export function pill(kind, text) {
  return h('span', { class: `pill ${kind}` }, text);
}

export function swatches(items, value, onChange) {
  const wrap = h('div', { class: 'swatches' });
  for (const it of items) {
    const el = h('button', { type: 'button', class: `swatch${it.value === value ? ' on' : ''}${it.rainbow ? ' rainbow' : ''}`, title: it.label, 'aria-label': it.label, style: it.rainbow ? null : { background: it.color } });
    el.addEventListener('click', () => {
      for (const s of wrap.children) s.classList.remove('on');
      el.classList.add('on');
      onChange(it.value);
    });
    wrap.append(el);
  }
  return wrap;
}

/** A grid of picture tiles; `draw(canvas)` paints each preview. */
export function tiles(items, value, onChange) {
  const wrap = h('div', { class: 'tiles' });
  for (const it of items) {
    const canvas = h('canvas', { width: 168, height: 168 });
    const el = h('button', { type: 'button', class: `tile${it.value === value ? ' on' : ''}`, title: it.hint ? `${it.label}: ${it.hint}` : it.label }, canvas, h('span', {}, it.label));
    it.draw(canvas);
    el.addEventListener('click', () => {
      for (const t of wrap.children) t.classList.remove('on');
      el.classList.add('on');
      onChange(it.value);
    });
    wrap.append(el);
  }
  return wrap;
}

let toastTimer = null;
export function toast(text, ms = 2600) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = h('div', { class: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
