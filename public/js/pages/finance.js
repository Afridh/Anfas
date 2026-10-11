/* Receipts & payments, expenses */
(function () {
  const { esc, money } = App;

  async function paymentForm(partyType, done) {
    const isCust = partyType === 'customer';
    const parties = await App.get(isCust ? '/api/customers' : '/api/suppliers');
    const m = App.modal({
      title: isCust ? 'Receive payment from customer' : 'Pay supplier', wide: true,
      body: `<div class="form-grid">
          ${App.field(isCust ? 'Customer' : 'Supplier', 'party_id', '', { type: 'select', required: true, cls: 'span2', options: App.options(parties.map((p) => ({ value: p.id, label: `${p.name}${p.phone ? ' · ' + p.phone : ''} — bal ${App.num(p.balance)}` })), '', { blank: '-- select --' }) })}
          ${App.field('Date', 'date', App.today(), { type: 'date' })}
          ${App.field('Direction', 'direction', '', { type: 'select', options: App.options(isCust ? [{ value: 'in', label: 'Receipt (customer pays us)' }, { value: 'out', label: 'Refund / advance returned' }] : [{ value: 'out', label: 'Payment (we pay supplier)' }, { value: 'in', label: 'Refund from supplier' }]) })}
          ${!isCust ? `${App.field('Paid in currency', 'fc_currency', '', { type: 'select', options: App.options(App.meta.currencies.filter((c) => c !== 'LKR'), 'INR', { blank: '— Sri Lankan rupees —' }) })}
            ${App.field('Amount in that currency', 'fc_amount', '', { type: 'number', step: '0.01' })}${App.field('Rate: 1 unit = Rs.', 'fc_rate', App.settings().grn_india_rate, { type: 'number', step: '0.0001' })}` : ''}
          ${App.field('Amount (Rs.)', 'amount', '', { type: 'number', step: '0.01', required: true })}
          ${App.field('Mode', 'mode', '', { type: 'select', options: App.modeOptions(isCust ? 'cash' : 'bank', true) })}
          ${App.field(isCust ? 'Reference (cheque no. / bank ref)' : 'Reference (TT / bank ref / hawala)', 'reference', '')}
          ${App.field('Notes', 'notes', '', { cls: 'span2' })}</div>
        <div id="pinfo" style="margin-top:12px"></div>`,
      submitText: 'Save',
      onSubmit: async (f) => {
        const d = App.formData(f);
        d.party_type = partyType;
        if (!d.fc_currency) { delete d.fc_amount; delete d.fc_rate; delete d.fc_currency; }
        d.sale_ids = App.$$('[data-inv]:checked', f).map((c) => Number(c.dataset.inv));
        const r = await App.post('/api/payments', d);
        App.toast(`Voucher ${r.voucher_no} saved`, 'ok');
        App.printVoucher(await App.get('/api/payments/' + r.id));
        done();
      }
    });
    const f = m.el;
    if (!isCust) {
      const fx = () => { if (f.fc_amount.value && f.fc_rate.value) f.amount.value = Tax.r2(Number(f.fc_amount.value) * Number(f.fc_rate.value)); };
      f.fc_amount.oninput = fx;
      f.fc_rate.oninput = fx;
    }
    f.party_id.onchange = async () => {
      const id = Number(f.party_id.value);
      const p = parties.find((x) => x.id === id);
      if (!p) { App.$('#pinfo', f).innerHTML = ''; return; }
      if (!isCust) f.fc_currency.value = p.currency && p.currency !== 'LKR' ? p.currency : '';
      let html = `<div class="calc-box">Current balance: <b>${money(p.balance)}</b> ${isCust ? (p.balance > 0 ? '(customer owes you)' : '') : (p.balance > 0 ? '(you owe)' : '(advance paid)')}</div>`;
      if (isCust) {
        const inv = (await App.get('/api/sales?customer_id=' + id)).filter((s) => !s.cancelled && s.total - s.returned - s.paid > 0.005);
        if (inv.length) {
          html += `<p class="muted">Open invoices — tick to settle specific ones, or leave blank to settle oldest first:</p>` + App.table(inv, [
            { label: '', fmt: (s) => `<input type="checkbox" data-inv="${s.id}" data-skip>` }, { label: 'Invoice', key: 'invoice_no' }, { label: 'Date', fmt: (s) => App.date(s.date) },
            { label: 'Total', num: true, fmt: (s) => App.num(s.total) }, { label: 'Due', num: true, fmt: (s) => `<b>${App.num(s.total - s.returned - s.paid)}</b>` }]);
        }
      }
      App.$('#pinfo', f).innerHTML = html;
      if (isCust && !f.amount.value && p.balance > 0) f.amount.value = Tax.r2(p.balance);
    };
  }

  async function showVoucher(id, reload) {
    const p = await App.get('/api/payments/' + id);
    const m = App.modal({
      title: `Voucher ${p.voucher_no}`,
      body: `<dl class="kv"><dt>Date</dt><dd>${App.date(p.date)}</dd><dt>${p.party_type === 'customer' ? 'Customer' : 'Supplier'}</dt><dd><b>${esc(p.party_name)}</b></dd>
        <dt>Type</dt><dd>${p.direction === 'in' ? 'Receipt' : 'Payment'}</dd><dt>Amount</dt><dd><b>${money(p.amount)}</b></dd>
        <dt>Mode</dt><dd>${esc(App.modeLabel(p.mode))} ${esc(p.reference || '')}</dd>
        ${p.fc_amount ? `<dt>Foreign currency</dt><dd>${App.fc(p.fc_amount, p.fc_currency)} @ ${p.fc_rate}</dd>` : ''}
        ${p.allocations.length ? `<dt>Settled</dt><dd>${p.allocations.map((a) => `${esc(a.invoice_no)} ${money(a.amount)}`).join('<br>')}</dd>` : ''}
        ${p.notes ? `<dt>Notes</dt><dd>${esc(p.notes)}</dd>` : ''}</dl>`,
      footer: `${App.can('admin') ? '<button type="button" class="btn danger" id="vdel">Delete</button>' : ''}<span class="grow"></span><button type="button" class="btn primary" id="vpr">Print</button>`
    });
    App.$('#vpr', m.el).onclick = () => App.printVoucher(p);
    const del = App.$('#vdel', m.el);
    if (del) del.onclick = async () => {
      if (!await App.confirm('Delete this voucher? Ledger and invoice settlements will be reversed.')) return;
      try { await App.del('/api/payments/' + p.id); App.toast('Voucher deleted', 'ok'); m.close(); reload(); } catch (e) { App.err(e); }
    };
  }

  App.pages.payments = {
    title: 'Receipts & Payments', roles: ['admin', 'manager'],
    async render(el) {
      const f = { from: App.monthStart(), to: '', party_type: '' };
      el.innerHTML = `<div class="toolbar"><input type="date" id="yf" value="${f.from}" style="width:auto"><span>to</span><input type="date" id="yt" style="width:auto">
          <select id="yp" style="width:auto">${App.options([{ value: 'customer', label: 'Customers' }, { value: 'supplier', label: 'Suppliers' }], '', { blank: 'All parties' })}</select>
          <span class="spacer"></span><button class="btn" id="yx">Export CSV</button><button class="btn" id="ypay">Pay supplier</button><button class="btn primary" id="yrec">Receive from customer</button></div><div id="ylist"></div>`;
      const cols = [
        { label: 'Voucher', key: 'voucher_no', fmt: (r) => `<b>${esc(r.voucher_no)}</b>` }, { label: 'Date', key: 'date', fmt: (r) => App.date(r.date) },
        { label: 'Party', key: 'party_name', fmt: (r) => `${esc(r.party_name)} <small class="muted">${esc(r.party_type)}</small>` },
        { label: 'Mode', key: 'mode', fmt: (r) => esc(App.modeLabel(r.mode)) }, { label: 'Reference', key: 'reference' },
        { label: 'FC', key: 'fc_amount', num: true, fmt: (r) => (r.fc_amount ? App.fc(r.fc_amount, r.fc_currency) : '') },
        { label: 'In', key: 'in', num: true, fmt: (r) => (r.direction === 'in' ? App.num(r.amount) : ''), csv: (r) => (r.direction === 'in' ? r.amount : '') },
        { label: 'Out', key: 'out', num: true, fmt: (r) => (r.direction === 'out' ? App.num(r.amount) : ''), csv: (r) => (r.direction === 'out' ? r.amount : '') },
        { label: 'By', key: 'user_name' }
      ];
      let rows = [];
      const load = async () => {
        rows = await App.get('/api/payments' + App.qs(f));
        App.$('#ylist').innerHTML = App.table(rows, cols, { onRow: true, empty: 'No vouchers in this period',
          foot: { voucher_no: rows.length + ' vouchers', in: App.num(App.sum(rows.filter((r) => r.direction === 'in'), 'amount')), out: App.num(App.sum(rows.filter((r) => r.direction === 'out'), 'amount')) } });
        App.bindRows(App.$('#ylist'), rows, (r) => showVoucher(r.id, load));
      };
      App.$('#yf').onchange = (e) => { f.from = e.target.value; load(); };
      App.$('#yt').onchange = (e) => { f.to = e.target.value; load(); };
      App.$('#yp').onchange = (e) => { f.party_type = e.target.value; load(); };
      App.$('#yrec').onclick = () => paymentForm('customer', load);
      App.$('#ypay').onclick = () => paymentForm('supplier', load);
      App.$('#yx').onclick = () => App.csv(rows, cols, `vouchers-${App.today()}.csv`);
      await load();
    }
  };

  function expenseForm(e, done) {
    const isNew = !e;
    e = e || { date: App.today(), mode: 'cash' };
    App.modal({
      title: isNew ? 'New expense' : 'Edit expense',
      body: `<div class="form-grid">${App.field('Date', 'date', e.date, { type: 'date' })}
        ${App.field('Category', 'category', '', { type: 'select', options: App.options(App.meta.expense_categories, e.category) })}
        ${App.field('Amount (Rs.)', 'amount', e.amount || '', { type: 'number', step: '0.01', required: true })}
        ${App.field('Mode', 'mode', '', { type: 'select', options: App.modeOptions(e.mode, true) })}
        ${App.field('Paid to', 'paid_to', e.paid_to || '')}${App.field('Notes', 'notes', e.notes || '')}</div>`,
      onSubmit: async (f) => {
        const d = App.formData(f);
        if (isNew) await App.post('/api/expenses', d); else await App.put('/api/expenses/' + e.id, d);
        App.toast('Expense saved', 'ok');
        done();
      }
    });
  }

  App.pages.expenses = {
    title: 'Expenses', roles: ['admin', 'manager'],
    async render(el) {
      const f = { from: App.monthStart(), to: '', category: '' };
      el.innerHTML = `<div class="toolbar"><input type="date" id="ef" value="${f.from}" style="width:auto"><span>to</span><input type="date" id="et" style="width:auto">
        <select id="ec" style="width:auto">${App.options(App.meta.expense_categories, '', { blank: 'All categories' })}</select>
        <span class="spacer"></span><button class="btn" id="ex">Export CSV</button><button class="btn primary" id="en">+ New expense</button></div><div id="elist"></div>`;
      const cols = [
        { label: 'Date', key: 'date', fmt: (r) => App.date(r.date) }, { label: 'Category', key: 'category' }, { label: 'Paid to', key: 'paid_to' },
        { label: 'Mode', key: 'mode', fmt: (r) => esc(App.modeLabel(r.mode)) }, { label: 'Notes', key: 'notes' },
        { label: 'Amount', key: 'amount', num: true, fmt: (r) => `<b>${App.num(r.amount)}</b>` },
        { label: '', fmt: (r) => `<button class="btn sm danger" data-del="${r.id}">Delete</button>` }
      ];
      let rows = [];
      const load = async () => {
        rows = await App.get('/api/expenses' + App.qs(f));
        App.$('#elist').innerHTML = App.table(rows, cols, { onRow: true, empty: 'No expenses in this period', foot: { date: rows.length + ' entries', amount: App.num(App.sum(rows, 'amount')) } });
        App.bindRows(App.$('#elist'), rows, (r) => expenseForm(r, load));
        App.$$('[data-del]').forEach((b) => b.onclick = async () => {
          if (await App.confirm('Delete this expense?')) { await App.del('/api/expenses/' + b.dataset.del); load(); }
        });
      };
      App.$('#ef').onchange = (e) => { f.from = e.target.value; load(); };
      App.$('#et').onchange = (e) => { f.to = e.target.value; load(); };
      App.$('#ec').onchange = (e) => { f.category = e.target.value; load(); };
      App.$('#en').onclick = () => expenseForm(null, load);
      App.$('#ex').onclick = () => App.csv(rows, cols.filter((c) => c.key), `expenses-${App.today()}.csv`);
      await load();
    }
  };
})();
