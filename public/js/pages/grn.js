/* GRN — Goods Receipt Note */
(function () {
  const { esc, money } = App;
  const n = App.num;
  const BASIS = [{ value: 'per_piece', label: 'Per piece' }, { value: 'per_grn', label: 'Total for this GRN (shared per piece)' }];

  async function grnForm(done) {
    const [d, suppliers0] = await Promise.all([App.get('/api/grn/defaults'), App.get('/api/suppliers')]);
    let suppliers = suppliers0;
    const lines = [];
    const m = App.modal({
      title: 'New GRN — Goods received from India', xwide: true, sticky: true,
      body: `<div class="form-sec" style="margin-top:0">Receipt details</div><div class="form-grid">
          <label class="f span2"><span>Supplier name *</span><div class="inline"><select name="supplier_id" required>${App.options(suppliers.map((s) => ({ value: s.id, label: s.name + (s.country ? ` (${s.country})` : '') })), '', { blank: '-- select supplier --' })}</select>
            <button type="button" class="btn sm auto" id="gNewSup">+ New</button></div></label>
          ${App.field('GRN date', 'date', App.today(), { type: 'date' })}
          ${App.field('Cargo name', 'cargo_name', '', { placeholder: 'Transport / cargo company' })}
          ${App.field('Bale number', 'bale_no', '')}
          ${App.field('LR number', 'lr_no', '', { placeholder: 'Lorry receipt no.' })}</div>
        <div class="form-sec">Costing — Cost (Rs.) = India cost (₹) × Indian rupee rate + Other expenses (Rs.) + Cargo / shipping (Rs.)</div><div class="form-grid">
          ${App.field('Indian rupee rate: 1 ₹ = Rs. (default ' + d.india_rate + ')', 'india_rate', d.india_rate, { type: 'number', step: '0.0001', required: true })}
          ${App.field('Other expenses Rs. (default ' + d.other_expenses + ')', 'other_expenses', d.other_expenses, { type: 'number', step: '0.01' })}
          ${App.field('Cargo / shipping charge (Rs.)', 'cargo_charge', 0, { type: 'number', step: '0.01' })}
          ${App.field('Cargo & other expenses are', 'charges_basis', '', { type: 'select', options: App.options(BASIS, d.charges_basis) })}
          ${App.field('Notes', 'notes', '', { cls: 'span2' })}
          <label class="chk span2"><input type="checkbox" name="save_defaults"> Use this rupee rate &amp; other expenses as the default for the next GRN</label></div>
        <div class="form-sec">Items in this bale</div>
        <div class="inline" style="margin-bottom:8px"><input id="gPick" placeholder="Search product to add (name / SKU / barcode)…" data-skip>
          <button type="button" class="btn auto" id="gNewProd">+ New product</button></div>
        <div id="gLines"></div><div id="gTot" class="calc-box" style="margin-top:12px"></div>`,
      submitText: 'Save GRN & add to stock',
      onSubmit: async (f) => {
        const data = App.formData(f);
        if (!data.supplier_id) { App.toast('Select supplier', 'err'); return false; }
        if (!lines.length) { App.toast('Add at least one item', 'err'); return false; }
        const bad = lines.find((l) => !(Number(l.pcs) > 0));
        if (bad) { App.toast(`Enter Pcs for ${bad.name}`, 'err'); return false; }
        data.items = lines.map((l) => ({ product_id: l.product_id, india_cost: l.india_cost, pcs: l.pcs, bundles: l.bundles, pcs_per_set: l.pcs_per_set,
          colours: l.colours, size: l.size, expected_price: l.expected_price }));
        const r = await App.post('/api/grn', data);
        App.products = null;
        App.toast(`${r.grn_no} saved — final cost ${money(r.final_total)}`, 'ok');
        done();
      }
    });
    const f = m.el;
    const header = () => ({ india_rate: f.india_rate.value, other_expenses: f.other_expenses.value, cargo_charge: f.cargo_charge.value, charges_basis: f.charges_basis.value });
    const calc = () => Tax.grnCost(header(), lines);
    const totals = () => {
      const c = calc();
      const T = c.totals;
      const h = header();
      const perGrn = h.charges_basis === 'per_grn';
      App.$('#gTot', f).innerHTML = `<div class="grid g3">
        <dl class="kv"><dt>Total pcs</dt><dd><b>${App.qty(T.pcs)}</b></dd><dt>Bundles</dt><dd>${App.qty(App.sum(lines, 'bundles'))}</dd>
          <dt>Items / colours</dt><dd>${lines.length} / ${App.sum(lines, 'colours')}</dd></dl>
        <dl class="kv"><dt>India cost (₹)</dt><dd>${App.inr(T.india_value)}</dd><dt>× rate ${esc(h.india_rate)} =</dt><dd>${money(T.goods_value)}</dd><dt>+ Other expenses</dt><dd>${money(T.other_total)}${perGrn ? '' : ` <small class="muted">(${n(h.other_expenses)}/pc)</small>`}</dd>
          <dt>+ Cargo charge</dt><dd>${money(T.cargo_total)}${perGrn ? '' : ` <small class="muted">(${n(h.cargo_charge)}/pc)</small>`}</dd></dl>
        <dl class="kv"><dt><b>Final cost (total)</b></dt><dd><b style="font-size:1.2rem">${money(T.final_total)}</b></dd>
          <dt>Expected sales value</dt><dd>${money(App.sum(lines, (l) => (Number(l.expected_price) || 0) * (Number(l.pcs) || 0)))}</dd></dl></div>`;
      ed.refresh();
    };
    const lc = (i) => calc().lines[i] || { final_cost: 0, line_total: 0 };
    const ed = App.itemsEditor(App.$('#gLines', f), lines, [
      { key: 'india_cost', label: 'India cost ₹ /pc', input: 'number', width: 90 },
      { key: 'pcs', label: 'Pcs', input: 'number', step: '1', width: 70 },
      { key: 'bundles', label: 'Bundles', input: 'number', step: '1', width: 64 },
      { key: 'pcs_per_set', label: 'Pcs / set', input: 'number', step: '1', width: 64 },
      { key: 'colours', label: 'Colours', input: 'number', step: '1', width: 60 },
      { key: 'size', label: 'Size', input: 'text', width: 80 },
      { key: 'final', label: 'Cost Rs. /pc', fmt: (l, i) => `<b>${n(lc(i).final_cost)}</b>` },
      { key: 'expected_price', label: 'Expected selling price Rs.', input: 'number', width: 90 },
      { key: 'margin', label: 'Margin', fmt: (l, i) => {
        const fc = lc(i).final_cost;
        const sp = Number(l.expected_price) || 0;
        if (!sp || !fc) return '';
        const pct = (sp - fc) / sp * 100;
        return `<span style="color:${pct < 0 ? 'var(--bad)' : 'var(--ok)'}">${pct.toFixed(1)}%</span>`;
      } },
      { key: 'total', label: 'Total Rs.', fmt: (l, i) => n(lc(i).line_total) }
    ], totals);
    const addLine = (p) => {
      lines.push({ product_id: p.id, name: p.name, sku: p.sku, unit: p.unit, india_cost: '', pcs: '', bundles: '', pcs_per_set: '', colours: '', size: p.size || '', expected_price: p.wholesale_price || p.sale_price || '' });
      ed.draw();
      totals();
      setTimeout(() => { const x = App.$(`input[data-k="india_cost"][data-i="${lines.length - 1}"]`, f); if (x) x.focus(); }, 20);
    };
    App.productPicker(App.$('#gPick', f), addLine, { extra: (p) => `Stock ${App.qty(p.stock)} ${esc(p.unit)}<br>Sell ${money(p.wholesale_price || p.sale_price)}` });
    App.$('#gNewProd', f).onclick = () => App.productForm(null, async (id) => {
      await App.loadProducts(true);
      const p = App.products.find((x) => x.id === Number(id));
      if (p) addLine(p);
    }, { unit: 'PCS' });
    App.$('#gNewSup', f).onclick = () => App.supplierForm({ type: 'import', country: 'India', currency: 'INR' }, async () => {
      suppliers = await App.get('/api/suppliers');
      const last = suppliers.reduce((a, s) => (s.id > a.id ? s : a), suppliers[0]);
      f.supplier_id.innerHTML = App.options(suppliers.map((s) => ({ value: s.id, label: s.name })), last.id);
    });
    ['india_rate', 'other_expenses', 'cargo_charge'].forEach((k) => f[k].addEventListener('input', totals));
    f.charges_basis.addEventListener('change', totals);
    totals();
  }

  function printGrn(g) {
    const s = App.settings();
    const perGrn = g.charges_basis === 'per_grn';
    App.printHtml(`<style>@page{size:A4;margin:10mm}body{font-family:Segoe UI,Arial,sans-serif;font-size:11.5px;color:#111}
      table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:4px 6px}th{background:#f2f2f2}.n{text-align:right}
      .hd{display:flex;justify-content:space-between;border-bottom:2px solid #333;padding-bottom:6px;margin-bottom:8px}h1{margin:0;font-size:19px;color:#6d1f37}
      .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 20px;margin:8px 0}.lbl{color:#555}</style>
      <div class="hd"><div><h1>${esc(s.company_name)}</h1>${esc(s.company_address)} ${esc(s.company_city)}</div><div style="text-align:right"><b style="font-size:15px">GOODS RECEIPT NOTE</b><br>${esc(g.grn_no)}<br>${App.date(g.date)}${g.cancelled ? '<br><b>CANCELLED</b>' : ''}</div></div>
      <div class="meta"><div><span class="lbl">Supplier name:</span> <b>${esc(g.supplier_name)}</b></div><div><span class="lbl">Cargo name:</span> ${esc(g.cargo_name || '')}</div>
        <div><span class="lbl">Bale number:</span> ${esc(g.bale_no || '')}</div><div><span class="lbl">LR number:</span> ${esc(g.lr_no || '')}</div>
        <div><span class="lbl">Indian rupee rate:</span> 1 ₹ = Rs. ${g.india_rate}</div><div><span class="lbl">Other expenses:</span> Rs. ${n(g.other_expenses)} ${perGrn ? '(total)' : '/ pc'} · <span class="lbl">Cargo:</span> Rs. ${n(g.cargo_charge)} ${perGrn ? '(total)' : '/ pc'}</div></div>
      <table><tr><th>#</th><th>Item</th><th class="n">India cost ₹</th><th class="n">Pcs</th><th class="n">Bundles</th><th class="n">Pcs/set</th><th class="n">Colours</th><th>Size</th>
        <th class="n">Cost Rs./pc</th><th class="n">Selling price Rs.</th><th class="n">Total Rs.</th></tr>
        ${g.items.map((i, k) => `<tr><td>${k + 1}</td><td>${esc(i.name)}<br><small>${esc(i.sku)}</small></td><td class="n">${n(i.india_cost)}</td><td class="n">${App.qty(i.pcs)}</td>
          <td class="n">${App.qty(i.bundles)}</td><td class="n">${App.qty(i.pcs_per_set)}</td><td class="n">${i.colours || ''}</td><td>${esc(i.size || '')}</td>
          <td class="n"><b>${n(i.final_cost)}</b></td><td class="n">${n(i.expected_price)}</td><td class="n">${n(i.line_total)}</td></tr>`).join('')}
        <tr><th colspan="3" class="n">Total</th><th class="n">${App.qty(g.total_pcs)}</th><th class="n">${App.qty(App.sum(g.items, 'bundles'))}</th><th></th>
          <th class="n">${App.sum(g.items, 'colours')}</th><th></th><th></th><th></th><th class="n">${n(g.final_total)}</th></tr></table>
      <p>India cost ₹ ${n(g.india_value)} × ${g.india_rate} = Rs. <b>${n(g.goods_value)}</b> + Other expenses Rs. <b>${n(g.other_total)}</b> + Cargo Rs. <b>${n(g.cargo_total)}</b> = Total cost Rs. <b>${n(g.final_total)}</b></p>
      ${g.notes ? `<p>Notes: ${esc(g.notes)}</p>` : ''}
      <div style="display:flex;justify-content:space-between;margin-top:50px"><span>Received by</span><span>Checked by</span><span>For ${esc(s.company_name)}</span></div>`, g.grn_no);
  }

  async function showGrn(id, reload) {
    const g = await App.get('/api/grn/' + id);
    const perGrn = g.charges_basis === 'per_grn';
    const m = App.modal({
      title: `GRN ${g.grn_no}${g.cancelled ? ' (cancelled)' : ''}`, xwide: true,
      body: `<div class="grid g3" style="margin-bottom:12px">
          <dl class="kv"><dt>Supplier</dt><dd><b>${esc(g.supplier_name)}</b></dd><dt>Date</dt><dd>${App.date(g.date)}</dd><dt>Entered by</dt><dd>${esc(g.user_name || '')}</dd></dl>
          <dl class="kv"><dt>Cargo name</dt><dd>${esc(g.cargo_name || '-')}</dd><dt>Bale number</dt><dd>${esc(g.bale_no || '-')}</dd><dt>LR number</dt><dd>${esc(g.lr_no || '-')}</dd></dl>
          <dl class="kv"><dt>India value</dt><dd>${App.inr(g.india_value)}</dd><dt>Rupee rate</dt><dd>1 ₹ = Rs. ${g.india_rate}</dd><dt>Other expenses</dt><dd>Rs. ${n(g.other_expenses)} ${perGrn ? 'total' : '/ pc'}</dd>
            <dt>Cargo / shipping</dt><dd>Rs. ${n(g.cargo_charge)} ${perGrn ? 'total' : '/ pc'}</dd><dt><b>Total cost</b></dt><dd><b>${money(g.final_total)}</b></dd></dl></div>
        ${App.table(g.items, [
    { label: 'Item', fmt: (r) => `${esc(r.name)}<br><small class="muted">${esc(r.sku)}</small>` },
    { label: 'India cost ₹', num: true, fmt: (r) => n(r.india_cost) }, { label: 'Pcs', num: true, fmt: (r) => App.qty(r.pcs) },
    { label: 'Bundles', num: true, fmt: (r) => App.qty(r.bundles) }, { label: 'Pcs/set', num: true, fmt: (r) => App.qty(r.pcs_per_set) },
    { label: 'Colours', num: true, key: 'colours' }, { label: 'Size', key: 'size' },
    { label: 'Cost Rs./pc', num: true, fmt: (r) => `<b>${n(r.final_cost)}</b>` }, { label: 'Selling price Rs.', num: true, fmt: (r) => n(r.expected_price) },
    { label: 'Total', num: true, fmt: (r) => n(r.line_total) }
  ])}
        ${g.notes ? `<p><b>Notes:</b> ${esc(g.notes)}</p>` : ''}`,
      footer: `${!g.cancelled ? '<button type="button" class="btn danger" id="gCancel">Cancel GRN</button>' : ''}<span class="grow"></span>
        <button type="button" class="btn" id="gLabels">Print labels</button><button type="button" class="btn primary" id="gPrint">Print GRN</button>`
    });
    App.$('#gPrint', m.el).onclick = () => printGrn(g);
    App.$('#gLabels', m.el).onclick = async () => {
      const all = await App.loadProducts(true);
      App.labelDialog(g.items.map((i) => all.find((p) => p.id === i.product_id)).filter(Boolean));
    };
    const c = App.$('#gCancel', m.el);
    if (c) c.onclick = async () => {
      const d = await App.prompt('Cancel ' + g.grn_no, App.field('Reason', 'reason', '', { required: true, cls: 'full' }) +
        '<p class="muted full" style="margin:0">The received pieces will be removed from stock and the supplier entry reversed.</p>', 'Cancel GRN');
      if (!d) return;
      try { await App.post(`/api/grn/${g.id}/cancel`, d); App.products = null; App.toast('GRN cancelled', 'ok'); m.close(); reload(); } catch (e) { App.err(e); }
    };
  }

  App.pages.grn = {
    title: 'GRN — Goods Receipt', roles: ['admin', 'manager'],
    async render(el) {
      const f = { from: App.monthStart(), to: '', q: '' };
      el.innerHTML = `<div class="toolbar"><input type="search" id="gq" placeholder="Search GRN / bale / LR / cargo / supplier" style="max-width:300px">
          <input type="date" id="gf" value="${f.from}" style="width:auto"><span>to</span><input type="date" id="gt" style="width:auto">
          <span class="spacer"></span><button class="btn" id="gx">Export CSV</button><button class="btn primary" id="gn">+ New GRN</button></div><div id="glist"></div>`;
      const cols = [
        { label: 'GRN no.', key: 'grn_no', fmt: (r) => `<b>${esc(r.grn_no)}</b>` }, { label: 'Date', key: 'date', fmt: (r) => App.date(r.date) },
        { label: 'Supplier', key: 'supplier_name' }, { label: 'Cargo', key: 'cargo_name' }, { label: 'Bale no.', key: 'bale_no' }, { label: 'LR no.', key: 'lr_no' },
        { label: 'Pcs', key: 'total_pcs', num: true, fmt: (r) => App.qty(r.total_pcs) }, { label: 'India value ₹', key: 'india_value', num: true, fmt: (r) => n(r.india_value) }, { label: 'Rate', key: 'india_rate', num: true },
        { label: 'Goods Rs.', key: 'goods_value', num: true, fmt: (r) => n(r.goods_value) },
        { label: 'Cargo + other', key: 'charges', num: true, fmt: (r) => n(r.cargo_total + r.other_total), csv: (r) => Tax.r2(r.cargo_total + r.other_total) },
        { label: 'Total cost Rs.', key: 'final_total', num: true, fmt: (r) => `<b>${n(r.final_total)}</b>` },
        { label: '', key: 'cancelled', fmt: (r) => (r.cancelled ? '<span class="badge bad">cancelled</span>' : ''), csv: (r) => (r.cancelled ? 'cancelled' : '') }
      ];
      let rows = [];
      const load = async () => {
        rows = await App.get('/api/grn' + App.qs(f));
        const ok = rows.filter((r) => !r.cancelled);
        App.$('#glist').innerHTML = App.table(rows, cols, { onRow: true, rowCls: (r) => (r.cancelled ? 'dim' : ''), empty: 'No GRNs yet — click “+ New GRN” when a bale arrives',
          foot: { grn_no: ok.length + ' GRNs', total_pcs: App.qty(App.sum(ok, 'total_pcs')), goods_value: n(App.sum(ok, 'goods_value')),
            charges: n(App.sum(ok, (r) => r.cargo_total + r.other_total)), final_total: n(App.sum(ok, 'final_total')) } });
        App.bindRows(App.$('#glist'), rows, (r) => showGrn(r.id, load));
      };
      App.$('#gq').oninput = App.debounce((e) => { f.q = e.target.value; load(); }, 250);
      App.$('#gf').onchange = (e) => { f.from = e.target.value; load(); };
      App.$('#gt').onchange = (e) => { f.to = e.target.value; load(); };
      App.$('#gn').onclick = () => grnForm(load);
      App.$('#gx').onclick = () => App.csv(rows, cols, `grn-${App.today()}.csv`);
      await load();
    }
  };
})();
