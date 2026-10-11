/* Reports: sales analysis, VAT, P&L, stock valuation, outstanding, day book, GRN costing */
(function () {
  const { esc, money } = App;
  const n = App.num;
  const TABS = [
    ['sales', 'Sales analysis'], ['grn', 'GRN / India purchases'], ['profit', 'Profit & loss'], ['stock', 'Stock valuation'],
    ['outstanding', 'Outstanding'], ['daybook', 'Day book / cash'], ['vat', 'VAT']
  ];

  function rangeBar(f, extra) {
    return `<div class="toolbar"><input type="date" id="rf" value="${f.from}" style="width:auto"><span>to</span><input type="date" id="rt" value="${f.to}" style="width:auto">
      <select id="rq" style="width:auto"><option value="">Quick range…</option><option value="today">Today</option><option value="month">This month</option>
      <option value="lmonth">Last month</option><option value="quarter">This quarter</option><option value="fy">This financial year</option></select>
      ${extra || ''}<span class="spacer"></span><button class="btn" id="rprint">Print</button><button class="btn" id="rcsv">Export CSV</button></div>`;
  }
  function bindRange(f, load) {
    App.$('#rf').onchange = (e) => { f.from = e.target.value; load(); };
    App.$('#rt').onchange = (e) => { f.to = e.target.value; load(); };
    App.$('#rq').onchange = (e) => {
      const t = App.today();
      const y = Number(t.slice(0, 4)), mo = Number(t.slice(5, 7));
      const pad = (x) => String(x).padStart(2, '0');
      const last = (yy, mm) => new Date(yy, mm, 0).getDate();
      if (e.target.value === 'today') { f.from = t; f.to = t; }
      if (e.target.value === 'month') { f.from = App.monthStart(); f.to = t; }
      if (e.target.value === 'lmonth') { const ly = mo === 1 ? y - 1 : y, lm = mo === 1 ? 12 : mo - 1; f.from = `${ly}-${pad(lm)}-01`; f.to = `${ly}-${pad(lm)}-${last(ly, lm)}`; }
      if (e.target.value === 'quarter') { const qs = Math.floor((mo - 1) / 3) * 3 + 1; f.from = `${y}-${pad(qs)}-01`; f.to = t; }
      if (e.target.value === 'fy') { f.from = App.fyStart(); f.to = t; }
      App.$('#rf').value = f.from; App.$('#rt').value = f.to;
      load();
    };
    App.$('#rprint').onclick = () => {
      const s = App.settings();
      App.printHtml(`<style>body{font-family:Segoe UI,Arial;font-size:11px}table{width:100%;border-collapse:collapse;margin-bottom:10px}th,td{border:1px solid #bbb;padding:3px 5px;text-align:left}
        td.num,th.num{text-align:right}.toolbar,button,input,select{display:none}.badge{font-size:10px}h3{margin:10px 0 4px}.stat{display:inline-block;border:1px solid #ccc;padding:6px 10px;margin:0 6px 6px 0}.lbl{color:#666}.val{font-weight:700;font-size:14px}</style>
        <h2 style="margin:0">${esc(s.company_name)}</h2><div>${esc(App.$('.tabs a.active').textContent)} · ${App.date(f.from)} to ${App.date(f.to)}</div><hr>${App.$('#rbody').innerHTML}`, 'Report');
    };
  }

  const R = {};

  R.sales = async (f, body, setCsv) => {
    f.group = f.group || 'day';
    const d = await App.get('/api/reports/sales' + App.qs(f));
    const cols = [
      { label: d.group === 'day' ? 'Date' : d.group[0].toUpperCase() + d.group.slice(1), key: 'label', fmt: (r) => esc(d.group === 'day' ? App.date(r.label) : r.label) },
      { label: 'Bills', key: 'bills', num: true }, { label: 'Qty', key: 'qty', num: true, fmt: (r) => App.qty(r.qty) },
      ...(App.taxOn() ? [{ label: 'Excl. VAT', key: 'taxable', num: true, fmt: (r) => n(r.taxable) }, { label: 'VAT', key: 'tax', num: true, fmt: (r) => n(r.tax) }] : []),
      { label: 'Sales', key: 'total', num: true, fmt: (r) => `<b>${n(r.total)}</b>` }, { label: 'Cost', key: 'cost', num: true, fmt: (r) => n(r.cost) },
      { label: 'Gross profit', key: 'profit', num: true, fmt: (r) => n(r.profit) },
      { label: 'Margin', key: 'margin', num: true, fmt: (r) => (r.taxable ? (r.profit / r.taxable * 100).toFixed(1) + '%' : ''), csv: (r) => (r.taxable ? (r.profit / r.taxable * 100).toFixed(1) : '') }
    ];
    setCsv(d.rows, cols, `sales-by-${d.group}`);
    body.innerHTML = `<div class="grid g4" style="margin-bottom:16px">
        <div class="stat brand"><div class="lbl">Sales</div><div class="val">${money(d.totals.total)}</div><div class="sub">${d.totals.bills} invoices</div></div>
        <div class="stat info"><div class="lbl">Cost of goods sold</div><div class="val">${money(d.totals.cost)}</div></div>
        <div class="stat ok"><div class="lbl">Gross profit</div><div class="val">${money(d.totals.profit)}</div><div class="sub">${d.totals.taxable ? (d.totals.profit / d.totals.taxable * 100).toFixed(1) : 0}% margin</div></div>
        <div class="stat warn"><div class="lbl">Returns</div><div class="val">${money(d.returns.total)}</div><div class="sub">${d.returns.n} credit notes</div></div></div>
      ${App.table(d.rows, cols, { foot: { label: 'Total', qty: App.qty(d.totals.qty), taxable: n(d.totals.taxable), tax: n(d.totals.tax), total: n(d.totals.total), cost: n(d.totals.cost), profit: n(d.totals.profit) } })}`;
  };
  R.sales.extra = (f) => `<select id="rg" style="width:auto">${App.options(['day', 'month', 'product', 'category', 'customer', 'user'].map((g) => ({ value: g, label: 'Group by ' + g })), f.group || 'day')}</select>`;
  R.sales.bind = (f, load) => { App.$('#rg').onchange = (e) => { f.group = e.target.value; load(); }; };

  R.grn = async (f, body, setCsv) => {
    const d = await App.get('/api/reports/grn' + App.qs(f));
    const cols = [{ label: 'GRN', key: 'grn_no' }, { label: 'Date', key: 'date', fmt: (r) => App.date(r.date) }, { label: 'Supplier', key: 'supplier' },
      { label: 'Cargo', key: 'cargo_name' }, { label: 'Bale', key: 'bale_no' }, { label: 'LR', key: 'lr_no' }, { label: 'Pcs', key: 'total_pcs', num: true, fmt: (r) => App.qty(r.total_pcs) },
      { label: 'India ₹', key: 'india_value', num: true, fmt: (r) => n(r.india_value) }, { label: 'Rate', key: 'india_rate', num: true },
      { label: 'Goods Rs.', key: 'goods_value', num: true, fmt: (r) => n(r.goods_value) }, { label: 'Cargo Rs.', key: 'cargo_total', num: true, fmt: (r) => n(r.cargo_total) },
      { label: 'Other Rs.', key: 'other_total', num: true, fmt: (r) => n(r.other_total) }, { label: 'Total cost Rs.', key: 'final_total', num: true, fmt: (r) => `<b>${n(r.final_total)}</b>` },
      { label: 'Charges %', key: 'overhead_pct', num: true, fmt: (r) => r.overhead_pct.toFixed(1) + '%' }];
    setCsv(d.rows, cols, 'grn-costing');
    const tot = (k) => App.sum(d.rows, k);
    body.innerHTML = `<div class="grid g4" style="margin-bottom:16px">
        <div class="stat brand"><div class="lbl">Bought in India</div><div class="val">${App.inr(tot('india_value'))}</div><div class="sub">${d.rows.length} GRNs · ${App.qty(tot('total_pcs'))} pcs</div></div>
        <div class="stat info"><div class="lbl">Goods value in Rs.</div><div class="val">${money(tot('goods_value'))}</div></div>
        <div class="stat warn"><div class="lbl">Cargo + other expenses</div><div class="val">${money(tot('cargo_total') + tot('other_total'))}</div></div>
        <div class="stat ok"><div class="lbl">Total landed cost</div><div class="val">${money(tot('final_total'))}</div></div></div>
      <div class="grid g2"><div class="card"><h3>By supplier</h3>${App.table(d.by_supplier, [{ label: 'Supplier', key: 'supplier' }, { label: 'GRNs', key: 'grns', num: true },
    { label: 'Pcs', num: true, fmt: (r) => App.qty(r.pcs) }, { label: 'India ₹', num: true, fmt: (r) => n(r.india_value) }, { label: 'Total cost Rs.', num: true, fmt: (r) => n(r.final_total) }], { empty: 'No GRNs' })}</div>
      <div class="card"><h3>By cargo company</h3>${App.table(d.by_cargo, [{ label: 'Cargo', key: 'cargo' }, { label: 'GRNs', key: 'grns', num: true },
    { label: 'Pcs', num: true, fmt: (r) => App.qty(r.pcs) }, { label: 'Cargo Rs.', num: true, fmt: (r) => n(r.cargo_total) }, { label: 'Per pc', num: true, fmt: (r) => n(r.per_pc) }], { empty: 'No GRNs' })}</div></div>
      <div class="card"><h3>GRNs</h3>${App.table(d.rows, cols, { empty: 'No GRNs in this period' })}</div>`;
  };

  R.vat = async (f, body, setCsv) => {
    const d = await App.get('/api/reports/vat' + App.qs(f));
    const S = d.summary;
    const invCols = [{ label: 'Invoice', key: 'invoice_no' }, { label: 'Date', key: 'date', fmt: (r) => App.date(r.date) }, { label: 'Customer', key: 'customer_name' },
      { label: 'Customer VAT No.', key: 'customer_vat_no' }, { label: 'Excl. VAT', key: 'taxable', num: true, fmt: (r) => n(r.taxable) },
      { label: 'VAT', key: 'tax', num: true, fmt: (r) => n(r.tax) }, { label: 'Total', key: 'total', num: true, fmt: (r) => n(r.total) }];
    setCsv(d.invoices, invCols, 'vat-invoices');
    body.innerHTML = `${d.enabled ? '' : '<div class="card" style="border-left:4px solid var(--accent)">VAT is currently <b>switched off</b> in Settings, so invoices carry no VAT. Turn it on only if the business is VAT registered.</div>'}
      <div class="card"><h3>${esc(d.tax_name)} summary${d.vat_no ? ' — Reg. No. ' + esc(d.vat_no) : ''}</h3>
        ${App.table([
    { k: 'Output VAT on sales', taxable: S.output.taxable, tax: S.output.tax },
    { k: 'Less: credit notes', taxable: -S.credit_notes.taxable, tax: -S.credit_notes.tax },
    { k: 'Less: input VAT on local purchases', taxable: -S.input.taxable, tax: -S.input.tax },
    { k: '<b>VAT payable</b>', taxable: '', tax: S.payable }
  ], [{ label: 'Particulars', fmt: (r) => r.k }, { label: 'Value excl. VAT', num: true, fmt: (r) => (r.taxable === '' ? '' : n(r.taxable)) }, { label: 'VAT', num: true, fmt: (r) => `<b>${n(r.tax)}</b>` }])}
        <p class="muted" style="margin-bottom:0">A helper for preparing your return — check figures with your accountant.</p></div>
      <div class="card"><h3>By rate</h3>${App.table(d.by_rate, [{ label: 'Rate', fmt: (r) => r.rate + '%' }, { label: 'Excl. VAT', num: true, fmt: (r) => n(r.taxable) },
    { label: 'VAT', num: true, fmt: (r) => n(r.tax) }, { label: 'Total', num: true, fmt: (r) => n(r.total) }], { empty: 'No sales' })}</div>
      <div class="card"><h3>Invoices</h3>${App.table(d.invoices, invCols, { empty: 'No invoices' })}</div>
      <div class="card"><h3>Credit notes</h3>${App.table(d.credit_notes, [{ label: 'Note', key: 'return_no' }, { label: 'Date', fmt: (r) => App.date(r.date) }, { label: 'Invoice', key: 'invoice_no' },
    { label: 'Customer', key: 'customer_name' }, { label: 'VAT', num: true, fmt: (r) => n(r.tax) }, { label: 'Total', num: true, fmt: (r) => n(r.total) }], { empty: 'No credit notes' })}</div>
      <div class="card"><h3>Local purchases (input VAT)</h3>${App.table(d.purchases, [{ label: 'Bill', fmt: (r) => esc(r.bill_no || r.ref_no) }, { label: 'Date', fmt: (r) => App.date(r.date) },
    { label: 'Supplier', key: 'supplier' }, { label: 'VAT No.', key: 'vat_no' }, { label: 'Value', num: true, fmt: (r) => n(r.taxable) }, { label: 'VAT', num: true, fmt: (r) => n(r.tax) }], { empty: 'None' })}</div>`;
  };

  R.profit = async (f, body, setCsv) => {
    const d = await App.get('/api/reports/profit' + App.qs(f));
    const rows = [
      { k: 'Sales' + (App.taxOn() ? ' (excl. VAT)' : ''), v: d.sales }, { k: 'Less: sales returns', v: -d.returns }, { k: '<b>Net sales</b>', v: d.net_sales, b: 1 },
      { k: 'Less: cost of goods sold (GRN / purchase cost)', v: -d.cogs }, { k: '<b>Gross profit</b>', v: d.gross_profit, b: 1 },
      ...(d.stock_adjustment_loss ? [{ k: 'Less: stock adjustments (damage/shortage, net)', v: -d.stock_adjustment_loss }] : []),
      ...d.expenses.map((e) => ({ k: 'Less: ' + esc(e.category), v: -e.amount })),
      { k: '<b>Net profit</b>', v: d.net_profit, b: 1 }
    ];
    setCsv(rows.map((r) => ({ k: r.k.replace(/<[^>]+>/g, ''), v: r.v })), [{ label: 'Particulars', key: 'k' }, { label: 'Amount', key: 'v' }], 'profit-loss');
    body.innerHTML = `<div class="grid g4" style="margin-bottom:16px">
      <div class="stat brand"><div class="lbl">Net sales</div><div class="val">${money(d.net_sales)}</div></div>
      <div class="stat ok"><div class="lbl">Gross profit</div><div class="val">${money(d.gross_profit)}</div><div class="sub">${d.gross_margin}% margin</div></div>
      <div class="stat warn"><div class="lbl">Expenses</div><div class="val">${money(d.expenses_total)}</div></div>
      <div class="stat ${d.net_profit >= 0 ? 'ok' : 'bad'}"><div class="lbl">Net profit</div><div class="val">${money(d.net_profit)}</div></div></div>
      <div class="card" style="max-width:720px">${App.table(rows, [{ label: 'Particulars', fmt: (r) => r.k }, { label: 'Amount (Rs.)', num: true, fmt: (r) => (r.b ? `<b>${n(r.v)}</b>` : n(r.v)) }])}
      <p class="muted" style="margin-bottom:0">Cost of goods uses each item's average cost at the time of sale — for goods from India this is the GRN cost (India cost × rupee rate + cargo + other expenses).</p></div>`;
  };

  R.stock = async (f, body, setCsv) => {
    const d = await App.get('/api/reports/stock' + App.qs({ category_id: f.category_id, only_in_stock: f.only_in_stock }));
    const cols = [{ label: 'SKU', key: 'sku' }, { label: 'Item', key: 'name' }, { label: 'Category', key: 'category' }, { label: 'Size', key: 'size' },
      { label: 'Stock', key: 'stock', num: true, fmt: (r) => `${App.qty(r.stock)} ${esc(r.unit)}` }, { label: 'Avg cost', key: 'cost_price', num: true, fmt: (r) => n(r.cost_price) },
      { label: 'Value @ cost', key: 'value_cost', num: true, fmt: (r) => n(r.value_cost) }, { label: 'Wholesale price', key: 'wholesale_price', num: true, fmt: (r) => n(r.wholesale_price) },
      { label: 'Value @ wholesale', key: 'value_sale', num: true, fmt: (r) => n(r.value_sale) }, { label: 'Last sold', key: 'last_sold', fmt: (r) => App.date(r.last_sold) }];
    setCsv(d.rows, cols, 'stock-valuation');
    body.innerHTML = `<div class="grid g2" style="margin-bottom:16px"><div class="stat brand"><div class="lbl">Stock value at cost</div><div class="val">${money(d.totals.value_cost)}</div></div>
      <div class="stat ok"><div class="lbl">Stock value at wholesale price</div><div class="val">${money(d.totals.value_sale)}</div></div></div>
      <div class="card"><h3>By category</h3>${App.table(d.by_category, [{ label: 'Category', key: 'category' }, { label: 'Items', key: 'items', num: true }, { label: 'Pcs', num: true, fmt: (r) => App.qty(r.pcs) },
    { label: 'Value @ cost', num: true, fmt: (r) => n(r.value_cost) }, { label: 'Value @ wholesale', num: true, fmt: (r) => n(r.value_sale) }])}</div>
      <div class="card"><h3>Item-wise</h3>${App.table(d.rows, cols, { foot: { name: d.rows.length + ' items', value_cost: n(d.totals.value_cost), value_sale: n(d.totals.value_sale) } })}</div>`;
  };
  R.stock.noRange = true;
  R.stock.extra = (f) => `<select id="rc" style="width:auto">${App.options(App.meta.categories.map((c) => ({ value: c.id, label: c.name })), f.category_id, { blank: 'All categories' })}</select>
    <label class="chk"><input type="checkbox" id="ris" ${f.only_in_stock ? 'checked' : ''}> Only items in stock</label>`;
  R.stock.bind = (f, load) => {
    App.$('#rc').onchange = (e) => { f.category_id = e.target.value; load(); };
    App.$('#ris').onchange = (e) => { f.only_in_stock = e.target.checked ? '1' : ''; load(); };
  };

  R.outstanding = async (f, body, setCsv) => {
    const c = await App.get('/api/reports/outstanding?type=customer');
    const s = await App.get('/api/reports/outstanding?type=supplier');
    const ccols = [{ label: 'Customer', key: 'name' }, { label: 'Phone', key: 'phone' }, { label: 'City', key: 'city' },
      { label: '0-30 days', key: 'a0_30', num: true, fmt: (r) => n(r.a0_30) }, { label: '31-60', key: 'a31_60', num: true, fmt: (r) => n(r.a31_60) },
      { label: '61-90', key: 'a61_90', num: true, fmt: (r) => n(r.a61_90) }, { label: '90+', key: 'a90', num: true, fmt: (r) => `<span style="color:${r.a90 ? 'var(--bad)' : 'inherit'}">${n(r.a90)}</span>` },
      { label: 'Balance', key: 'balance', num: true, fmt: (r) => `<b>${n(r.balance)}</b>` }, { label: '', fmt: (r) => `<button class="btn sm" data-cl="${r.id}">Ledger</button>` }];
    setCsv(c.rows, ccols.filter((x) => x.key), 'receivables');
    body.innerHTML = `<div class="card"><h3>Receivables — customers</h3>${App.table(c.rows, ccols, { empty: 'Nothing outstanding', foot: { name: c.rows.length + ' customers', a0_30: n(App.sum(c.rows, 'a0_30')), a31_60: n(App.sum(c.rows, 'a31_60')), a61_90: n(App.sum(c.rows, 'a61_90')), a90: n(App.sum(c.rows, 'a90')), balance: n(App.sum(c.rows, 'balance')) } })}</div>
      <div class="card"><h3>Payables — suppliers</h3>${App.table(s.rows, [{ label: 'Supplier', key: 'name' }, { label: 'Country', key: 'country' }, { label: 'Currency', key: 'currency' },
    { label: 'Balance (Rs.)', num: true, fmt: (r) => `<b>${n(r.balance)}</b>${r.balance < 0 ? ' <small class="muted">advance</small>' : ''}` }, { label: '', fmt: (r) => `<button class="btn sm" data-sl="${r.id}">Ledger</button>` }],
  { empty: 'Nothing payable' })}</div>`;
    App.$$('[data-cl]', body).forEach((b) => b.onclick = () => App.showLedger('customer', b.dataset.cl));
    App.$$('[data-sl]', body).forEach((b) => b.onclick = () => App.showLedger('supplier', b.dataset.sl));
  };
  R.outstanding.noRange = true;

  R.daybook = async (f, body, setCsv) => {
    const d = await App.get('/api/reports/daybook' + App.qs(f));
    const cols = [{ label: 'Source', key: 'source' }, { label: 'Mode', key: 'mode', fmt: (r) => esc(App.modeLabel(r.mode)) },
      { label: 'Money in', key: 'in', num: true, fmt: (r) => (r.in ? n(r.in) : '') }, { label: 'Money out', key: 'out', num: true, fmt: (r) => (r.out ? n(r.out) : '') }];
    setCsv(d.rows, cols, 'daybook');
    const cash = d.modes.find((m) => m.mode === 'cash') || { in: 0, out: 0, net: 0 };
    body.innerHTML = `<div class="grid g4" style="margin-bottom:16px">
        <div class="stat brand"><div class="lbl">Invoices</div><div class="val">${money(d.sales.total)}</div><div class="sub">${d.sales.bills} bills · on credit ${money(d.sales.credit)}</div></div>
        <div class="stat ok"><div class="lbl">Cash in</div><div class="val">${money(cash.in)}</div></div>
        <div class="stat bad"><div class="lbl">Cash out</div><div class="val">${money(cash.out)}</div></div>
        <div class="stat info"><div class="lbl">Net cash (hand over)</div><div class="val">${money(cash.net)}</div></div></div>
      <div class="grid g2"><div class="card"><h3>By payment mode</h3>${App.table(d.modes, [{ label: 'Mode', fmt: (r) => esc(App.modeLabel(r.mode)) },
    { label: 'In', num: true, fmt: (r) => n(r.in) }, { label: 'Out', num: true, fmt: (r) => n(r.out) }, { label: 'Net', num: true, fmt: (r) => `<b>${n(r.net)}</b>` }], { empty: 'No transactions' })}</div>
      <div class="card"><h3>By source</h3>${App.table(d.rows, cols, { empty: 'No transactions' })}</div></div>
      <div class="card"><h3>Invoices</h3>${App.table(d.invoices, [{ label: 'Invoice', key: 'invoice_no' }, { label: 'Customer', key: 'customer_name' },
    { label: 'Total', num: true, fmt: (r) => n(r.total) }, { label: 'Paid', num: true, fmt: (r) => n(r.paid) }, { label: 'Status', fmt: (r) => App.statusBadge(r.status) }, { label: 'By', key: 'user_name' }], { empty: 'No invoices' })}</div>
      ${d.expenses.length ? `<div class="card"><h3>Expenses</h3>${App.table(d.expenses, [{ label: 'Category', key: 'category' }, { label: 'Paid to', key: 'paid_to' }, { label: 'Mode', fmt: (r) => esc(App.modeLabel(r.mode)) }, { label: 'Amount', num: true, fmt: (r) => n(r.amount) }])}</div>` : ''}`;
  };

  App.pages.reports = {
    title: 'Reports', roles: ['admin', 'manager'],
    async render(el, args) {
      const tab = TABS.find((t) => t[0] === args[0]) ? args[0] : 'sales';
      const f = { from: tab === 'daybook' ? App.today() : tab === 'grn' ? App.fyStart() : App.monthStart(), to: App.today() };
      const rep = R[tab];
      el.innerHTML = `<div class="tabs">${TABS.map(([k, l]) => `<a href="#/reports/${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div>
        ${rep.noRange ? `<div class="toolbar">${rep.extra ? rep.extra(f) : ''}<span class="spacer"></span><button class="btn" id="rprint">Print</button><button class="btn" id="rcsv">Export CSV</button></div><input type="hidden" id="rf"><input type="hidden" id="rt"><select id="rq" class="hidden"></select>`
    : rangeBar(f, rep.extra ? rep.extra(f) : '')}<div id="rbody"><div class="empty">Loading…</div></div>`;
      let csv = null;
      const setCsv = (rows, cols, name) => { csv = { rows, cols, name }; };
      const load = async () => {
        try { await rep(f, App.$('#rbody'), setCsv); } catch (e) { App.$('#rbody').innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
      };
      bindRange(f, load);
      if (rep.bind) rep.bind(f, load);
      App.$('#rcsv').onclick = () => csv && App.csv(csv.rows, csv.cols, `${csv.name}-${f.from || App.today()}.csv`);
      await load();
    }
  };
})();
