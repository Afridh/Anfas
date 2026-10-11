(function () {
  const { esc, money } = App;

  App.pages.dashboard = {
    title: 'Dashboard',
    async render(el) {
      const d = await App.get('/api/dashboard');
      const staff = App.isStaff();
      const modes = (d.today.by_mode || []).map((m) => `${esc(App.modeLabel(m.mode))} ${money(m.amount)}`).join(' · ') || 'No payments yet';
      let html = `<div class="grid g4" style="margin-bottom:16px">
        <div class="stat brand"><div class="lbl">Today's sales</div><div class="val">${money(d.today.sales)}</div><div class="sub">${d.today.bills} bills · ${modes}</div></div>`;
      if (staff) {
        html += `<div class="stat ok"><div class="lbl">This month</div><div class="val">${money(d.month.sales)}</div>
            <div class="sub">${d.month.bills} bills · Gross profit ${money(d.month.gross_profit)}</div></div>
          <div class="stat warn"><div class="lbl">Receivable from customers</div><div class="val">${money(d.receivable)}</div><div class="sub"><a href="#/reports/outstanding">View ageing →</a></div></div>
          <div class="stat info"><div class="lbl">Payable to suppliers</div><div class="val">${money(d.payable)}</div><div class="sub">Stock value at cost ${money(d.stock_value)}</div></div>`;
      }
      html += '</div>';

      if (staff) {
        const max = Math.max(1, ...d.daily.map((x) => x.amount));
        const days = [];
        for (let i = 29; i >= 0; i--) {
          const dt = new Date(Date.now() - i * 86400000);
          const key = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
          const row = d.daily.find((x) => x.date === key);
          days.push({ key, amount: row ? row.amount : 0, bills: row ? row.bills : 0 });
        }
        const topMax = Math.max(1, ...d.top_products.map((p) => p.amount));
        html += `<div class="grid g2">
          <div class="card"><h3>Sales — last 30 days</h3>
            <div class="bars">${days.map((x) => `<div class="b" style="height:${(x.amount / max) * 100}%" title="${App.date(x.key)}: ${money(x.amount)} (${x.bills} bills)"></div>`).join('')}</div>
            <div class="bars-x">${days.map((x, i) => `<span>${i % 5 === 0 ? x.key.slice(8) : ''}</span>`).join('')}</div></div>
          <div class="card"><h3>Top products this month</h3>
            ${d.top_products.length ? d.top_products.map((p) => `<div style="margin-bottom:8px"><div class="inline"><span>${esc(p.name)}</span>
              <span class="auto right"><b>${money(p.amount)}</b> <small class="muted">${App.qty(p.qty)} ${esc(p.unit)}</small></span></div>
              <div class="hbar"><i style="width:${(p.amount / topMax) * 100}%"></i></div></div>`).join('') : '<div class="empty">No sales yet this month</div>'}</div>
        </div>
        <div class="grid g2">
          <div class="card"><div class="card-head"><h3>Low stock (${d.low_stock_count})</h3><span class="grow"></span><a href="#/products/low">View all</a></div>
            ${App.table(d.low_stock, [
    { label: 'Item', fmt: (r) => `${esc(r.name)}<br><small class="muted">${esc(r.sku)}</small>` },
    { label: 'Stock', num: true, fmt: (r) => `<b style="color:var(--bad)">${App.qty(r.stock)}</b> ${esc(r.unit)}` },
    { label: 'Reorder at', num: true, fmt: (r) => App.qty(r.reorder_level) }
  ], { empty: 'All items are above reorder level' })}</div>
          <div class="card"><div class="card-head"><h3>Recent GRNs from India</h3><span class="grow"></span>
              <span class="muted" style="font-size:.85rem">Rate: 1 ₹ = Rs. ${d.india_rate} · this month ${money(d.month_grn)}</span> <a href="#/grn">All GRNs</a></div>
            ${App.table(d.recent_grns, [
    { label: 'GRN', fmt: (r) => `<b>${esc(r.grn_no)}</b><br><small class="muted">${esc(r.supplier_name)}</small>` },
    { label: 'Date', fmt: (r) => App.date(r.date) },
    { label: 'Bale', key: 'bale_no' },
    { label: 'Pcs', num: true, fmt: (r) => App.qty(r.total_pcs) },
    { label: 'Total cost', num: true, fmt: (r) => money(r.final_total) }
  ], { empty: 'No GRNs yet' })}</div>
        </div>`;
      }
      html += `<div class="card" id="recentCard"><div class="card-head"><h3>Recent invoices</h3><span class="grow"></span><a href="#/sales">All invoices</a></div>
        ${App.table(d.recent_sales, [
    { label: 'Invoice', key: 'invoice_no' }, { label: 'Date', fmt: (r) => App.date(r.date) }, { label: 'Customer', key: 'customer_name' },
    { label: 'Amount', num: true, fmt: (r) => money(r.total) }, { label: 'Status', fmt: (r) => App.statusBadge(r.status) }
  ], { onRow: true, empty: 'No invoices yet — press F2 to start billing' })}</div>`;
      el.innerHTML = html;
      const recent = App.$('#recentCard');
      App.bindRows(recent, d.recent_sales, (r) => App.showSale(r.id));

      if (staff && !d.recent_sales.length && App.can('admin')) {
        const info = await App.get('/api/system/info');
        if (!info.counts.products) {
          el.insertAdjacentHTML('afterbegin', `<div class="card" style="border-left:4px solid var(--accent)"><h3>Welcome! Let's set up your business</h3>
            <ol style="margin:0 0 10px;padding-left:18px;line-height:1.9"><li>Enter company name, address, phone and the Indian rupee rate in <a href="#/settings">Settings</a>.</li>
            <li>Add products in <a href="#/products">Products</a>, then receive bales from India with <a href="#/grn">GRN</a>.</li><li>Add suppliers and customers, then start billing with <b>F2</b>.</li></ol>
            <button class="btn" id="loadDemo">Load sample data to explore first</button></div>`);
          App.$('#loadDemo').onclick = async () => {
            if (!await App.confirm('Load sample products, Indian suppliers, GRNs and sales? (Only possible while the system is empty.)')) return;
            try { await App.post('/api/system/demo'); App.toast('Sample data loaded', 'ok'); App.products = null; App.route(); } catch (e) { App.err(e); }
          };
        }
      }
    }
  };
})();
