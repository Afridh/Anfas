/* POS billing screen */
(function () {
  const { esc, money, qty: fq } = App;
  const HOLD_KEY = 'erp_held_bills';

  const state = {
    cart: [], customer: null, priceType: 'wholesale', inclusive: false, billDiscount: 0, billDiscountPct: false,
    payments: [{ mode: 'cash', amount: '' }], notes: '', customers: null
  };

  function reset() {
    const s = App.settings();
    Object.assign(state, {
      cart: [], customer: null, priceType: s.default_price_list === 'retail' ? 'retail' : 'wholesale', inclusive: s.prices_include_tax === '1',
      billDiscount: 0, billDiscountPct: false, payments: [{ mode: 'cash', amount: '' }], notes: ''
    });
  }

  function calc() {
    const s = App.settings();
    const sub = state.cart.reduce((a, l) => a + l.qty * l.rate * (1 - (l.discount_pct || 0) / 100), 0);
    const bd = state.billDiscountPct ? sub * (Number(state.billDiscount) || 0) / 100 : Number(state.billDiscount) || 0;
    return Tax.computeBill(state.cart.map((l) => ({ qty: l.qty, rate: l.rate, discount_pct: l.discount_pct, tax_rate: l.product.tax_rate })), {
      tax_enabled: App.taxOn(), inclusive: state.inclusive, bill_discount: bd, round: s.round_off === '1'
    });
  }

  function rateFor(p) {
    return state.priceType === 'wholesale' && p.wholesale_price > 0 ? p.wholesale_price : p.sale_price;
  }

  function addProduct(p) {
    if (!p) return;
    const existing = state.cart.find((l) => l.product.id === p.id);
    if (existing && p.unit !== 'MTR' && p.unit !== 'YDS' && p.unit !== 'KGS') {
      existing.qty = Tax.r3(existing.qty + 1);
      renderCart();
      return;
    }
    if (existing) {
      renderCart();
      focusQty(state.cart.indexOf(existing));
      return;
    }
    state.cart.push({ product: p, qty: 1, rate: rateFor(p), discount_pct: 0 });
    renderCart();
    if (['MTR', 'YDS', 'KGS'].includes(p.unit)) focusQty(state.cart.length - 1);
  }

  function focusQty(i) {
    setTimeout(() => {
      const el = App.$(`.pos-cart input[data-f="qty"][data-i="${i}"]`);
      if (el) { el.focus(); el.select(); }
    }, 20);
  }

  /* ---------- rendering ---------- */
  function renderCart() {
    const c = calc();
    const box = App.$('#posCart');
    if (!box) return;
    if (!state.cart.length) {
      box.innerHTML = `<div class="empty">Scan a barcode or search for a fabric to start billing.<br><br>
        <span class="pos-hint"><span class="kbd">F2</span> new bill · <span class="kbd">F4</span> customer · <span class="kbd">F8</span> payment · <span class="kbd">F9</span> save &amp; print · <span class="kbd">F10</span> save only</span></div>`;
    } else {
      box.innerHTML = `<div class="table-wrap"><table class="t"><thead><tr><th>#</th><th>Item</th><th class="num">Qty</th><th class="num">Rate</th>
        <th class="num">Disc %</th>${App.taxOn() ? `<th class="num">${esc(App.taxName())}</th>` : '<th></th>'}<th class="num">Amount</th><th></th></tr></thead><tbody>
        ${state.cart.map((l, i) => {
    const line = c.lines[i];
    const low = l.qty > l.product.stock;
    return `<tr><td>${i + 1}</td><td><b>${esc(l.product.name)}</b><br><small class="muted">${esc(l.product.sku)}${l.product.color ? ' · ' + esc(l.product.color) : ''}
            · stock <span style="color:${low ? 'var(--bad)' : 'inherit'}">${fq(l.product.stock)} ${esc(l.product.unit)}</span></small></td>
          <td class="num"><input type="number" step="0.01" min="0" data-f="qty" data-i="${i}" value="${l.qty}"> <small>${esc(l.product.unit)}</small></td>
          <td class="num"><input class="rate" type="number" step="0.01" min="0" data-f="rate" data-i="${i}" value="${l.rate}"></td>
          <td class="num"><input type="number" step="0.5" min="0" max="100" data-f="discount_pct" data-i="${i}" value="${l.discount_pct || ''}" style="width:64px"></td>
          <td class="num">${App.taxOn() ? line.tax_rate + '%' : ''}</td><td class="num"><b>${App.num(line.total)}</b></td>
          <td><button type="button" class="btn sm danger" data-del="${i}" title="Remove">✕</button></td></tr>`;
  }).join('')}</tbody></table></div>`;
      App.$$('input[data-f]', box).forEach((inp) => {
        inp.addEventListener('input', () => {
          const l = state.cart[Number(inp.dataset.i)];
          l[inp.dataset.f] = Number(inp.value) || 0;
          renderTotals();
          const tr = inp.closest('tr');
          tr.cells[5].textContent = App.taxOn() ? calc().lines[Number(inp.dataset.i)].tax_rate + '%' : '';
          tr.cells[6].innerHTML = `<b>${App.num(calc().lines[Number(inp.dataset.i)].total)}</b>`;
        });
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); App.$('#posScan').focus(); }
        });
      });
      App.$$('[data-del]', box).forEach((b) => b.addEventListener('click', () => {
        state.cart.splice(Number(b.dataset.del), 1);
        renderCart();
      }));
    }
    renderTotals();
  }

  function renderTotals() {
    const c = calc();
    const T = c.totals;
    App.$('#posTotals').innerHTML = `
      <div class="row"><span>Items</span><span>${state.cart.length} · Qty ${fq(state.cart.reduce((a, l) => a + l.qty, 0))}</span></div>
      <div class="row"><span>Gross</span><span>${App.num(T.gross)}</span></div>
      ${T.line_discount + T.bill_discount ? `<div class="row"><span>Discount</span><span>− ${App.num(T.line_discount + T.bill_discount)}</span></div>` : ''}
      ${App.taxOn() ? `<div class="row"><span>Value excl. ${esc(App.taxName())}</span><span>${App.num(T.taxable)}</span></div><div class="row"><span>${esc(App.taxName())}</span><span>${App.num(T.tax)}</span></div>` : ''}
      ${T.round_off ? `<div class="row"><span>Round off</span><span>${App.num(T.round_off)}</span></div>` : ''}
      <div class="grand"><span style="font-size:1rem;font-weight:500">Total</span><span>${money(T.grand_total)}</span></div>`;
    renderPayments(T.grand_total);
  }

  function renderPayments(total) {
    const box = App.$('#posPay');
    if (!box) return;
    const paid = state.payments.reduce((a, p) => a + (Number(p.amount) || 0), 0);
    const effectivePaid = state.payments.length === 1 && state.payments[0].amount === '' ? total : paid;
    const change = effectivePaid - total;
    const modes = App.meta.payment_modes.filter((x) => x !== 'credit');
    if (!box.dataset.built || Number(box.dataset.n) !== state.payments.length) {
      box.dataset.built = '1';
      box.dataset.n = state.payments.length;
      box.innerHTML = state.payments.map((p, i) => `<div class="pay-row">
          <select data-pm="${i}">${App.options(modes.map((x) => ({ value: x, label: App.modeLabel(x) })), p.mode)}</select>
          <input type="number" step="0.01" min="0" data-pa="${i}" value="${p.amount}" placeholder="${i === 0 ? App.num(total) : '0.00'}">
          ${i > 0 ? `<button type="button" class="btn sm danger" data-pr="${i}">✕</button>` : '<span></span>'}</div>`).join('') +
        `<div class="quick-cash">${[100, 500, 2000].map((n) => `<button type="button" class="btn" data-qc="${n}">+${n}</button>`).join('')}
         <button type="button" class="btn" data-qc="exact">Exact</button><button type="button" class="btn" id="addPay">+ Split</button></div>
         <div id="payInfo"></div>`;
      App.$$('[data-pm]', box).forEach((s) => s.addEventListener('change', () => { state.payments[Number(s.dataset.pm)].mode = s.value; }));
      App.$$('[data-pa]', box).forEach((s) => s.addEventListener('input', () => { state.payments[Number(s.dataset.pa)].amount = s.value; renderPayments(calc().totals.grand_total); }));
      App.$$('[data-pr]', box).forEach((b) => b.addEventListener('click', () => { state.payments.splice(Number(b.dataset.pr), 1); renderPayments(calc().totals.grand_total); }));
      App.$$('[data-qc]', box).forEach((b) => b.addEventListener('click', () => {
        const t = calc().totals.grand_total;
        const p0 = state.payments[0];
        if (b.dataset.qc === 'exact') p0.amount = String(Math.max(0, t - state.payments.slice(1).reduce((a, p) => a + (Number(p.amount) || 0), 0)));
        else p0.amount = String((Number(p0.amount) || 0) + Number(b.dataset.qc));
        box.dataset.built = '';
        renderPayments(t);
      }));
      App.$('#addPay').addEventListener('click', () => {
        const t = calc().totals.grand_total;
        const already = state.payments.reduce((a, p) => a + (Number(p.amount) || 0), 0);
        if (state.payments[0].amount === '') state.payments[0].amount = '0';
        state.payments.push({ mode: 'card', amount: String(Math.max(0, Tax.r2(t - already))) });
        renderPayments(t);
      });
    }
    const first = App.$('[data-pa="0"]', box);
    if (first) first.placeholder = App.num(total);
    const info = App.$('#payInfo');
    if (!info) return;
    if (change > 0.005) info.innerHTML = `<div class="change">Return change: ${money(change)}</div>`;
    else if (change < -0.005) {
      info.innerHTML = `<div style="color:var(--bad);font-weight:600">Balance ${money(-change)} → ${state.customer ? 'on credit to ' + esc(state.customer.name) : 'select a customer for credit'}</div>`;
    } else info.innerHTML = '<div class="muted">Fully paid</div>';
  }

  function renderCustomer() {
    const box = App.$('#posCust');
    const c = state.customer;
    box.innerHTML = c ? `<div class="inline" style="align-items:flex-start"><div><b>${esc(c.name)}</b> <span class="badge ${c.type === 'wholesale' ? 'brand' : ''}">${esc(c.type)}</span><br>
        <small class="muted">${esc(c.phone || '')}${c.vat_no ? ' · ' + esc(App.taxName()) + ' ' + esc(c.vat_no) : ''}<br>${esc(c.city || '')}
        ${c.balance ? ` · Due <b style="color:var(--bad)">${money(c.balance)}</b>` : ''}</small></div>
        <button type="button" class="btn sm auto" id="custClear">Change</button></div>`
      : `<div class="picker"><input id="custSearch" placeholder="Search customer by name / phone (F4) — leave empty for cash sale"></div>
        <div class="inline" style="margin-top:6px"><button type="button" class="btn sm" id="custNew">+ New customer</button><span class="muted" style="font-size:.85rem">Cash customer</span></div>`;
    if (c) {
      App.$('#custClear').onclick = () => { state.customer = null; renderCustomer(); renderCart(); setTimeout(() => App.$('#custSearch').focus(), 10); };
    } else {
      customerPicker(App.$('#custSearch'));
      App.$('#custNew').onclick = () => newCustomer();
    }
  }

  async function customerPicker(input) {
    const wrap = input.parentNode;
    const list = document.createElement('div');
    list.className = 'picker-list hidden';
    wrap.appendChild(list);
    let matches = [], hl = 0;
    const draw = () => {
      if (!matches.length) return list.classList.add('hidden');
      list.innerHTML = matches.map((c, i) => `<div data-i="${i}" class="${i === hl ? 'hl' : ''}"><span class="nm"><b>${esc(c.name)}</b><br><small>${esc(c.phone || '')} ${esc(c.city || '')}</small></span>
        <small>${c.balance ? 'Due ' + money(c.balance) : ''}</small></div>`).join('');
      list.classList.remove('hidden');
    };
    const pick = (c) => { setCustomer(c); };
    input.addEventListener('input', App.debounce(async () => {
      const t = input.value.trim().toLowerCase();
      if (!t) { matches = []; return draw(); }
      if (!state.customers) state.customers = await App.get('/api/customers');
      matches = state.customers.filter((c) => `${c.name} ${c.phone || ''} ${c.city || ''}`.toLowerCase().includes(t)).slice(0, 15);
      hl = 0;
      draw();
    }, 120));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); hl = Math.min(hl + 1, matches.length - 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); hl = Math.max(hl - 1, 0); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (matches[hl]) pick(matches[hl]); }
    });
    list.addEventListener('mousedown', (e) => { const d = e.target.closest('[data-i]'); if (d) { e.preventDefault(); pick(matches[Number(d.dataset.i)]); } });
    input.addEventListener('blur', () => setTimeout(() => { matches = []; draw(); }, 150));
  }

  function setCustomer(c) {
    state.customer = c;
    if (state.priceType !== (c.type === 'retail' ? 'retail' : 'wholesale')) {
      state.priceType = c.type === 'retail' ? 'retail' : 'wholesale';
      const sel = App.$('#posPriceType');
      if (sel) sel.value = state.priceType;
      state.cart.forEach((l) => { l.rate = rateFor(l.product); });
    }
    renderCustomer();
    renderCart();
    App.$('#posScan').focus();
  }

  function newCustomer() {
    App.modal({
      title: 'New customer',
      body: `<div class="form-grid">${App.field('Name', 'name', '', { required: true })}${App.field('Phone', 'phone', '')}
        ${App.field('Type', 'type', '', { type: 'select', options: App.options([{ value: 'wholesale', label: 'Wholesale (shop / dealer)' }, { value: 'retail', label: 'Retail' }], 'wholesale') })}
        ${App.taxOn() ? App.field(App.taxName() + ' No.', 'vat_no', '') : ''}
        ${App.field('City', 'city', '')}${App.field('Address', 'address', '', { cls: 'full' })}</div>`,
      onSubmit: async (f) => {
        const d = App.formData(f);
        const r = await App.post('/api/customers', d);
        state.customers = null;
        setCustomer(await App.get('/api/customers/' + r.id));
        App.toast('Customer added', 'ok');
      }
    });
  }

  /* ---------- hold / recall ---------- */
  const held = () => { try { return JSON.parse(localStorage.getItem(HOLD_KEY) || '[]'); } catch { return []; } };
  const saveHeld = (list) => { try { localStorage.setItem(HOLD_KEY, JSON.stringify(list)); } catch { App.toast('Could not store held bill', 'err'); } };
  function holdBill() {
    if (!state.cart.length) return App.toast('Cart is empty', 'err');
    const list = held();
    list.push({ at: new Date().toLocaleTimeString(), total: calc().totals.grand_total, state: JSON.parse(JSON.stringify({ ...state, customers: null })) });
    saveHeld(list);
    reset();
    renderAll();
    App.toast('Bill put on hold', 'ok');
  }
  function recallBill() {
    const list = held();
    if (!list.length) return App.toast('No held bills');
    const m = App.modal({
      title: 'Held bills',
      body: list.map((h, i) => `<div class="inline" style="padding:8px 0;border-bottom:1px solid var(--line)"><div>${esc(h.at)} · ${h.state.cart.length} items ·
        ${esc(h.state.customer ? h.state.customer.name : 'Cash customer')}</div><b class="auto">${money(h.total)}</b>
        <button type="button" class="btn sm primary auto" data-r="${i}">Recall</button><button type="button" class="btn sm danger auto" data-x="${i}">✕</button></div>`).join('')
    });
    App.$$('[data-r]', m.el).forEach((b) => b.onclick = () => {
      const h = list.splice(Number(b.dataset.r), 1)[0];
      saveHeld(list);
      Object.assign(state, h.state);
      m.close();
      renderAll();
    });
    App.$$('[data-x]', m.el).forEach((b) => b.onclick = () => { list.splice(Number(b.dataset.x), 1); saveHeld(list); m.close(); recallBill(); });
  }

  /* ---------- save ---------- */
  let saving = false;
  async function save(print) {
    if (saving) return;
    if (!state.cart.length) return App.toast('Cart is empty', 'err');
    const bad = state.cart.find((l) => !(l.qty > 0));
    if (bad) return App.toast(`Enter quantity for ${bad.product.name}`, 'err');
    const c = calc();
    const total = c.totals.grand_total;
    let payments = state.payments.map((p) => ({ mode: p.mode, amount: Number(p.amount) || 0 }));
    if (state.payments.length === 1 && state.payments[0].amount === '') payments = [{ mode: state.payments[0].mode, amount: total }];
    const tendered = payments.reduce((a, p) => a + p.amount, 0);
    if (tendered < total - 0.005 && !state.customer) return App.toast('Payment is less than the total. Select a customer to give credit.', 'err');
    const sub = state.cart.reduce((a, l) => a + l.qty * l.rate * (1 - (l.discount_pct || 0) / 100), 0);
    saving = true;
    try {
      const r = await App.post('/api/sales', {
        customer_id: state.customer ? state.customer.id : null, price_type: state.priceType, inclusive: state.inclusive,
        notes: state.notes,
        bill_discount: state.billDiscountPct ? sub * (Number(state.billDiscount) || 0) / 100 : Number(state.billDiscount) || 0,
        items: state.cart.map((l) => ({ product_id: l.product.id, qty: l.qty, rate: l.rate, discount_pct: l.discount_pct })),
        payments, tendered
      });
      App.products = null;
      state.customers = null;
      const sale = await App.get('/api/sales/' + r.id);
      if (print) App.printInvoice(sale);
      reset();
      renderAll();
      const change = Tax.r2(tendered - total);
      const m = App.modal({
        title: 'Bill saved',
        body: `<div class="center"><div class="muted">Invoice</div><h2>${esc(r.invoice_no)}</h2><div style="font-size:1.6rem;font-weight:700">${money(r.total)}</div>
          ${change > 0.005 ? `<div class="change" style="font-size:1.5rem;margin-top:8px">Return change: ${money(change)}</div>` : ''}
          ${r.total - r.paid > 0.005 ? `<div style="color:var(--bad)">On credit: ${money(r.total - r.paid)}</div>` : ''}</div>`,
        footer: `<button type="button" class="btn" id="pA4">Print A4</button><button type="button" class="btn" id="pTh">Print 80mm</button>
          <button type="button" class="btn primary" data-close id="nb">New bill (Enter)</button>`
      });
      App.$('#pA4', m.el).onclick = () => App.printInvoice(sale, 'a4');
      App.$('#pTh', m.el).onclick = () => App.printInvoice(sale, 'thermal');
      setTimeout(() => App.$('#nb', m.el).focus(), 50);
      App.$('#nb', m.el).addEventListener('click', () => setTimeout(() => App.$('#posScan') && App.$('#posScan').focus(), 30));
    } catch (e) {
      App.err(e);
    } finally {
      saving = false;
    }
  }

  /* ---------- page ---------- */
  function renderAll() {
    const pt = App.$('#posPriceType');
    if (pt) pt.value = state.priceType;
    const inc = App.$('#posInclusive');
    if (inc) inc.checked = state.inclusive;
    const bd = App.$('#posBillDisc');
    if (bd) bd.value = state.billDiscount || '';
    const bdp = App.$('#posBillDiscPct');
    if (bdp) bdp.value = state.billDiscountPct ? 'pct' : 'amt';
    const notes = App.$('#posNotes');
    if (notes) notes.value = state.notes || '';
    const box = App.$('#posPay');
    if (box) box.dataset.built = '';
    renderCustomer();
    renderCart();
    const hb = App.$('#heldCount');
    if (hb) hb.textContent = held().length ? `(${held().length})` : '';
  }

  function onKey(e) {
    if (!App.$('#posScan') || document.querySelector('.modal-bg')) {
      if (e.key === 'Enter' && document.querySelector('.modal-bg #nb') && document.activeElement && document.activeElement.id === 'nb') return;
      return;
    }
    if (e.key === 'F4') { e.preventDefault(); const cs = App.$('#custSearch'); if (cs) cs.focus(); }
    else if (e.key === 'F8') { e.preventDefault(); const pa = App.$('[data-pa="0"]'); if (pa) { pa.focus(); pa.select(); } }
    else if (e.key === 'F9') { e.preventDefault(); save(true); }
    else if (e.key === 'F10') { e.preventDefault(); save(false); }
  }

  App.pages.pos = {
    title: 'POS Billing',
    destroy() { document.removeEventListener('keydown', onKey); },
    async render(el) {
      if (!state.cart.length && !state.customer) reset();
      el.innerHTML = `<div class="pos">
        <div>
          <div class="card">
            <div class="pos-scan"><input id="posScan" placeholder="Scan barcode or type fabric name / SKU / colour and press Enter" autocomplete="off">
              <button type="button" class="btn" id="posHold">Hold</button>
              <button type="button" class="btn" id="posRecall">Recall <span id="heldCount"></span></button>
              <button type="button" class="btn danger" id="posClear">Clear</button></div>
            <div class="inline" style="flex-wrap:wrap;gap:10px;margin-bottom:10px">
              <label class="f auto"><span>Price list</span><select id="posPriceType">${App.options([{ value: 'wholesale', label: 'Wholesale' }, { value: 'retail', label: 'Retail' }], state.priceType)}</select></label>
              ${App.taxOn() ? `<label class="chk auto" style="margin-top:18px"><input type="checkbox" id="posInclusive" ${state.inclusive ? 'checked' : ''}> Rates include ${esc(App.taxName())}</label>` : ''}
              <span class="grow"></span>
            </div>
            <div class="pos-cart" id="posCart"></div>
          </div>
        </div>
        <div class="pos-side">
          <div class="card" style="margin:0"><h3>Customer</h3><div id="posCust"></div></div>
          <div class="pos-total" id="posTotals"></div>
          <div class="card" style="margin:0">
            <div class="inline" style="margin-bottom:8px"><label class="f"><span>Bill discount</span><input type="number" id="posBillDisc" min="0" step="0.01" placeholder="0"></label>
              <label class="f" style="flex:0 0 90px"><span>&nbsp;</span><select id="posBillDiscPct"><option value="amt">₹</option><option value="pct">%</option></select></label></div>
            <h3 style="margin-top:6px">Payment <span class="kbd">F8</span></h3>
            <div id="posPay"></div>
            <input id="posNotes" placeholder="Note on bill (optional)" style="margin-top:8px">
            <div class="inline" style="margin-top:12px">
              <button type="button" class="btn ok lg" id="posSavePrint">Save &amp; Print <span class="kbd">F9</span></button>
              <button type="button" class="btn lg auto" id="posSave" title="Save without printing">Save <span class="kbd">F10</span></button>
            </div>
          </div>
        </div></div>`;
      const scan = App.$('#posScan');
      await App.loadProducts(true);
      App.productPicker(scan, addProduct, { extra: (p) => `${fq(p.stock)} ${esc(p.unit)}<br><b>${money(rateFor(p))}</b>` });
      App.$('#posPriceType').onchange = (e) => { state.priceType = e.target.value; state.cart.forEach((l) => { l.rate = rateFor(l.product); }); renderCart(); };
      if (App.$('#posInclusive')) App.$('#posInclusive').onchange = (e) => { state.inclusive = e.target.checked; renderCart(); };
      App.$('#posBillDisc').oninput = (e) => { state.billDiscount = e.target.value; renderTotals(); };
      App.$('#posBillDiscPct').onchange = (e) => { state.billDiscountPct = e.target.value === 'pct'; renderTotals(); };
      App.$('#posNotes').oninput = (e) => { state.notes = e.target.value; };
      App.$('#posSavePrint').onclick = () => save(true);
      App.$('#posSave').onclick = () => save(false);
      App.$('#posHold').onclick = holdBill;
      App.$('#posRecall').onclick = recallBill;
      App.$('#posClear').onclick = async () => { if (!state.cart.length || await App.confirm('Clear the current bill?')) { reset(); renderAll(); scan.focus(); } };
      document.addEventListener('keydown', onKey);
      renderAll();
      scan.focus();
    }
  };
})();
