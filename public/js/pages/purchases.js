/* Local (domestic) purchase bills + reusable line-item editor */
(function () {
  const { esc, money } = App;

  /*
   * Generic editable item grid.
   * cols: [{ key, label, input: 'number'|'text', step, width, fmt(line, i) }]
   * Returns { draw } ; calls onChange(lines) after edits.
   */
  App.itemsEditor = function (box, lines, cols, onChange) {
    const draw = () => {
      box.innerHTML = App.table(lines, [
        { label: '#', fmt: (l) => lines.indexOf(l) + 1 },
        { label: 'Product', fmt: (l) => `<b>${esc(l.name)}</b><br><small class="muted">${esc(l.sku || '')} · ${esc(l.unit || '')}${l.size ? ' · ' + esc(l.size) : ''}</small>` },
        ...cols.map((c) => ({
          label: c.label, num: true,
          fmt: (l) => (c.input ? `<input type="${c.input}" step="${c.step || '0.01'}" data-skip data-k="${c.key}" data-i="${lines.indexOf(l)}" value="${l[c.key] == null ? '' : esc(l[c.key])}" style="width:${c.width || 100}px">`
            : `<span data-out="${c.key}" data-i="${lines.indexOf(l)}">${c.fmt(l, lines.indexOf(l))}</span>`)
        })),
        { label: '', fmt: (l) => `<button type="button" class="btn sm danger" data-x="${lines.indexOf(l)}">✕</button>` }
      ], { empty: 'Search and add products above' });
      App.$$('input[data-k]', box).forEach((inp) => inp.addEventListener('input', () => {
        const l = lines[Number(inp.dataset.i)];
        l[inp.dataset.k] = inp.type === 'number' ? (inp.value === '' ? '' : Number(inp.value)) : inp.value;
        refresh();
        onChange && onChange(lines);
      }));
      App.$$('[data-x]', box).forEach((b) => b.onclick = () => { lines.splice(Number(b.dataset.x), 1); draw(); onChange && onChange(lines); });
    };
    const refresh = () => {
      App.$$('[data-out]', box).forEach((s) => {
        const c = cols.find((x) => x.key === s.dataset.out);
        s.innerHTML = c.fmt(lines[Number(s.dataset.i)], Number(s.dataset.i));
      });
    };
    draw();
    return { draw, refresh };
  };

  async function purchaseForm(done) {
    const supOpts = await App.get('/api/suppliers?type=local');
    const lines = [];
    let suppliers = supOpts;
    const m = App.modal({
      title: 'New local purchase bill (LKR)', xwide: true, sticky: true,
      body: `<div class="form-grid">
          <label class="f span2"><span>Supplier *</span><div class="inline"><select name="supplier_id" required>${App.options(suppliers.map((s) => ({ value: s.id, label: s.name })), '', { blank: '-- select supplier --' })}</select>
            <button type="button" class="btn sm auto" id="newSup">+ New</button></div></label>
          ${App.field('Supplier bill no.', 'bill_no', '', { required: true })}${App.field('Bill date', 'date', App.today(), { type: 'date' })}
          ${App.field('Transport / other charges (Rs., added to cost)', 'other_charges', 0, { type: 'number', step: '0.01' })}
          ${App.field('Notes', 'notes', '')}</div>
        <div style="margin:14px 0 8px"><input id="purPick" placeholder="Search product to add (name / SKU / barcode)…" data-skip></div>
        <div id="purLines"></div><div id="purTot" class="calc-box" style="margin-top:12px"></div>`,
      submitText: 'Save purchase & add stock',
      onSubmit: async (f) => {
        const d = App.formData(f);
        if (!d.supplier_id) { App.toast('Select supplier', 'err'); return false; }
        d.items = lines.map((l) => ({ product_id: l.product_id, qty: l.qty, rate: l.rate, discount_pct: l.discount_pct, tax_rate: l.tax_rate, sale_price: l.sale_price, update_sale_price: l.sale_price !== l.orig_sale }));
        const r = await App.post('/api/purchases', d);
        App.products = null;
        App.toast(`Purchase ${r.ref_no} saved — ${money(r.total)}`, 'ok');
        done();
      }
    });
    const supSel = m.el.supplier_id;
    App.$('#newSup', m.el).onclick = () => App.supplierForm({ type: 'local', country: 'Sri Lanka', currency: 'LKR' }, async () => {
      suppliers = await App.get('/api/suppliers?type=local');
      supSel.innerHTML = App.options(suppliers.map((s) => ({ value: s.id, label: s.name })), suppliers[suppliers.length - 1].id);
      totals();
    });
    const calc = () => {
      return { c: Tax.computeBill(lines.map((l) => ({ qty: l.qty, rate: l.rate, discount_pct: l.discount_pct, tax_rate: l.tax_rate })), { tax_enabled: App.taxOn(), inclusive: false }) };
    };
    const totals = () => {
      const { c } = calc();
      const other = Number(m.el.other_charges.value) || 0;
      const T = c.totals;
      App.$('#purTot', m.el).innerHTML = `<dl class="kv"><dt>Goods value</dt><dd>${money(T.taxable)}</dd>
        ${App.taxOn() ? `<dt>${esc(App.taxName())}</dt><dd>${money(T.tax)}</dd>` : ''}
        <dt>Other charges</dt><dd>${money(other)}</dd><dt><b>Bill total</b></dt><dd><b>${money(T.total + other)}</b></dd></dl>`;
      ed.refresh();
    };
    const ed = App.itemsEditor(App.$('#purLines', m.el), lines, [
      { key: 'qty', label: 'Qty', input: 'number', width: 90 },
      { key: 'rate', label: 'Rate (Rs.)', input: 'number', width: 100 },
      { key: 'discount_pct', label: 'Disc %', input: 'number', width: 70 },
      ...(App.taxOn() ? [{ key: 'tax_rate', label: App.taxName() + ' %', input: 'number', width: 64 }] : []),
      { key: 'amount', label: 'Amount', fmt: (l, i) => App.num(calc().c.lines[i] ? calc().c.lines[i].taxable : 0) },
      { key: 'sale_price', label: 'Wholesale price', input: 'number', width: 100 }
    ], totals);
    App.productPicker(App.$('#purPick', m.el), (p) => {
      lines.push({ product_id: p.id, name: p.name, sku: p.sku, unit: p.unit, size: p.size, qty: '', rate: p.cost_price, discount_pct: '', tax_rate: p.tax_rate, sale_price: p.wholesale_price, orig_sale: p.wholesale_price });
      ed.draw();
      totals();
      setTimeout(() => { const q = App.$(`input[data-k="qty"][data-i="${lines.length - 1}"]`, m.el); if (q) q.focus(); }, 20);
    }, { extra: (p) => `Cost ${money(p.cost_price)}<br>Stock ${App.qty(p.stock)}` });
    supSel.onchange = totals;
    m.el.other_charges.oninput = totals;
    totals();
  }

  async function showPurchase(id, reload) {
    const p = await App.get('/api/purchases/' + id);
    const m = App.modal({
      title: `Purchase ${p.ref_no}`, wide: true,
      body: `<dl class="kv" style="margin-bottom:12px"><dt>Supplier</dt><dd><b>${esc(p.supplier_name)}</b> ${esc(p.supplier_vat_no || '')}</dd><dt>Bill no. / date</dt><dd>${esc(p.bill_no || '')} · ${App.date(p.date)}</dd></dl>
        ${App.table(p.items, [{ label: 'Item', fmt: (r) => `${esc(r.name)} <small class="muted">${esc(r.sku)}</small>` }, { label: 'Qty', num: true, fmt: (r) => `${App.qty(r.qty)} ${esc(r.unit)}` },
    { label: 'Rate', num: true, fmt: (r) => App.num(r.rate) }, { label: 'Amount', num: true, fmt: (r) => App.num(r.taxable) }, ...(App.taxOn() ? [{ label: App.taxName(), num: true, fmt: (r) => `${r.tax_rate}% · ${App.num(r.tax)}` }] : []),
    { label: 'Unit cost', num: true, fmt: (r) => App.num(r.unit_cost) }, { label: 'Total', num: true, fmt: (r) => App.num(r.total) }])}
        <dl class="kv" style="margin-top:12px"><dt>Goods value</dt><dd>${money(p.taxable)}</dd>${p.tax ? `<dt>${esc(App.taxName())}</dt><dd>${money(p.tax)}</dd>` : ''}<dt>Other charges</dt><dd>${money(p.other_charges)}</dd>
        <dt><b>Total</b></dt><dd><b>${money(p.total)}</b></dd></dl>`,
      footer: `${App.can('admin') ? '<button type="button" class="btn danger" id="pdel">Delete purchase</button>' : ''}<span class="grow"></span><button type="button" class="btn" data-close>Close</button>`
    });
    const del = App.$('#pdel', m.el);
    if (del) del.onclick = async () => {
      if (!await App.confirm('Delete this purchase? Its stock will be removed and the supplier ledger reversed.')) return;
      try { await App.del('/api/purchases/' + p.id); App.products = null; App.toast('Purchase deleted', 'ok'); m.close(); reload(); } catch (e) { App.err(e); }
    };
  }

  App.pages.purchases = {
    title: 'Local Purchases (LKR)', roles: ['admin', 'manager'],
    async render(el) {
      const f = { from: App.fyStart(), to: '' };
      el.innerHTML = `<div class="toolbar"><input type="date" id="uf" value="${f.from}" style="width:auto"><span>to</span><input type="date" id="ut" style="width:auto">
        <span class="spacer"></span><button class="btn" id="ux">Export CSV</button><button class="btn primary" id="un">+ New purchase bill</button></div><div id="ulist"></div>`;
      const cols = [
        { label: 'Ref', key: 'ref_no', fmt: (r) => `<b>${esc(r.ref_no)}</b>` }, { label: 'Bill no.', key: 'bill_no' }, { label: 'Date', key: 'date', fmt: (r) => App.date(r.date) },
        { label: 'Supplier', key: 'supplier_name' }, { label: 'Goods value', key: 'taxable', num: true, fmt: (r) => App.num(r.taxable) },
        ...(App.taxOn() ? [{ label: App.taxName(), key: 'tax', num: true, fmt: (r) => App.num(r.tax) }] : []),
        { label: 'Total', key: 'total', num: true, fmt: (r) => `<b>${App.num(r.total)}</b>` }
      ];
      let rows = [];
      const load = async () => {
        rows = await App.get('/api/purchases' + App.qs(f));
        App.$('#ulist').innerHTML = App.table(rows, cols, { onRow: true, empty: 'No purchase bills yet', foot: { ref_no: rows.length + ' bills', taxable: App.num(App.sum(rows, 'taxable')), tax: App.num(App.sum(rows, 'tax')), total: App.num(App.sum(rows, 'total')) } });
        App.bindRows(App.$('#ulist'), rows, (r) => showPurchase(r.id, load));
      };
      App.$('#uf').onchange = (e) => { f.from = e.target.value; load(); };
      App.$('#ut').onchange = (e) => { f.to = e.target.value; load(); };
      App.$('#un').onclick = () => purchaseForm(load);
      App.$('#ux').onclick = () => App.csv(rows, cols, `purchases-${App.today()}.csv`);
      await load();
    }
  };
})();
