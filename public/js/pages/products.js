/* Products / fabrics master, categories, stock adjustment & movements, barcode labels */
(function () {
  const { esc, money } = App;

  const catOptions = (sel, blank) => App.options(App.meta.categories.map((c) => ({ value: c.id, label: c.name })), sel, { blank: blank || '-- none --' });

  App.productForm = async function (p, onSaved, preset) {
    const isNew = !p;
    if (isNew) {
      const { sku } = await App.get('/api/products/next-sku');
      p = { sku, unit: 'PCS', tax_rate: Number(App.settings().default_tax_rate) || 0, origin: 'India', active: 1, ...(preset || {}) };
    }
    App.modal({
      title: isNew ? 'New product' : `Edit — ${p.name}`, wide: true,
      body: `<div class="form-sec" style="margin-top:0">Basic</div><div class="form-grid">
          ${App.field('Product name', 'name', p.name, { required: true, cls: 'span2', placeholder: 'e.g. Rayon Long Kurti' })}
          ${App.field('SKU / code', 'sku', p.sku, { required: true })}
          ${App.field('Barcode (blank = SKU)', 'barcode', p.barcode || '')}
          ${App.field('Category', 'category_id', '', { type: 'select', options: catOptions(p.category_id) })}
          ${App.field('Unit', 'unit', '', { type: 'select', options: App.options(App.meta.units, p.unit) })}
          ${App.field('Size / size range', 'size', p.size || '', { placeholder: 'M-L-XL-XXL / Free / 38-44' })}
          ${App.taxOn() ? App.field(App.taxName() + ' rate %', 'tax_rate', p.tax_rate, { type: 'number', step: '0.01' }) : `<input type="hidden" name="tax_rate" value="${esc(p.tax_rate)}">`}
        </div>
        <div class="form-sec">Pricing</div><div class="form-grid">
          ${App.field('Cost price (Rs.)', 'cost_price', p.cost_price || 0, { type: 'number', step: '0.01' })}
          ${App.field('Wholesale price (Rs.)', 'wholesale_price', p.wholesale_price || 0, { type: 'number', step: '0.01', required: true })}
          ${App.field('Retail price (Rs.)', 'sale_price', p.sale_price || 0, { type: 'number', step: '0.01' })}
          ${App.field('Label price (Rs.)', 'mrp', p.mrp || 0, { type: 'number', step: '0.01' })}
          ${App.field('Reorder level', 'reorder_level', p.reorder_level || 0, { type: 'number', step: '0.01' })}
          ${isNew ? App.field('Opening stock', 'opening_stock', 0, { type: 'number', step: '0.01' }) : `<label class="f"><span>Current stock</span><input readonly value="${App.qty(p.stock)} ${esc(p.unit)}"></label>`}
        </div>
        <div class="form-sec">Details</div><div class="form-grid">
          ${App.field('Colour', 'color', p.color || '')}${App.field('Design / pattern', 'design', p.design || '')}
          ${App.field('Material', 'composition', p.composition || '', { placeholder: 'Cotton / Rayon / Silk' })}${App.field('Country of origin', 'origin', p.origin || '')}
          <label class="chk"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Active (available for sale)</label></div>`,
      onSubmit: async (f) => {
        const d = App.formData(f);
        let savedId = p.id;
        if (isNew) savedId = (await App.post('/api/products', d)).id;
        else await App.put('/api/products/' + p.id, d);
        App.products = null;
        App.toast('Product saved', 'ok');
        if (onSaved) onSaved(savedId);
      }
    });
  };

  async function showProduct(id, reload) {
    const p = await App.get('/api/products/' + id);
    const m = App.modal({
      title: p.name, wide: true,
      body: `<div class="grid g3" style="margin-bottom:12px">
          <div class="stat brand"><div class="lbl">In stock</div><div class="val">${App.qty(p.stock)} ${esc(p.unit)}</div><div class="sub">Reorder at ${App.qty(p.reorder_level)}</div></div>
          <div class="stat info"><div class="lbl">Avg. cost / Retail</div><div class="val">${money(p.cost_price)}</div><div class="sub">Wholesale ${money(p.wholesale_price)} · Retail ${money(p.sale_price)}</div></div>
          <div class="stat ok"><div class="lbl">Stock value (cost)</div><div class="val">${money(p.stock * p.cost_price)}</div>
            <div class="sub">Margin ${p.wholesale_price ? Math.round((1 - p.cost_price / p.wholesale_price) * 100) : 0}% on wholesale</div></div></div>
        <dl class="kv" style="margin-bottom:12px"><dt>SKU / Barcode</dt><dd>${esc(p.sku)} / ${esc(p.barcode || p.sku)}</dd><dt>Size</dt><dd>${esc(p.size || '-')}${App.taxOn() ? ' · ' + esc(App.taxName()) + ' ' + p.tax_rate + '%' : ''}</dd>
          <dt>Details</dt><dd>${[p.category, p.color, p.design, p.composition, p.origin].filter(Boolean).map(esc).join(' · ')}</dd></dl>
        <h3>Stock movements</h3>
        ${App.table(p.moves, [
    { label: 'Date', fmt: (r) => App.date(r.date) }, { label: 'Type', fmt: (r) => `<span class="badge">${esc(r.type)}</span>` },
    { label: 'Reference', fmt: (r) => esc(r.ref_no || r.notes || '') },
    { label: 'In', num: true, fmt: (r) => (r.qty > 0 ? App.qty(r.qty) : '') }, { label: 'Out', num: true, fmt: (r) => (r.qty < 0 ? App.qty(-r.qty) : '') },
    { label: 'Balance', num: true, fmt: (r) => `<b>${App.qty(r.balance)}</b>` }, { label: 'Unit cost', num: true, fmt: (r) => App.num(r.unit_cost) },
    { label: 'By', key: 'user_name' }
  ], { empty: 'No movements yet' })}`,
      footer: `${App.isStaff() ? '<button type="button" class="btn danger" id="pDel">Delete</button><span class="grow"></span><button type="button" class="btn" id="pAdj">Adjust stock</button><button type="button" class="btn" id="pLbl">Print labels</button><button type="button" class="btn primary" id="pEdit">Edit</button>' : '<button type="button" class="btn" data-close>Close</button>'}`
    });
    if (!App.isStaff()) return;
    App.$('#pEdit', m.el).onclick = () => { m.close(); App.productForm(p, reload); };
    App.$('#pLbl', m.el).onclick = () => labelDialog([p]);
    App.$('#pAdj', m.el).onclick = () => { m.close(); adjustDialog([p], reload); };
    App.$('#pDel', m.el).onclick = async () => {
      if (!await App.confirm(`Delete "${p.name}"? If it has transactions it will be deactivated instead.`)) return;
      try {
        const r = await App.del('/api/products/' + p.id);
        App.toast(r.deactivated ? 'Product has history — deactivated instead' : 'Product deleted', 'ok');
        App.products = null; m.close(); reload();
      } catch (e) { App.err(e); }
    };
  }

  function labelDialog(products) {
    App.modal({
      title: 'Print barcode labels', wide: true,
      body: `<p class="muted" style="margin-top:0">Choose label size and copies. Use a label printer (TSC / Zebra / TVS) or A4 sticker sheets.</p>
        <div class="form-grid" style="margin-bottom:12px">${App.field('Label size', 'size', '', { type: 'select', options: App.options([{ value: '50x25', label: '50 × 25 mm (label printer)' }, { value: '38x25', label: '38 × 25 mm (label printer)' }, { value: '75x38', label: '75 × 38 mm (roll tag)' }, { value: 'a4', label: 'A4 sheet (4 across)' }], '50x25') })}</div>
        ${App.table(products, [{ label: 'Product', fmt: (r) => `${esc(r.name)} <small class="muted">${esc(r.barcode || r.sku)}</small>` },
    { label: 'Price', num: true, fmt: (r) => money(r.mrp || r.sale_price) },
    { label: 'Copies', num: true, fmt: (r, i) => `<input type="number" min="0" value="1" data-copies="${r.id}" style="width:80px" data-skip>` }])}`,
      submitText: 'Print',
      onSubmit: (f) => {
        const items = products.map((p) => ({ product: p, copies: Number(App.$(`[data-copies="${p.id}"]`, f).value) || 0 })).filter((x) => x.copies > 0);
        App.printLabels(items, f.size.value);
        return false;
      }
    });
  }
  App.labelDialog = labelDialog;

  function adjustDialog(preset, done) {
    const lines = (preset || []).map((p) => ({ product: p, qty: '' }));
    const m = App.modal({
      title: 'Stock adjustment', wide: true,
      body: `<p class="muted" style="margin-top:0">Use + for stock found / roll re-measured longer, − for damage, cutting loss, shortage.</p>
        <div class="form-grid" style="margin-bottom:12px">${App.field('Date', 'date', App.today(), { type: 'date' })}
          ${App.field('Reason', 'reason', '', { type: 'select', options: App.options(['Physical stock count', 'Damaged / defective', 'Cutting / shrinkage loss', 'Short received in bale', 'Sample given', 'Found / excess', 'Other']) })}</div>
        <input id="adjPick" placeholder="Search product to add…" data-skip><div id="adjLines" style="margin-top:10px"></div>`,
      submitText: 'Save adjustment',
      onSubmit: async (f) => {
        const d = App.formData(f);
        d.items = lines.filter((l) => Number(l.qty)).map((l) => ({ product_id: l.product.id, qty: Number(l.qty), notes: l.notes }));
        if (!d.items.length) { App.toast('Enter quantities', 'err'); return false; }
        await App.post('/api/stock/adjust', d);
        App.products = null;
        App.toast('Stock adjusted', 'ok');
        if (done) done();
      }
    });
    const draw = () => {
      App.$('#adjLines', m.el).innerHTML = App.table(lines, [
        { label: 'Product', fmt: (r) => `${esc(r.product.name)}<br><small class="muted">${esc(r.product.sku)}</small>` },
        { label: 'Current', num: true, fmt: (r) => `${App.qty(r.product.stock)} ${esc(r.product.unit)}` },
        { label: 'Adjust (+/−)', num: true, fmt: (r) => `<input type="number" step="0.01" data-skip data-q="${lines.indexOf(r)}" value="${r.qty}" style="width:110px">` },
        { label: 'Or set counted qty', num: true, fmt: (r) => `<input type="number" step="0.01" data-skip data-c="${lines.indexOf(r)}" style="width:110px" placeholder="count">` },
        { label: '', fmt: (r) => `<button type="button" class="btn sm danger" data-x="${lines.indexOf(r)}">✕</button>` }
      ], { empty: 'Add products above' });
      App.$$('[data-q]', m.el).forEach((i) => i.oninput = () => { lines[i.dataset.q].qty = i.value; });
      App.$$('[data-c]', m.el).forEach((i) => i.oninput = () => {
        const l = lines[i.dataset.c];
        l.qty = i.value === '' ? '' : Tax.r3(Number(i.value) - l.product.stock);
        App.$(`[data-q="${i.dataset.c}"]`, m.el).value = l.qty;
      });
      App.$$('[data-x]', m.el).forEach((b) => b.onclick = () => { lines.splice(Number(b.dataset.x), 1); draw(); });
    };
    App.productPicker(App.$('#adjPick', m.el), (p) => { if (!lines.find((l) => l.product.id === p.id)) lines.push({ product: p, qty: '' }); draw(); });
    draw();
  }

  function importDialog(done) {
    App.modal({
      title: 'Import products from CSV', wide: true,
      body: `<p style="margin-top:0">Columns (header row required): <code>sku, name, category, unit, size, cost_price, wholesale_price, sale_price, mrp, opening_stock, reorder_level, color, design, composition, origin, barcode</code>.
        Existing SKUs are updated; new SKUs are created. Save your Excel sheet as “CSV UTF-8”.</p>
        <p><button type="button" class="btn sm" id="tpl">Download template</button></p>
        <input type="file" accept=".csv,text/csv" id="csvFile" data-skip><div id="csvPrev" style="margin-top:10px"></div>`,
      submitText: 'Import',
      onSubmit: async (f) => {
        const file = App.$('#csvFile', f).files[0];
        if (!file) { App.toast('Choose a CSV file', 'err'); return false; }
        const rows = App.parseCsv(await file.text());
        const r = await App.post('/api/products/import', { rows });
        App.products = null;
        await App.loadMeta();
        App.toast(`Imported: ${r.created} new, ${r.updated} updated${r.errors.length ? ', ' + r.errors.length + ' errors' : ''}`, r.errors.length ? 'err' : 'ok');
        if (r.errors.length) App.modal({ title: 'Import errors', body: `<pre style="white-space:pre-wrap">${esc(r.errors.join('\n'))}</pre>` });
        done();
      },
      onOpen: (f) => {
        App.$('#tpl', f).onclick = () => App.csv([{ sku: 'KT1001', name: 'Rayon Long Kurti', category: 'Kurtis & Tops', unit: 'PCS', size: 'M-L-XL-XXL', cost_price: 950, wholesale_price: 1150, sale_price: 1490, mrp: 1490, opening_stock: 48, reorder_level: 12, color: 'Assorted', design: 'Printed', composition: 'Rayon', origin: 'India', barcode: '' }],
          ['sku', 'name', 'category', 'unit', 'size', 'cost_price', 'wholesale_price', 'sale_price', 'mrp', 'opening_stock', 'reorder_level', 'color', 'design', 'composition', 'origin', 'barcode'].map((k) => ({ key: k, label: k })), 'product-template.csv');
        App.$('#csvFile', f).onchange = async (e) => {
          const rows = App.parseCsv(await e.target.files[0].text());
          App.$('#csvPrev', f).innerHTML = `<b>${rows.length} rows found.</b> First rows:` + App.table(rows.slice(0, 5), ['sku', 'name', 'category', 'unit', 'sale_price', 'opening_stock'].map((k) => ({ key: k, label: k })));
        };
      }
    });
  }

  function categoriesDialog(done) {
    const draw = async (m) => {
      const cats = await App.get('/api/categories');
      App.$('#catList', m.el).innerHTML = App.table(cats, [
        { label: 'Category', key: 'name' }, { label: 'Products', num: true, key: 'product_count' },
        { label: '', fmt: (c) => `<button type="button" class="btn sm" data-ren="${c.id}">Rename</button> <button type="button" class="btn sm danger" data-del="${c.id}">Delete</button>` }
      ]);
      App.$$('[data-ren]', m.el).forEach((b) => b.onclick = async () => {
        const c = cats.find((x) => x.id === Number(b.dataset.ren));
        const d = await App.prompt('Rename category', App.field('Name', 'name', c.name, { required: true, cls: 'full' }));
        if (d) { try { await App.put('/api/categories/' + c.id, d); draw(m); } catch (e) { App.err(e); } }
      });
      App.$$('[data-del]', m.el).forEach((b) => b.onclick = async () => {
        if (await App.confirm('Delete this category? Products will become uncategorised.')) { await App.del('/api/categories/' + b.dataset.del); draw(m); }
      });
    };
    const m = App.modal({
      title: 'Categories',
      body: `<div class="inline" style="margin-bottom:10px"><input id="catNew" placeholder="New category name" data-skip><button type="button" class="btn primary auto" id="catAdd">Add</button></div><div id="catList"></div>`,
      footer: '<button type="button" class="btn" data-close>Done</button>'
    });
    App.$('#catAdd', m.el).onclick = async () => {
      const v = App.$('#catNew', m.el).value.trim();
      if (!v) return;
      try { await App.post('/api/categories', { name: v }); App.$('#catNew', m.el).value = ''; draw(m); } catch (e) { App.err(e); }
    };
    draw(m);
    const obs = new MutationObserver(async () => { if (!document.body.contains(m.el)) { obs.disconnect(); await App.loadMeta(); done(); } });
    obs.observe(document.body, { childList: true });
  }

  App.pages.products = {
    title: 'Products',
    async render(el, args) {
      const f = { q: '', category_id: '', low_stock: args[0] === 'low' ? '1' : '', active: '' };
      const staff = App.isStaff();
      el.innerHTML = `<div class="toolbar">
          <input type="search" id="pq" placeholder="Search name, SKU, barcode, colour, size…" style="max-width:320px">
          <select id="pc" style="width:auto">${catOptions('', 'All categories')}</select>
          <label class="chk"><input type="checkbox" id="pl" ${f.low_stock ? 'checked' : ''}> Low stock only</label>
          ${staff ? '<label class="chk"><input type="checkbox" id="pa"> Show inactive</label>' : ''}
          <span class="spacer"></span>
          ${staff ? '<button class="btn" id="pCat">Categories</button><button class="btn" id="pImp">Import CSV</button>' : ''}
          <button class="btn" id="pExp">Export CSV</button>
          ${staff ? '<button class="btn" id="pLbls">Labels</button><button class="btn primary" id="pNew">+ New product</button>' : ''}</div>
        <div id="plist"></div>`;
      const cols = [
        { label: 'SKU', key: 'sku', fmt: (r) => `<span class="mono">${esc(r.sku)}</span>` },
        { label: 'Name', key: 'name', fmt: (r) => `<b>${esc(r.name)}</b>${r.active ? '' : ' <span class="badge bad">inactive</span>'}<br><small class="muted">${[r.color, r.design].filter(Boolean).map(esc).join(' · ')}</small>` },
        { label: 'Category', key: 'category' },
        { label: 'Size', key: 'size' },
        ...(App.taxOn() ? [{ label: App.taxName(), key: 'tax_rate', num: true, fmt: (r) => r.tax_rate + '%' }] : []),
        ...(staff ? [{ label: 'Cost', key: 'cost_price', num: true, fmt: (r) => App.num(r.cost_price) }] : []),
        { label: 'Wholesale', key: 'wholesale_price', num: true, fmt: (r) => `<b>${App.num(r.wholesale_price)}</b>` },
        { label: 'Retail', key: 'sale_price', num: true, fmt: (r) => App.num(r.sale_price) },
        { label: 'Stock', key: 'stock', num: true, fmt: (r) => `<b style="color:${r.stock <= r.reorder_level ? 'var(--bad)' : 'inherit'}">${App.qty(r.stock)}</b> ${esc(r.unit)}` },
        ...(staff ? [{ label: 'Value', key: 'value', num: true, fmt: (r) => App.num(r.stock * r.cost_price), csv: (r) => Tax.r2(r.stock * r.cost_price) }] : [])
      ];
      let rows = [];
      const load = async () => {
        rows = await App.get('/api/products' + App.qs(f));
        App.$('#plist').innerHTML = App.table(rows, cols, {
          onRow: true, empty: 'No products. Click “+ New product” or import a CSV.',
          foot: staff ? { sku: `${rows.length} items`, value: App.num(App.sum(rows, (r) => Math.max(0, r.stock) * r.cost_price)) } : null
        });
        App.bindRows(App.$('#plist'), rows, (r) => showProduct(r.id, load));
      };
      App.$('#pq').oninput = App.debounce((e) => { f.q = e.target.value; load(); }, 250);
      App.$('#pc').onchange = (e) => { f.category_id = e.target.value; load(); };
      App.$('#pl').onchange = (e) => { f.low_stock = e.target.checked ? '1' : ''; load(); };
      App.$('#pExp').onclick = () => App.csv(rows, [
        ...['sku', 'name', 'category', 'unit', 'size', ...(staff ? ['cost_price'] : []), 'wholesale_price', 'sale_price', 'mrp', 'stock', 'reorder_level', 'color', 'design', 'composition', 'origin', 'barcode'].map((k) => ({ key: k, label: k }))
      ], `products-${App.today()}.csv`);
      if (staff) {
        App.$('#pa').onchange = (e) => { f.active = e.target.checked ? 'all' : ''; load(); };
        App.$('#pNew').onclick = () => App.productForm(null, load);
        App.$('#pImp').onclick = () => importDialog(load);
        App.$('#pCat').onclick = () => categoriesDialog(() => App.route());
        App.$('#pLbls').onclick = () => (rows.length ? labelDialog(rows.slice(0, 200)) : App.toast('No products listed'));
      }
      await load();
    }
  };

  App.pages.labels = {
    title: 'Barcode Labels', roles: ['admin', 'manager'],
    async render(el) {
      const chosen = [];
      el.innerHTML = `<div class="card"><p class="muted" style="margin-top:0">Add products, set copies, and print. Scanning a label at the POS adds the product to the bill.</p>
        <input id="lp" placeholder="Search product to add…"><div id="ll" style="margin-top:12px"></div>
        <div class="toolbar" style="margin-top:12px"><span class="spacer"></span><button class="btn primary" id="lgo">Continue to print</button></div></div>`;
      const draw = () => {
        App.$('#ll').innerHTML = App.table(chosen, [{ label: 'Product', fmt: (p) => esc(p.name) }, { label: 'Barcode', fmt: (p) => esc(p.barcode || p.sku) },
          { label: 'Price', num: true, fmt: (p) => money(p.mrp || p.sale_price) }, { label: '', fmt: (p) => `<button class="btn sm danger" data-x="${p.id}">✕</button>` }], { empty: 'No products selected' });
        App.$$('[data-x]').forEach((b) => b.onclick = () => { chosen.splice(chosen.findIndex((p) => p.id === Number(b.dataset.x)), 1); draw(); });
      };
      App.productPicker(App.$('#lp'), (p) => { if (!chosen.find((x) => x.id === p.id)) chosen.push(p); draw(); });
      App.$('#lgo').onclick = () => (chosen.length ? labelDialog(chosen) : App.toast('Add products first', 'err'));
      draw();
    }
  };

  App.pages.stock = {
    title: 'Stock Adjustments & Movements', roles: ['admin', 'manager'],
    async render(el) {
      const f = { from: App.monthStart(), to: '', type: '' };
      el.innerHTML = `<div class="toolbar"><input type="date" id="mf" value="${f.from}" style="width:auto"><span>to</span><input type="date" id="mt" style="width:auto">
          <select id="mty" style="width:auto">${App.options(['grn', 'grn_cancel', 'sale', 'purchase', 'return', 'adjust', 'opening', 'cancel', 'purchase_delete'], '', { blank: 'All types' })}</select>
          <span class="spacer"></span><button class="btn" id="mx">Export CSV</button><button class="btn primary" id="madj">+ New adjustment</button></div><div id="mlist"></div>`;
      const cols = [
        { label: 'Date', key: 'date', fmt: (r) => App.date(r.date) }, { label: 'Product', key: 'product_name', fmt: (r) => `${esc(r.product_name)} <small class="muted">${esc(r.sku)}</small>` },
        { label: 'Type', key: 'type', fmt: (r) => `<span class="badge">${esc(r.type)}</span>` }, { label: 'Reference', key: 'ref_no', fmt: (r) => esc(r.ref_no || '') },
        { label: 'Qty', key: 'qty', num: true, fmt: (r) => `<b style="color:${r.qty < 0 ? 'var(--bad)' : 'var(--ok)'}">${r.qty > 0 ? '+' : ''}${App.qty(r.qty)}</b> ${esc(r.unit)}` },
        { label: 'Balance', key: 'balance', num: true, fmt: (r) => App.qty(r.balance) }, { label: 'Unit cost', key: 'unit_cost', num: true, fmt: (r) => App.num(r.unit_cost) },
        { label: 'Notes', key: 'notes' }, { label: 'By', key: 'user_name' }
      ];
      let rows = [];
      const load = async () => {
        rows = await App.get('/api/stock/moves' + App.qs(f));
        App.$('#mlist').innerHTML = App.table(rows, cols);
      };
      App.$('#mf').onchange = (e) => { f.from = e.target.value; load(); };
      App.$('#mt').onchange = (e) => { f.to = e.target.value; load(); };
      App.$('#mty').onchange = (e) => { f.type = e.target.value; load(); };
      App.$('#mx').onclick = () => App.csv(rows, cols, `stock-moves-${App.today()}.csv`);
      App.$('#madj').onclick = () => adjustDialog([], load);
      await load();
    }
  };
})();
