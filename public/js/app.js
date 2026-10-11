/* Core front-end framework: API, routing, layout, UI helpers. */
(function () {
  const App = (window.App = {
    user: null,
    meta: null,
    pages: {},
    products: null,
    current: null
  });

  /* ---------------- helpers ---------------- */
  const esc = (App.esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  /* Sri Lankan rupees: Rs. 1,234,567.50 */
  const fmt2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  App.cur = () => (App.meta && App.meta.settings.currency_symbol) || 'Rs.';
  App.money = (v) => {
    const n = Number(v) || 0;
    return (n < 0 ? '-' : '') + App.cur() + ' ' + fmt2.format(Math.abs(n));
  };
  App.num = (v) => fmt2.format(Number(v) || 0);
  /* Indian rupee amounts (GRN India cost) */
  App.inr = (v) => '₹ ' + fmt2.format(Number(v) || 0);
  App.taxOn = () => App.meta && App.meta.settings.tax_enabled === '1';
  App.taxName = () => (App.meta && App.meta.settings.tax_name) || 'VAT';
  App.modeLabel = (m) => ({ cash: 'Cash', card: 'Card', bank: 'Bank transfer', cheque: 'Cheque', lankaqr: 'LankaQR', credit: 'Credit' }[m] || String(m || '').toUpperCase());
  App.qty = (v) => {
    const n = Number(v) || 0;
    return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  };
  App.fc = (v, cur) => (cur ? cur + ' ' : '') + new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(v) || 0);
  App.date = (d) => {
    if (!d) return '';
    const [y, m, day] = String(d).slice(0, 10).split('-');
    return `${day}/${m}/${y}`;
  };
  App.today = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  App.monthStart = () => App.today().slice(0, 8) + '01';
  App.fyStart = () => {
    const t = App.today();
    const y = Number(t.slice(0, 4));
    return (Number(t.slice(5, 7)) >= 4 ? y : y - 1) + '-04-01';
  };
  App.can = (...roles) => App.user && roles.includes(App.user.role);
  App.isStaff = () => App.can('admin', 'manager');
  App.$ = (sel, root) => (root || document).querySelector(sel);
  App.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  App.debounce = (fn, ms) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms || 250); };
  };

  /* ---------------- API ---------------- */
  App.api = async function (method, url, body) {
    const r = await fetch(url, {
      method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await r.json(); } catch { data = {}; }
    if (r.status === 401 && !url.includes('/auth/')) {
      App.user = null;
      App.renderLogin();
      throw new Error('Session expired. Please log in again.');
    }
    if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  };
  App.get = (u) => App.api('GET', u);
  App.post = (u, b) => App.api('POST', u, b || {});
  App.put = (u, b) => App.api('PUT', u, b || {});
  App.del = (u) => App.api('DELETE', u);
  App.qs = (o) => {
    const p = Object.entries(o).filter(([, v]) => v !== '' && v != null);
    return p.length ? '?' + p.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : '';
  };

  App.loadMeta = async () => { App.meta = await App.get('/api/meta'); return App.meta; };
  App.settings = () => App.meta.settings;
  App.loadProducts = async (force) => {
    if (!App.products || force) App.products = await App.get('/api/products?limit=5000');
    return App.products;
  };

  /* ---------------- toasts & dialogs ---------------- */
  App.toast = (msg, type) => {
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = msg;
    App.$('#toasts').appendChild(el);
    setTimeout(() => el.remove(), type === 'err' ? 6000 : 3000);
  };
  App.err = (e) => App.toast(e && e.message ? e.message : String(e), 'err');

  /*
   * App.modal({ title, body (html), wide, xwide, footer (html), onOpen(el, close), submitText, onSubmit(form, el) })
   * returns { el, close }
   */
  App.modal = function (opt) {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    const footer = opt.footer != null ? opt.footer
      : opt.onSubmit ? `<button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">${esc(opt.submitText || 'Save')}</button>`
        : '<button type="button" class="btn" data-close>Close</button>';
    bg.innerHTML = `<form class="modal ${opt.xwide ? 'xwide' : opt.wide ? 'wide' : ''}" novalidate autocomplete="off">
      <div class="modal-h"><h3>${esc(opt.title || '')}</h3><button type="button" class="x" data-close>&times;</button></div>
      <div class="modal-b">${opt.body || ''}</div>
      ${footer ? `<div class="modal-f">${footer}</div>` : ''}</form>`;
    document.body.appendChild(bg);
    const form = bg.querySelector('form');
    const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape' && document.body.lastElementChild === bg) close(); };
    document.addEventListener('keydown', onKey);
    bg.addEventListener('mousedown', (e) => { if (e.target === bg && !opt.sticky) close(); });
    App.$$('[data-close]', bg).forEach((b) => b.addEventListener('click', close));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!opt.onSubmit) return;
      const btn = form.querySelector('button[type=submit]');
      if (btn) btn.disabled = true;
      try {
        const res = await opt.onSubmit(form, close);
        if (res !== false) close();
      } catch (err) {
        App.err(err);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
    if (opt.onOpen) opt.onOpen(form, close);
    const first = form.querySelector('[autofocus]') || form.querySelector('.modal-b input:not([type=hidden]):not([readonly]), .modal-b select');
    if (first) setTimeout(() => first.focus(), 30);
    return { el: form, close };
  };

  App.confirm = (message, okText) => new Promise((resolve) => {
    let done = false;
    const m = App.modal({
      title: 'Please confirm', body: `<p style="margin:0">${esc(message)}</p>`,
      footer: `<button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">${esc(okText || 'Yes, continue')}</button>`,
      onSubmit: () => { done = true; resolve(true); }
    });
    const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe(document.body, { childList: true });
  });

  App.prompt = (title, fields, submitText) => new Promise((resolve) => {
    let done = false;
    const m = App.modal({
      title, body: `<div class="form-grid">${fields}</div>`, submitText: submitText || 'OK',
      onSubmit: (f) => { done = true; resolve(App.formData(f)); }
    });
    const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!done) resolve(null); } });
    obs.observe(document.body, { childList: true });
  });

  /* ---------------- form helpers ---------------- */
  App.formData = (form) => {
    const o = {};
    App.$$('[name]', form).forEach((el) => {
      if (el.closest('[data-skip]')) return;
      if (el.type === 'checkbox') o[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
      else o[el.name] = el.value;
    });
    return o;
  };
  App.field = (label, name, value, opts) => {
    opts = opts || {};
    const type = opts.type || 'text';
    const cls = opts.cls ? ` class="f ${opts.cls}"` : ' class="f"';
    const attrs = (opts.attrs || '') + (opts.required ? ' required' : '') + (opts.step ? ` step="${opts.step}"` : '') +
      (opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : '') + (opts.readonly ? ' readonly' : '');
    let input;
    if (type === 'select') {
      input = `<select name="${name}"${attrs}>${opts.options}</select>`;
    } else if (type === 'textarea') {
      input = `<textarea name="${name}"${attrs}>${esc(value)}</textarea>`;
    } else {
      input = `<input type="${type}" name="${name}" value="${esc(value)}"${attrs}>`;
    }
    return `<label${cls}><span>${esc(label)}${opts.required ? ' *' : ''}</span>${input}</label>`;
  };
  App.options = (list, selected, opts) => {
    opts = opts || {};
    const items = list.map((x) => (typeof x === 'object' ? x : { value: x, label: x }));
    return (opts.blank != null ? `<option value="">${esc(opts.blank)}</option>` : '') +
      items.map((x) => `<option value="${esc(x.value)}" ${String(x.value) === String(selected == null ? '' : selected) ? 'selected' : ''}>${esc(x.label)}</option>`).join('');
  };
  App.modeOptions = (sel, noCredit) => App.options(App.meta.payment_modes.filter((m) => !noCredit || m !== 'credit').map((m) => ({ value: m, label: App.modeLabel(m) })), sel);

  /* ---------------- tables ---------------- */
  /*
   * App.table(rows, cols, { onRow, empty, foot })
   * cols: [{ key, label, num, fmt(row) -> html, cls }]
   */
  App.table = (rows, cols, opt) => {
    opt = opt || {};
    if (!rows.length) return `<div class="table-wrap"><div class="empty">${esc(opt.empty || 'No records found')}</div></div>`;
    const head = cols.map((c) => `<th class="${c.num ? 'num' : ''} ${c.cls || ''}">${esc(c.label)}</th>`).join('');
    const body = rows.map((r, i) => `<tr data-i="${i}" class="${opt.onRow ? 'click' : ''} ${opt.rowCls ? opt.rowCls(r) : ''}">${cols.map((c) => {
      const v = c.fmt ? c.fmt(r) : esc(r[c.key]);
      return `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${v == null ? '' : v}</td>`;
    }).join('')}</tr>`).join('');
    const foot = opt.foot ? `<tfoot><tr>${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${opt.foot[c.key] != null ? opt.foot[c.key] : ''}</td>`).join('')}</tr></tfoot>` : '';
    return `<div class="table-wrap"><table class="t"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table></div>`;
  };
  App.bindRows = (container, rows, fn) => {
    App.$$('tbody tr[data-i]', container).forEach((tr) => tr.addEventListener('click', (e) => {
      if (e.target.closest('button, a, input, select')) return;
      fn(rows[Number(tr.dataset.i)]);
    }));
  };
  App.sum = (rows, key) => rows.reduce((a, r) => a + (Number(typeof key === 'function' ? key(r) : r[key]) || 0), 0);

  App.statusBadge = (s) => {
    const map = { paid: 'ok', partial: 'warn', unpaid: 'bad', returned: 'info', cancelled: 'bad', received: 'ok', in_transit: 'info',
      at_port: 'warn', customs: 'warn', ordered: 'info', draft: '', active: 'ok' };
    return `<span class="badge ${map[s] || ''}">${esc(String(s || '').replace(/_/g, ' '))}</span>`;
  };

  /* ---------------- CSV ---------------- */
  App.csv = (rows, cols, filename) => {
    const escCsv = (v) => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.map((c) => escCsv(c.label)).join(',')].concat(rows.map((r) => cols.map((c) => escCsv(c.csv ? c.csv(r) : r[c.key])).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'export.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  App.parseCsv = (text) => {
    const rows = [];
    let row = [], cur = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') inQ = false; else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); rows.push(row); row = []; cur = '';
      } else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    const nonEmpty = rows.filter((r) => r.some((x) => x.trim() !== ''));
    if (!nonEmpty.length) return [];
    const head = nonEmpty[0].map((h) => h.replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, '_'));
    return nonEmpty.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
  };

  /* ---------------- print ---------------- */
  App.printHtml = (html, title) => {
    const w = window.open('', '_blank', 'width=900,height=900');
    if (!w) { App.toast('Allow pop-ups for this site to print', 'err'); return; }
    w.document.open();
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title || 'Print')}</title></head><body>${html}
      <script>window.onload=function(){setTimeout(function(){window.print();},250)}<\/script></body></html>`);
    w.document.close();
  };

  /* ---------------- product picker ---------------- */
  /*
   * Attaches a search dropdown to an <input>. onPick(product) is called with the chosen product.
   * opts.extra(product) -> html shown on the right side.
   */
  App.productPicker = async (input, onPick, opts) => {
    opts = opts || {};
    const wrap = document.createElement('div');
    wrap.className = 'picker';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const list = document.createElement('div');
    list.className = 'picker-list hidden';
    wrap.appendChild(list);
    let matches = [];
    let hl = 0;
    const render = () => {
      if (!matches.length) { list.classList.add('hidden'); return; }
      list.innerHTML = matches.map((p, i) => `<div data-i="${i}" class="${i === hl ? 'hl' : ''}"><span class="nm"><b>${esc(p.name)}</b><br>
        <small>${esc(p.sku)}${p.color ? ' · ' + esc(p.color) : ''}${p.size ? ' · ' + esc(p.size) : ''}</small></span>
        <small>${opts.extra ? opts.extra(p) : `Stock ${App.qty(p.stock)} ${esc(p.unit)}<br>${App.money(p.sale_price)}`}</small></div>`).join('');
      list.classList.remove('hidden');
    };
    const search = async () => {
      const term = input.value.trim().toLowerCase();
      if (!term) { matches = []; render(); return; }
      const all = await App.loadProducts();
      const words = term.split(/\s+/);
      matches = all.filter((p) => {
        const hay = `${p.name} ${p.sku} ${p.barcode || ''} ${p.color || ''} ${p.design || ''} ${p.size || ''} ${p.category || ''}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      }).slice(0, 30);
      hl = 0;
      render();
    };
    const pick = (p) => {
      matches = [];
      render();
      input.value = '';
      onPick(p);
    };
    input.addEventListener('input', App.debounce(search, 120));
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); hl = Math.min(hl + 1, matches.length - 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); hl = Math.max(hl - 1, 0); render(); }
      else if (e.key === 'Escape') { matches = []; render(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const term = input.value.trim();
        if (!term) return;
        const all = await App.loadProducts();
        const exact = all.find((p) => (p.barcode && p.barcode.toLowerCase() === term.toLowerCase()) || p.sku.toLowerCase() === term.toLowerCase());
        if (exact) return pick(exact);
        if (!matches.length) await search();
        if (matches[hl]) pick(matches[hl]);
        else App.toast(`No product found for "${term}"`, 'err');
      }
    });
    list.addEventListener('mousedown', (e) => {
      const d = e.target.closest('[data-i]');
      if (d) { e.preventDefault(); pick(matches[Number(d.dataset.i)]); }
    });
    input.addEventListener('blur', () => setTimeout(() => { matches = []; render(); }, 150));
  };

  /* ---------------- party picker (customers / suppliers) as <select> ---------------- */
  App.partySelect = async (type, selected, blank) => {
    const list = await App.get(type === 'customer' ? '/api/customers' : '/api/suppliers');
    return App.options(list.map((p) => ({ value: p.id, label: p.name + (p.phone ? ` (${p.phone})` : '') + (p.country && type === 'supplier' ? ` - ${p.country}` : '') })), selected, { blank: blank || '-- select --' });
  };

  /* ---------------- navigation ---------------- */
  const NAV = [
    { grp: 'Sales' },
    { path: 'dashboard', label: 'Dashboard', ic: '◧' },
    { path: 'pos', label: 'POS Billing', ic: '¤' },
    { path: 'sales', label: 'Invoices', ic: '▤' },
    { path: 'returns', label: 'Returns / Credit Notes', ic: '↺' },
    { path: 'customers', label: 'Customers', ic: '☺' },
    { grp: 'Inventory' },
    { path: 'products', label: 'Products', ic: '▦' },
    { path: 'stock', label: 'Stock Adjust & Moves', ic: '⇅', roles: ['admin', 'manager'] },
    { path: 'labels', label: 'Barcode Labels', ic: '▥', roles: ['admin', 'manager'] },
    { grp: 'Purchasing', roles: ['admin', 'manager'] },
    { path: 'grn', label: 'GRN — Goods from India', ic: '⊕', roles: ['admin', 'manager'] },
    { path: 'purchases', label: 'Local Purchases (LKR)', ic: '⊞', roles: ['admin', 'manager'] },
    { path: 'suppliers', label: 'Suppliers', ic: '⚑', roles: ['admin', 'manager'] },
    { grp: 'Accounts', roles: ['admin', 'manager'] },
    { path: 'payments', label: 'Receipts & Payments', ic: '⇄', roles: ['admin', 'manager'] },
    { path: 'expenses', label: 'Expenses', ic: '−', roles: ['admin', 'manager'] },
    { path: 'reports', label: 'Reports', ic: '▨', roles: ['admin', 'manager'] },
    { grp: 'Admin', roles: ['admin'] },
    { path: 'users', label: 'Users', ic: '☷', roles: ['admin'] },
    { path: 'settings', label: 'Settings & Backup', ic: '⚙', roles: ['admin'] }
  ];

  App.navigate = (path) => { location.hash = '#/' + path; };

  App.renderShell = () => {
    const s = App.settings();
    const items = NAV.filter((n) => !n.roles || n.roles.includes(App.user.role));
    App.$('#root').innerHTML = `<div id="app">
      <aside class="sidebar" id="sidebar">
        <div class="brand"><b>${esc(s.company_name)}</b><small>Wholesale ERP · POS</small></div>
        <nav class="nav">${items.map((n) => n.grp ? `<div class="grp">${esc(n.grp)}</div>` :
    `<a href="#/${n.path}" data-path="${n.path}"><span class="ic">${n.ic}</span>${esc(n.label)}</a>`).join('')}</nav>
        <div class="side-foot">${esc(App.user.name)} <span class="badge">${esc(App.user.role)}</span><br>
          <a href="#" id="chpw">Change password</a> · <a href="#" id="logout">Logout</a></div>
      </aside>
      <div class="main">
        <header class="topbar"><button class="btn sm menu-btn" id="menuBtn">☰</button><div class="title" id="pageTitle"></div>
          <div class="grow"></div><a class="btn sm primary" href="#/pos">+ New Bill <span class="kbd" style="color:#fff;border-color:rgba(255,255,255,.4);background:transparent">F2</span></a></header>
        <section class="content" id="content"></section>
      </div></div>`;
    App.$('#logout').onclick = async (e) => {
      e.preventDefault();
      try { await App.post('/api/auth/logout'); } catch { /* ignore */ }
      App.user = null;
      App.renderLogin();
    };
    App.$('#chpw').onclick = (e) => { e.preventDefault(); App.changePassword(); };
    App.$('#menuBtn').onclick = () => App.$('#sidebar').classList.toggle('open');
  };

  App.changePassword = () => App.modal({
    title: 'Change password',
    body: `<div class="form-grid">${App.field('Current password', 'old_password', '', { type: 'password', required: true })}
      ${App.field('New password (min 6)', 'new_password', '', { type: 'password', required: true })}</div>`,
    onSubmit: async (f) => { await App.post('/api/auth/change-password', App.formData(f)); App.toast('Password changed', 'ok'); }
  });

  App.setTitle = (t) => {
    const el = App.$('#pageTitle');
    if (el) el.textContent = t;
    document.title = `${t} · ${App.settings().company_name}`;
  };

  App.route = async () => {
    if (!App.user) return;
    const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
    const [path, ...rest] = hash.split('/');
    const page = App.pages[path];
    App.$$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.path === path));
    App.$('#sidebar') && App.$('#sidebar').classList.remove('open');
    const content = App.$('#content');
    if (!page) { content.innerHTML = '<div class="card empty">Page not found</div>'; return; }
    if (page.roles && !page.roles.includes(App.user.role)) { content.innerHTML = '<div class="card empty">You do not have access to this page.</div>'; return; }
    if (App.current && App.current.destroy) App.current.destroy();
    App.current = page;
    App.setTitle(page.title || path);
    content.innerHTML = '<div class="empty">Loading…</div>';
    try {
      await page.render(content, rest);
    } catch (e) {
      content.innerHTML = `<div class="card empty">Could not load page: ${esc(e.message)}</div>`;
    }
  };

  App.renderLogin = () => {
    App.$('#root').innerHTML = `<div class="login-wrap"><div class="login">
      <h1>Textile ERP</h1><span class="muted">Wholesale Billing · Stock · GRN · Accounts</span>
      <form id="loginForm">${App.field('Username', 'username', '', { required: true, attrs: ' autocomplete="username" autofocus' })}
      ${App.field('Password', 'password', '', { type: 'password', required: true, attrs: ' autocomplete="current-password"' })}
      <button class="btn primary lg" type="submit">Log in</button></form></div></div>`;
    const f = App.$('#loginForm');
    setTimeout(() => f.username.focus(), 50);
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await App.post('/api/auth/login', App.formData(f));
        App.user = r.user;
        await App.boot();
      } catch (err) { App.err(err); }
    };
  };

  App.boot = async () => {
    await App.loadMeta();
    App.products = null;
    App.renderShell();
    if (!location.hash || location.hash === '#/') location.hash = App.user.role === 'cashier' ? '#/pos' : '#/dashboard';
    App.route();
  };

  App.start = async () => {
    window.addEventListener('hashchange', App.route);
    document.addEventListener('keydown', (e) => {
      if (!App.user) return;
      if (e.key === 'F2') { e.preventDefault(); App.navigate('pos'); }
    });
    try {
      const r = await App.get('/api/auth/me');
      App.user = r.user;
      await App.boot();
    } catch {
      App.renderLogin();
    }
  };
})();
