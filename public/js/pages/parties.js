/* Customers & suppliers with ledger statements */
(function () {
  const { esc, money } = App;

  function customerForm(c, done) {
    const isNew = !c || !c.id;
    c = c || { type: 'wholesale' };
    App.modal({
      title: isNew ? 'New customer' : 'Edit customer', wide: true,
      body: `<div class="form-grid">
        ${App.field('Name / business name', 'name', c.name, { required: true, cls: 'span2' })}
        ${App.field('Type', 'type', '', { type: 'select', options: App.options([{ value: 'wholesale', label: 'Wholesale (shop / dealer)' }, { value: 'retail', label: 'Retail' }], c.type) })}
        ${App.field('Phone', 'phone', c.phone || '')}${App.field('Email', 'email', c.email || '', { type: 'email' })}
        ${App.field(App.taxName() + ' No. (if registered)', 'vat_no', c.vat_no || '')}
        ${App.field('City / town', 'city', c.city || '', { placeholder: 'Kandy / Galle / Jaffna' })}
        ${App.field('Address', 'address', c.address || '', { cls: 'full' })}
        ${App.isStaff() ? App.field('Credit limit (Rs., 0 = no limit)', 'credit_limit', c.credit_limit || 0, { type: 'number', step: '0.01' }) +
    App.field('Opening balance (Rs. receivable)', 'opening_balance', c.opening_balance || 0, { type: 'number', step: '0.01' }) : ''}
        ${!isNew ? `<label class="chk"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> Active</label>` : ''}</div>`,
      onSubmit: async (f) => {
        const d = App.formData(f);
        if (isNew) await App.post('/api/customers', d); else await App.put('/api/customers/' + c.id, d);
        App.toast('Customer saved', 'ok');
        done();
      }
    });
  }

  function supplierForm(s, done) {
    const isNew = !s || !s.id;
    s = s || { type: 'import', country: 'India', currency: 'INR' };
    App.modal({
      title: isNew ? 'New supplier' : 'Edit supplier', wide: true,
      body: `<div class="form-grid">
        ${App.field('Supplier name', 'name', s.name, { required: true, cls: 'span2' })}
        ${App.field('Type', 'type', '', { type: 'select', options: App.options([{ value: 'import', label: 'India / overseas supplier' }, { value: 'local', label: 'Local supplier (Sri Lanka)' }], s.type) })}
        ${App.field('Country / city', 'country', s.country || '', { placeholder: 'India - Surat / Tiruppur' })}
        ${App.field('Currency', 'currency', '', { type: 'select', options: App.options(App.meta.currencies, s.currency) })}
        ${App.field('Contact person', 'contact_person', s.contact_person || '')}${App.field('Phone / WhatsApp', 'phone', s.phone || '')}
        ${App.field('Email', 'email', s.email || '', { type: 'email' })}
        ${App.field('GST / VAT No.', 'vat_no', s.vat_no || '')}
        ${App.field('Address', 'address', s.address || '', { type: 'textarea', cls: 'span2' })}
        ${App.field('Bank / SWIFT details', 'bank_details', s.bank_details || '', { type: 'textarea', cls: 'span2' })}
        ${App.field('Opening balance (Rs. payable)', 'opening_balance', s.opening_balance || 0, { type: 'number', step: '0.01' })}
        ${!isNew ? `<label class="chk"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Active</label>` : ''}</div>`,
      onSubmit: async (f) => {
        const d = App.formData(f);
        if (isNew) await App.post('/api/suppliers', d); else await App.put('/api/suppliers/' + s.id, d);
        App.toast('Supplier saved', 'ok');
        done();
      }
    });
  }

  App.showLedger = async function (type, id) {
    const f = { from: App.fyStart(), to: App.today() };
    const m = App.modal({
      title: 'Account statement', xwide: true,
      body: `<div class="toolbar"><input type="date" id="lf" value="${f.from}" style="width:auto"><span>to</span><input type="date" id="lt" value="${f.to}" style="width:auto">
        <span class="spacer"></span><button type="button" class="btn" id="lx">Export CSV</button><button type="button" class="btn" id="lp">Print</button></div><div id="lbody"></div>`
    });
    let data;
    const cols = [
      { label: 'Date', key: 'date', fmt: (r) => App.date(r.date) }, { label: 'Type', key: 'ref_type', fmt: (r) => `<span class="badge">${esc(r.ref_type.replace('_', ' '))}</span>` },
      { label: 'Ref no.', key: 'ref_no' }, { label: 'Particulars', key: 'narration' },
      { label: 'Debit', key: 'debit', num: true, fmt: (r) => (r.debit ? App.num(r.debit) : '') },
      { label: 'Credit', key: 'credit', num: true, fmt: (r) => (r.credit ? App.num(r.credit) : '') },
      { label: 'Balance', key: 'balance', num: true, fmt: (r) => `<b>${App.num(r.balance)}</b>` }
    ];
    const load = async () => {
      data = await App.get(`/api/ledger/${type}/${id}` + App.qs(f));
      const p = data.party;
      const note = type === 'customer' ? 'Positive balance = customer owes you' : 'Positive balance = you owe the supplier';
      App.$('#lbody', m.el).innerHTML = `<div class="inline" style="margin-bottom:10px"><div><h3 style="margin:0">${esc(p.name)}</h3>
        <small class="muted">${esc([p.phone, p.vat_no, p.city || p.country].filter(Boolean).join(' · '))} — ${note}</small></div>
        <div class="auto right"><small class="muted">Opening</small> <b>${money(data.opening)}</b><br><small class="muted">Closing</small> <b style="font-size:1.2rem">${money(data.closing)}</b></div></div>
        ${App.table(data.entries, cols, { empty: 'No transactions in this period', foot: { narration: 'Total', debit: App.num(App.sum(data.entries, 'debit')), credit: App.num(App.sum(data.entries, 'credit')), balance: App.num(data.closing) } })}`;
    };
    App.$('#lf', m.el).onchange = (e) => { f.from = e.target.value; load(); };
    App.$('#lt', m.el).onchange = (e) => { f.to = e.target.value; load(); };
    App.$('#lx', m.el).onclick = () => App.csv(data.entries, cols, `ledger-${data.party.name}.csv`);
    App.$('#lp', m.el).onclick = () => {
      const s = App.settings();
      App.printHtml(`<style>body{font-family:Segoe UI,Arial;font-size:12px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #aaa;padding:4px 6px}.n{text-align:right}</style>
        <h2 style="margin:0">${esc(s.company_name)}</h2><div>${esc(s.company_address)} ${esc(s.company_city)} ${s.company_vat_no ? '· ' + esc(s.tax_name) + ' No ' + esc(s.company_vat_no) : ''}</div>
        <h3>Statement of account — ${esc(data.party.name)}</h3><div>Period: ${App.date(f.from)} to ${App.date(f.to)}</div><br>
        <table><tr><th>Date</th><th>Ref</th><th>Particulars</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Balance</th></tr>
        <tr><td></td><td></td><td>Opening balance</td><td></td><td></td><td class="n">${App.num(data.opening)}</td></tr>
        ${data.entries.map((e) => `<tr><td>${App.date(e.date)}</td><td>${esc(e.ref_no || '')}</td><td>${esc(e.narration || '')}</td><td class="n">${e.debit ? App.num(e.debit) : ''}</td>
        <td class="n">${e.credit ? App.num(e.credit) : ''}</td><td class="n">${App.num(e.balance)}</td></tr>`).join('')}
        <tr><th colspan="5" style="text-align:right">Closing balance</th><th class="n">${App.num(data.closing)}</th></tr></table>`, 'Statement');
    };
    await load();
  };

  function partyPage(type) {
    return {
      title: type === 'customer' ? 'Customers' : 'Suppliers',
      roles: type === 'supplier' ? ['admin', 'manager'] : null,
      async render(el) {
        const f = { q: '', active: '', type: '' };
        el.innerHTML = `<div class="toolbar"><input type="search" id="cq" placeholder="Search name, phone, ${type === 'customer' ? 'city' : 'country'}" style="max-width:320px">
          ${type === 'supplier' ? `<select id="ct" style="width:auto">${App.options([{ value: 'import', label: 'India / overseas' }, { value: 'local', label: 'Local' }], '', { blank: 'All suppliers' })}</select>` : ''}
          <label class="chk"><input type="checkbox" id="ca"> Show inactive</label>
          <span class="spacer"></span><button class="btn" id="cx">Export CSV</button><button class="btn primary" id="cn">+ New ${type}</button></div><div id="clist"></div>`;
        const cols = type === 'customer' ? [
          { label: 'Name', key: 'name', fmt: (r) => `<b>${esc(r.name)}</b>${r.active ? '' : ' <span class="badge bad">inactive</span>'}` },
          { label: 'Type', key: 'type', fmt: (r) => `<span class="badge ${r.type === 'wholesale' ? 'brand' : ''}">${esc(r.type)}</span>` },
          { label: 'Phone', key: 'phone' }, { label: 'City', key: 'city' },
          { label: 'Credit limit', key: 'credit_limit', num: true, fmt: (r) => (r.credit_limit ? App.num(r.credit_limit) : '') },
          { label: 'Balance', key: 'balance', num: true, fmt: (r) => `<b style="color:${r.balance > 0 ? 'var(--bad)' : 'inherit'}">${App.num(r.balance)}</b>` },
          { label: '', fmt: (r) => `<button class="btn sm" data-led="${r.id}">Ledger</button> <button class="btn sm" data-ed="${r.id}">Edit</button>` }
        ] : [
          { label: 'Name', key: 'name', fmt: (r) => `<b>${esc(r.name)}</b>${r.active ? '' : ' <span class="badge bad">inactive</span>'}<br><small class="muted">${esc(r.contact_person || '')}</small>` },
          { label: 'Type', key: 'type', fmt: (r) => `<span class="badge ${r.type === 'import' ? 'info' : ''}">${r.type === 'import' ? 'India / overseas' : 'local'}</span>` },
          { label: 'Country', key: 'country' }, { label: 'Currency', key: 'currency' }, { label: 'Phone', key: 'phone' }, { label: 'Email', key: 'email' },
          { label: 'Payable (Rs.)', key: 'balance', num: true, fmt: (r) => `<b>${App.num(r.balance)}</b>` },
          { label: '', fmt: (r) => `<button class="btn sm" data-led="${r.id}">Ledger</button> <button class="btn sm" data-ed="${r.id}">Edit</button>` }
        ];
        let rows = [];
        const load = async () => {
          rows = await App.get(`/api/${type}s` + App.qs(f));
          App.$('#clist').innerHTML = App.table(rows, cols, { foot: { name: `${rows.length} ${type}s`, balance: App.num(App.sum(rows, 'balance')) } });
          App.$$('[data-led]').forEach((b) => b.onclick = () => App.showLedger(type, b.dataset.led));
          App.$$('[data-ed]').forEach((b) => b.onclick = () => {
            const r = rows.find((x) => x.id === Number(b.dataset.ed));
            (type === 'customer' ? customerForm : supplierForm)(r, load);
          });
        };
        App.$('#cq').oninput = App.debounce((e) => { f.q = e.target.value; load(); }, 250);
        App.$('#ca').onchange = (e) => { f.active = e.target.checked ? 'all' : ''; load(); };
        if (App.$('#ct')) App.$('#ct').onchange = (e) => { f.type = e.target.value; load(); };
        App.$('#cn').onclick = () => (type === 'customer' ? customerForm : supplierForm)(null, load);
        App.$('#cx').onclick = () => App.csv(rows, cols.filter((c) => c.key), `${type}s-${App.today()}.csv`);
        await load();
      }
    };
  }

  App.pages.customers = partyPage('customer');
  App.pages.suppliers = partyPage('supplier');
  App.supplierForm = supplierForm;
})();
