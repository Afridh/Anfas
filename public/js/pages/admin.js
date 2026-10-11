/* Users, settings, backup, audit log */
(function () {
  const { esc } = App;
  const ROLES = [{ value: 'cashier', label: 'Cashier — POS billing, customers, view stock' },
    { value: 'manager', label: 'Manager — everything except users & settings' }, { value: 'admin', label: 'Admin — full access' }];

  function userForm(u, done) {
    const isNew = !u;
    u = u || { role: 'cashier', active: 1 };
    App.modal({
      title: isNew ? 'New user' : `Edit ${u.username}`,
      body: `<div class="form-grid">${App.field('Full name', 'name', u.name, { required: true })}
        ${App.field('Username', 'username', u.username, { required: true, readonly: !isNew })}
        ${App.field('Role', 'role', '', { type: 'select', cls: 'full', options: App.options(ROLES, u.role) })}
        ${App.field(isNew ? 'Password (min 6)' : 'New password (leave blank to keep)', 'password', '', { type: 'password', required: isNew })}
        ${!isNew ? `<label class="chk"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Active</label>` : ''}</div>`,
      onSubmit: async (f) => {
        const d = App.formData(f);
        if (isNew) await App.post('/api/users', d);
        else { if (!d.password) delete d.password; await App.put('/api/users/' + u.id, d); }
        App.toast('User saved', 'ok');
        done();
      }
    });
  }

  App.pages.users = {
    title: 'Users', roles: ['admin'],
    async render(el) {
      el.innerHTML = `<div class="toolbar"><span class="muted">Give each counter staff their own login — every bill records who made it.</span><span class="spacer"></span>
        <button class="btn" id="ua">Audit log</button><button class="btn primary" id="un">+ New user</button></div><div id="ulist"></div>`;
      const load = async () => {
        const rows = await App.get('/api/users');
        App.$('#ulist').innerHTML = App.table(rows, [{ label: 'Name', key: 'name' }, { label: 'Username', key: 'username' },
          { label: 'Role', fmt: (r) => `<span class="badge brand">${esc(r.role)}</span>` }, { label: 'Status', fmt: (r) => (r.active ? '<span class="badge ok">active</span>' : '<span class="badge bad">disabled</span>') },
          { label: 'Created', fmt: (r) => esc(r.created_at) }], { onRow: true });
        App.bindRows(App.$('#ulist'), rows, (u) => userForm(u, load));
      };
      App.$('#un').onclick = () => userForm(null, load);
      App.$('#ua').onclick = async () => {
        const rows = await App.get('/api/audit');
        App.modal({ title: 'Audit log (latest 300)', xwide: true, body: App.table(rows, [{ label: 'Time', key: 'created_at' }, { label: 'User', key: 'user_name' },
          { label: 'Action', key: 'action' }, { label: 'Entity', fmt: (r) => `${esc(r.entity || '')} ${r.entity_id ? '#' + r.entity_id : ''}` }, { label: 'Details', fmt: (r) => `<small class="mono">${esc(r.details || '')}</small>` }]) });
      };
      await load();
    }
  };

  App.pages.settings = {
    title: 'Settings & Backup', roles: ['admin'],
    async render(el) {
      const s = await App.get('/api/settings');
      const info = await App.get('/api/system/info');
      const yes = (k) => (s[k] === '1' ? 'checked' : '');
      el.innerHTML = `<form id="setf" class="card" autocomplete="off">
        <div class="form-sec" style="margin-top:0">Indian rupee rate (used on every GRN)</div><div class="form-grid">
          ${App.field('1 Indian Rupee (₹) = Rs.', 'grn_india_rate', s.grn_india_rate, { type: 'number', step: '0.0001', required: true })}
          ${App.field('Default other expenses (Rs.)', 'grn_other_expenses', s.grn_other_expenses, { type: 'number', step: '0.01' })}
          ${App.field('Cargo & other expenses entered as', 'grn_charges_basis', '', { type: 'select', options: App.options([{ value: 'per_piece', label: 'Per piece' }, { value: 'per_grn', label: 'Total for the GRN (shared per piece)' }], s.grn_charges_basis) })}
          <p class="muted full" style="margin:0">Cost (Rs.) = India cost (₹) × rupee rate + Other expenses (Rs.) + Cargo / shipping (Rs.). These values are pre-filled on each new GRN and can be changed there.</p></div>
        <div class="form-sec">Company (printed on invoices)</div><div class="form-grid">
          ${App.field('Company name', 'company_name', s.company_name, { required: true, cls: 'span2' })}${App.field('Tagline', 'company_tagline', s.company_tagline, { cls: 'span2' })}
          ${App.field('Address', 'company_address', s.company_address, { cls: 'span2' })}${App.field('City', 'company_city', s.company_city)}
          ${App.field('Business Reg. (BR) No.', 'company_br_no', s.company_br_no)}${App.field('Phone', 'company_phone', s.company_phone)}${App.field('Email', 'company_email', s.company_email)}
          ${App.field('Bank details (on invoice)', 'bank_details', s.bank_details, { type: 'textarea', cls: 'span2', placeholder: 'Bank, branch, account name & number' })}
          ${App.field('Invoice terms & conditions', 'invoice_terms', s.invoice_terms, { type: 'textarea', cls: 'span2' })}</div>
        <div class="form-sec">Billing</div><div class="form-grid">
          ${App.field('Invoice number prefix', 'invoice_prefix', s.invoice_prefix)}
          ${App.field('Default price list', 'default_price_list', '', { type: 'select', options: App.options([{ value: 'wholesale', label: 'Wholesale' }, { value: 'retail', label: 'Retail' }], s.default_price_list) })}
          ${App.field('Default print format', 'print_format', '', { type: 'select', options: App.options([{ value: 'a4', label: 'A4 invoice' }, { value: 'thermal', label: '80mm thermal receipt' }], s.print_format) })}
          <label class="chk"><input type="checkbox" name="round_off" ${yes('round_off')}> Round bill total to the nearest rupee</label>
          <label class="chk"><input type="checkbox" name="allow_negative_stock" ${yes('allow_negative_stock')}> Allow billing when stock is insufficient</label></div>
        <div class="form-sec">VAT (only if the business is VAT registered)</div><div class="form-grid">
          <label class="chk"><input type="checkbox" name="tax_enabled" ${yes('tax_enabled')}> Charge VAT on invoices</label>
          ${App.field('Tax name', 'tax_name', s.tax_name)}
          ${App.field('Default VAT rate %', 'default_tax_rate', s.default_tax_rate, { type: 'number', step: '0.01' })}
          ${App.field('VAT registration no.', 'company_vat_no', s.company_vat_no)}
          <label class="chk"><input type="checkbox" name="prices_include_tax" ${yes('prices_include_tax')}> Selling prices already include VAT</label>
          <p class="muted full" style="margin:0">When VAT is off, invoices print as a normal “INVOICE” with no tax lines. Confirm the current VAT rate and registration rules with your accountant.</p></div>
        <div class="toolbar" style="margin:16px 0 0"><span class="spacer"></span><button class="btn primary lg" type="submit">Save settings</button></div></form>
        <div class="card"><h3>Backup & data</h3>
          <dl class="kv"><dt>Database file</dt><dd class="mono">${esc(info.db_file)}</dd><dt>Size</dt><dd>${(info.db_size / 1024 / 1024).toFixed(2)} MB</dd>
            <dt>Automatic daily backups</dt><dd class="mono">${esc(info.backups_dir)}</dd>
            <dt>Records</dt><dd>${info.counts.products} products · ${info.counts.customers} customers · ${info.counts.suppliers} suppliers · ${info.counts.sales} invoices · ${info.counts.grns} GRNs</dd></dl>
          <p>Download a backup regularly and keep a copy on a pen drive or Google Drive. To restore, stop the server and replace <span class="mono">data/erp.db</span> with the backup file.</p>
          <a class="btn primary" href="/api/backup">Download backup now</a></div>`;
      App.$('#setf').onsubmit = async (e) => {
        e.preventDefault();
        const d = App.formData(e.target);
        for (const k of ['prices_include_tax', 'round_off', 'allow_negative_stock', 'tax_enabled']) d[k] = d[k] ? '1' : '0';
        try {
          await App.put('/api/settings', d);
          await App.loadMeta();
          App.renderShell();
          App.route();
          App.toast('Settings saved', 'ok');
        } catch (err) { App.err(err); }
      };
    }
  };
})();
