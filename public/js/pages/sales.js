/* Invoices list, invoice view (print / collect / return / cancel), returns list */
(function () {
  const { esc, money } = App;

  App.showSale = async function (id, onChange) {
    let sale;
    try { sale = await App.get('/api/sales/' + id); } catch (e) { return App.err(e); }
    const vat = !!sale.tax_enabled;
    const tn = esc(App.taxName());
    const due = Tax.r2(sale.total - sale.returned - sale.paid);
    const m = App.modal({
      title: `Invoice ${sale.invoice_no}`, wide: true,
      body: `<div class="grid g2" style="margin-bottom:12px">
          <dl class="kv"><dt>Customer</dt><dd><b>${esc(sale.customer_name)}</b> ${sale.customer_phone ? esc(sale.customer_phone) : ''}</dd>
            ${sale.customer_vat_no ? `<dt>${tn} No.</dt><dd>${esc(sale.customer_vat_no)}</dd>` : ''}
            <dt>Price list</dt><dd>${sale.price_type === 'retail' ? 'Retail' : 'Wholesale'}</dd>
            <dt>Billed by</dt><dd>${esc(sale.user_name || '')} · ${esc(sale.created_at)}</dd></dl>
          <dl class="kv"><dt>Date</dt><dd>${App.date(sale.date)}</dd><dt>Status</dt><dd>${App.statusBadge(sale.status)}</dd>
            <dt>Total</dt><dd><b>${money(sale.total)}</b></dd>${sale.returned ? `<dt>Returned</dt><dd>${money(sale.returned)}</dd>` : ''}
            <dt>Paid</dt><dd>${money(sale.paid)}</dd>${due > 0.005 ? `<dt>Balance due</dt><dd><b style="color:var(--bad)">${money(due)}</b></dd>` : ''}</dl></div>
        ${App.table(sale.items, [
    { label: 'Item', fmt: (r) => esc(r.name) },
    { label: 'Qty', num: true, fmt: (r) => `${App.qty(r.qty)} ${esc(r.unit || '')}${r.returned_qty ? `<br><small style="color:var(--bad)">ret ${App.qty(r.returned_qty)}</small>` : ''}` },
    { label: 'Rate', num: true, fmt: (r) => App.num(r.rate) },
    { label: 'Disc', num: true, fmt: (r) => (r.discount ? App.num(r.discount) : '') },
    ...(vat ? [{ label: 'Excl. ' + App.taxName(), num: true, fmt: (r) => App.num(r.taxable) },
      { label: App.taxName(), num: true, fmt: (r) => `${r.tax_rate}%<br><small>${App.num(r.tax)}</small>` }] : []),
    { label: 'Total', num: true, fmt: (r) => App.num(r.total) }
  ])}
        <div class="grid g2" style="margin-top:12px">
          <div>${sale.payments.length || sale.receipts.length ? `<b>Payments</b><br>${sale.payments.map((p) => `${esc(App.modeLabel(p.mode))} ${money(p.amount)}${p.reference ? ' (' + esc(p.reference) + ')' : ''}`).join('<br>')}
            ${sale.receipts.map((p) => `<br>${esc(p.voucher_no)} · ${App.date(p.date)} · ${esc(App.modeLabel(p.mode))} ${money(p.amount)}`).join('')}` : '<span class="muted">No payments</span>'}
            ${sale.returns.length ? `<br><br><b>Credit notes</b><br>${sale.returns.map((r) => `<a href="#" data-cn="${r.id}">${esc(r.return_no)}</a> · ${App.date(r.date)} · ${money(r.total)}`).join('<br>')}` : ''}
            ${sale.notes ? `<br><br><b>Notes:</b> ${esc(sale.notes)}` : ''}</div>
          <dl class="kv" style="justify-self:end">
            ${vat ? `<dt>Excl. ${tn}</dt><dd class="right">${App.num(sale.taxable)}</dd><dt>${tn}</dt><dd class="right">${App.num(sale.tax)}</dd>` : `<dt>Gross</dt><dd class="right">${App.num(sale.gross)}</dd><dt>Discount</dt><dd class="right">${App.num(sale.discount)}</dd>`}
            <dt>Round off</dt><dd class="right">${App.num(sale.round_off)}</dd><dt><b>Total</b></dt><dd class="right"><b>${money(sale.total)}</b></dd></dl></div>`,
      footer: `${!sale.cancelled && App.isStaff() && !sale.returns.length ? '<button type="button" class="btn danger" id="sCancel">Cancel invoice</button>' : ''}
        <span class="grow"></span>
        ${!sale.cancelled && sale.items.some((i) => i.qty > i.returned_qty) ? '<button type="button" class="btn" id="sReturn">Return items</button>' : ''}
        ${!sale.cancelled && due > 0.005 ? '<button type="button" class="btn" id="sPay">Collect payment</button>' : ''}
        <button type="button" class="btn" id="sTh">Print 80mm</button><button type="button" class="btn primary" id="sA4">Print A4</button>`
    });
    const refresh = () => { m.close(); if (onChange) onChange(); App.showSale(id, onChange); };
    App.$('#sA4', m.el).onclick = () => App.printInvoice(sale, 'a4');
    App.$('#sTh', m.el).onclick = () => App.printInvoice(sale, 'thermal');
    App.$$('[data-cn]', m.el).forEach((a) => a.onclick = async (e) => { e.preventDefault(); App.printCreditNote(await App.get('/api/returns/' + a.dataset.cn)); });
    const pay = App.$('#sPay', m.el);
    if (pay) pay.onclick = () => App.modal({
      title: `Collect payment — ${sale.invoice_no}`,
      body: `<div class="form-grid">${App.field('Amount', 'amount', due, { type: 'number', step: '0.01', required: true })}
        ${App.field('Mode', 'mode', '', { type: 'select', options: App.modeOptions('cash', true) })}
        ${App.field('Date', 'date', App.today(), { type: 'date' })}${App.field('Reference (cheque / transfer no.)', 'reference', '')}</div>`,
      onSubmit: async (f) => { await App.post(`/api/sales/${sale.id}/payment`, App.formData(f)); App.toast('Payment recorded', 'ok'); refresh(); }
    });
    const cancel = App.$('#sCancel', m.el);
    if (cancel) cancel.onclick = async () => {
      const d = await App.prompt('Cancel invoice ' + sale.invoice_no, App.field('Reason', 'reason', '', { required: true, cls: 'full' }) +
        '<p class="muted full" style="margin:0">Stock will be added back and customer ledger entries reversed. The invoice number stays in the register as cancelled.</p>', 'Cancel invoice');
      if (!d) return;
      try { await App.post(`/api/sales/${sale.id}/cancel`, d); App.toast('Invoice cancelled', 'ok'); refresh(); } catch (e) { App.err(e); }
    };
    const ret = App.$('#sReturn', m.el);
    if (ret) ret.onclick = () => returnDialog(sale, refresh);
  };

  function returnDialog(sale, done) {
    const open = sale.items.filter((i) => i.qty > i.returned_qty);
    App.modal({
      title: `Sales return — ${sale.invoice_no}`, wide: true,
      body: `${App.table(open, [
        { label: 'Item', fmt: (r) => esc(r.name) },
        { label: 'Sold', num: true, fmt: (r) => `${App.qty(r.qty)} ${esc(r.unit || '')}` },
        { label: 'Already returned', num: true, fmt: (r) => App.qty(r.returned_qty) },
        { label: 'Rate', num: true, fmt: (r) => App.num(r.total / r.qty) },
        { label: 'Return qty', num: true, fmt: (r) => `<input type="number" step="0.01" min="0" max="${r.qty - r.returned_qty}" data-ret="${r.id}" style="width:100px">` }
      ])}
      <div class="form-grid" style="margin-top:12px">
        ${App.field('Settlement', 'refund_mode', '', { type: 'select', options: App.options([...(sale.customer_id ? [{ value: 'credit', label: 'Credit note (adjust in account)' }] : []), { value: 'cash', label: 'Cash refund' }, { value: 'bank', label: 'Bank transfer refund' }, { value: 'lankaqr', label: 'LankaQR refund' }], sale.customer_id ? 'credit' : 'cash') })}
        ${App.field('Date', 'date', App.today(), { type: 'date' })}
        ${App.field('Reason', 'reason', '', { cls: 'span2', placeholder: 'e.g. colour mismatch, defect' })}
        <label class="chk"><input type="checkbox" name="restock" checked> Add returned goods back to stock</label></div>`,
      submitText: 'Create credit note',
      onSubmit: async (f) => {
        const d = App.formData(f);
        d.items = App.$$('[data-ret]', f).map((i) => ({ sale_item_id: Number(i.dataset.ret), qty: Number(i.value) || 0 })).filter((i) => i.qty > 0);
        if (!d.items.length) { App.toast('Enter return quantity', 'err'); return false; }
        const r = await App.post(`/api/sales/${sale.id}/return`, d);
        App.products = null;
        App.toast(`Credit note ${r.return_no} created${r.refunded ? ' — refund ' + money(r.refunded) : ''}`, 'ok');
        App.printCreditNote(await App.get('/api/returns/' + r.id));
        done();
      }
    });
  }

  App.pages.sales = {
    title: 'Invoices',
    async render(el) {
      const f = { from: App.isStaff() ? App.monthStart() : '', to: '', q: '', status: '' };
      el.innerHTML = `<div class="toolbar">
          <input type="search" id="sq" placeholder="Search invoice no / customer / phone" style="max-width:300px">
          ${App.isStaff() ? `<input type="date" id="sf" value="${f.from}" style="width:auto"><span>to</span><input type="date" id="st" style="width:auto">` : ''}
          <select id="ss" style="width:auto">${App.options(['paid', 'partial', 'unpaid', 'returned', 'cancelled'].map((x) => ({ value: x, label: x })), '', { blank: 'All statuses' })}</select>
          <span class="spacer"></span><button class="btn" id="sx">Export CSV</button><a class="btn primary" href="#/pos">+ New bill</a></div>
        <div id="slist"></div>`;
      const cols = [
        { label: 'Invoice', key: 'invoice_no', fmt: (r) => `<b>${esc(r.invoice_no)}</b>` },
        { label: 'Date', key: 'date', fmt: (r) => App.date(r.date), csv: (r) => r.date },
        { label: 'Customer', key: 'customer_name' },
        ...(App.taxOn() ? [{ label: 'Excl. ' + App.taxName(), key: 'taxable', num: true, fmt: (r) => App.num(r.taxable) },
          { label: App.taxName(), key: 'tax', num: true, fmt: (r) => App.num(r.tax) }] : []),
        { label: 'Total', key: 'total', num: true, fmt: (r) => `<b>${App.num(r.total)}</b>` },
        { label: 'Paid', key: 'paid', num: true, fmt: (r) => App.num(r.paid) },
        { label: 'Mode', key: 'modes', fmt: (r) => esc((r.modes || (r.total > r.paid ? 'credit' : '')).split('+').map(App.modeLabel).join(' + ')) },
        { label: 'Status', key: 'status', fmt: (r) => App.statusBadge(r.status) },
        { label: 'By', key: 'user_name' }
      ];
      let rows = [];
      const load = async () => {
        rows = await App.get('/api/sales' + App.qs({ from: f.from, to: f.to, q: f.q, status: f.status }));
        const valid = rows.filter((r) => !r.cancelled);
        App.$('#slist').innerHTML = App.table(rows, cols, {
          onRow: true, rowCls: (r) => (r.cancelled ? 'dim' : ''),
          foot: { invoice_no: `${valid.length} invoices`, taxable: App.num(App.sum(valid, 'taxable')), tax: App.num(App.sum(valid, 'tax')),
            total: App.num(App.sum(valid, 'total')), paid: App.num(App.sum(valid, 'paid')) }
        });
        App.bindRows(App.$('#slist'), rows, (r) => App.showSale(r.id, load));
      };
      App.$('#sq').oninput = App.debounce((e) => { f.q = e.target.value; load(); }, 300);
      if (App.$('#sf')) {
        App.$('#sf').onchange = (e) => { f.from = e.target.value; load(); };
        App.$('#st').onchange = (e) => { f.to = e.target.value; load(); };
      }
      App.$('#ss').onchange = (e) => { f.status = e.target.value; load(); };
      App.$('#sx').onclick = () => App.csv(rows, cols, `invoices-${App.today()}.csv`);
      await load();
    }
  };

  App.pages.returns = {
    title: 'Returns / Credit Notes',
    async render(el) {
      const f = { from: App.isStaff() ? App.monthStart() : App.today(), to: '' };
      el.innerHTML = `<div class="toolbar"><input type="date" id="rf" value="${f.from}" style="width:auto"><span>to</span><input type="date" id="rt" style="width:auto">
        <span class="spacer"></span><span class="muted">To create a return, open the invoice from <a href="#/sales">Invoices</a> and click “Return items”.</span></div><div id="rlist"></div>`;
      const load = async () => {
        const rows = await App.get('/api/returns' + App.qs(f));
        App.$('#rlist').innerHTML = App.table(rows, [
          { label: 'Credit note', fmt: (r) => `<b>${esc(r.return_no)}</b>` }, { label: 'Date', fmt: (r) => App.date(r.date) },
          { label: 'Invoice', key: 'invoice_no' }, { label: 'Customer', key: 'customer_name' },
          ...(App.taxOn() ? [{ label: App.taxName(), num: true, fmt: (r) => App.num(r.tax) }] : []),
          { label: 'Total', num: true, fmt: (r) => `<b>${App.num(r.total)}</b>` }, { label: 'Settlement', fmt: (r) => esc(r.refund_mode === 'credit' ? 'Credit to account' : App.modeLabel(r.refund_mode)) },
          { label: 'Reason', key: 'reason' }
        ], { onRow: true, empty: 'No returns in this period' });
        App.bindRows(App.$('#rlist'), rows, async (r) => App.printCreditNote(await App.get('/api/returns/' + r.id)));
      };
      App.$('#rf').onchange = (e) => { f.from = e.target.value; load(); };
      App.$('#rt').onchange = (e) => { f.to = e.target.value; load(); };
      await load();
    }
  };
})();
