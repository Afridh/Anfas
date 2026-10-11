const { q, getSettings } = require('../db');
const { route, today } = require('../app');
const { r2, r3 } = require('../../public/js/tax');

const STAFF = ['admin', 'manager'];
const range = (query) => ({ from: query.from || today().slice(0, 8) + '01', to: query.to || today() });
const roundAll = (o) => { for (const k of Object.keys(o)) if (typeof o[k] === 'number') o[k] = r2(o[k]); return o; };

/* ---------- Dashboard ---------- */
route('GET', '/api/dashboard', null, ({ user }) => {
  const t = today();
  const monthStart = t.slice(0, 8) + '01';
  const todaySales = q.get(`SELECT COUNT(*) n, COALESCE(SUM(total - returned),0) amt FROM sales WHERE date = ? AND cancelled = 0`, t);
  const byMode = q.all(`SELECT sp.mode, SUM(sp.amount) amount FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
    WHERE s.date = ? AND s.cancelled = 0 GROUP BY sp.mode`, t);
  const out = { today: { sales: r2(todaySales.amt), bills: todaySales.n, by_mode: byMode } };
  out.recent_sales = q.all(`SELECT id, invoice_no, date, customer_name, total, status FROM sales
    ${user.role === 'cashier' ? 'WHERE user_id = ' + Number(user.id) : ''} ORDER BY id DESC LIMIT 8`);
  if (user.role === 'cashier') return out;

  const month = q.get(`SELECT COUNT(*) n, COALESCE(SUM(total - returned),0) amt, COALESCE(SUM(taxable),0) taxable FROM sales
    WHERE date BETWEEN ? AND ? AND cancelled = 0`, monthStart, t);
  const monthCogs = q.val(`SELECT COALESCE(SUM((si.qty - si.returned_qty) * si.cost_price),0) FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.date BETWEEN ? AND ? AND s.cancelled = 0`, monthStart, t);
  const monthRet = q.val('SELECT COALESCE(SUM(taxable),0) FROM sales_returns WHERE date BETWEEN ? AND ?', monthStart, t);
  const monthExp = q.val('SELECT COALESCE(SUM(amount),0) FROM expenses WHERE date BETWEEN ? AND ?', monthStart, t);
  out.month = { sales: r2(month.amt), bills: month.n, gross_profit: r2(month.taxable - monthRet - monthCogs), expenses: r2(monthExp) };
  out.receivable = r2(q.val(`SELECT COALESCE(SUM(opening_balance),0) FROM customers`) +
    q.val(`SELECT COALESCE(SUM(debit - credit),0) FROM ledger WHERE party_type = 'customer'`));
  out.payable = r2(q.val(`SELECT COALESCE(SUM(opening_balance),0) FROM suppliers`) +
    q.val(`SELECT COALESCE(SUM(credit - debit),0) FROM ledger WHERE party_type = 'supplier'`));
  out.stock_value = r2(q.val('SELECT COALESCE(SUM(stock * cost_price),0) FROM products WHERE active = 1 AND stock > 0'));
  out.low_stock = q.all(`SELECT id, sku, name, unit, stock, reorder_level FROM products WHERE active = 1 AND reorder_level > 0 AND stock <= reorder_level
    ORDER BY stock - reorder_level LIMIT 15`);
  out.low_stock_count = q.val('SELECT COUNT(*) FROM products WHERE active = 1 AND reorder_level > 0 AND stock <= reorder_level');
  out.recent_grns = q.all(`SELECT g.id, g.grn_no, g.date, g.bale_no, g.total_pcs, g.final_total, s.name AS supplier_name FROM grn g
    JOIN suppliers s ON s.id = g.supplier_id WHERE g.cancelled = 0 ORDER BY g.id DESC LIMIT 6`);
  out.month_grn = r2(q.val('SELECT COALESCE(SUM(final_total),0) FROM grn WHERE cancelled = 0 AND date BETWEEN ? AND ?', monthStart, t));
  out.india_rate = Number(getSettings().grn_india_rate) || 0;
  out.daily = q.all(`SELECT date, SUM(total - returned) amount, COUNT(*) bills FROM sales WHERE cancelled = 0
    AND date >= date(?, '-29 days') GROUP BY date ORDER BY date`, t);
  out.top_products = q.all(`SELECT si.product_id, si.name, si.unit, SUM(si.qty - si.returned_qty) qty, SUM(si.total) amount
    FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.date BETWEEN ? AND ? AND s.cancelled = 0
    GROUP BY si.product_id ORDER BY amount DESC LIMIT 8`, monthStart, t);
  out.top_customers = q.all(`SELECT customer_name name, COUNT(*) bills, SUM(total - returned) amount FROM sales
    WHERE date BETWEEN ? AND ? AND cancelled = 0 AND customer_id IS NOT NULL GROUP BY customer_id ORDER BY amount DESC LIMIT 6`, monthStart, t);
  return out;
});

/* ---------- Sales analysis ---------- */
route('GET', '/api/reports/sales', STAFF, ({ query }) => {
  const { from, to } = range(query);
  const group = query.group || 'day';
  const base = `FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN products p ON p.id = si.product_id
    LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN users u ON u.id = s.user_id
    WHERE s.date BETWEEN ? AND ? AND s.cancelled = 0`;
  const metrics = `SUM(si.qty) qty, SUM(si.returned_qty) returned_qty, SUM(si.taxable) taxable, SUM(si.tax) tax,
    SUM(si.total) total, SUM(si.qty * si.cost_price) cost, SUM(si.taxable - si.qty * si.cost_price) profit, COUNT(DISTINCT s.id) bills`;
  const groups = {
    day: ['s.date', 's.date AS label'],
    month: ["substr(s.date,1,7)", "substr(s.date,1,7) AS label"],
    product: ['si.product_id', "si.name || ' (' || COALESCE(p.sku,'') || ')' AS label, si.unit"],
    category: ['p.category_id', "COALESCE(c.name,'Uncategorised') AS label"],
    customer: ["COALESCE(s.customer_id, 0)", "CASE WHEN s.customer_id IS NULL THEN 'Cash customers' ELSE s.customer_name END AS label"],
    user: ['s.user_id', "COALESCE(u.name,'-') AS label"]
  };
  const g = groups[group] || groups.day;
  const rows = q.all(`SELECT ${g[1]}, ${metrics} ${base} GROUP BY ${g[0]} ORDER BY ${group === 'day' || group === 'month' ? 'label' : 'total DESC'}`, from, to)
    .map(roundAll);
  const totals = roundAll(rows.reduce((a, r) => {
    for (const k of ['qty', 'taxable', 'tax', 'total', 'cost', 'profit']) a[k] = (a[k] || 0) + (r[k] || 0);
    return a;
  }, {}));
  totals.bills = q.val('SELECT COUNT(*) FROM sales WHERE date BETWEEN ? AND ? AND cancelled = 0', from, to);
  const returns = q.get('SELECT COUNT(*) n, COALESCE(SUM(taxable),0) taxable, COALESCE(SUM(total),0) total FROM sales_returns WHERE date BETWEEN ? AND ?', from, to);
  return { from, to, group, rows, totals, returns: roundAll(returns) };
});

/* ---------- VAT report (output VAT on sales, input VAT on local purchases) ---------- */
route('GET', '/api/reports/vat', STAFF, ({ query }) => {
  const { from, to } = range(query);
  const s = getSettings();
  const byRate = q.all(`SELECT si.tax_rate rate, SUM(si.taxable) taxable, SUM(si.tax) tax, SUM(si.total) total
    FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.date BETWEEN ? AND ? AND s.cancelled = 0
    GROUP BY si.tax_rate ORDER BY si.tax_rate`, from, to).map(roundAll);
  const invoices = q.all(`SELECT invoice_no, date, customer_name, customer_vat_no, taxable, tax, total FROM sales
    WHERE date BETWEEN ? AND ? AND cancelled = 0 ORDER BY date, id`, from, to).map(roundAll);
  const creditNotes = q.all(`SELECT r.return_no, r.date, s.invoice_no, s.customer_name, s.customer_vat_no, r.taxable, r.tax, r.total
    FROM sales_returns r JOIN sales s ON s.id = r.sale_id WHERE r.date BETWEEN ? AND ? ORDER BY r.date`, from, to).map(roundAll);
  const output = roundAll(q.get('SELECT COALESCE(SUM(taxable),0) taxable, COALESCE(SUM(tax),0) tax FROM sales WHERE date BETWEEN ? AND ? AND cancelled = 0', from, to));
  const cn = roundAll(q.get('SELECT COALESCE(SUM(taxable),0) taxable, COALESCE(SUM(tax),0) tax FROM sales_returns WHERE date BETWEEN ? AND ?', from, to));
  const input = roundAll(q.get('SELECT COALESCE(SUM(taxable),0) taxable, COALESCE(SUM(tax),0) tax FROM purchases WHERE date BETWEEN ? AND ?', from, to));
  const purchases = q.all(`SELECT p.ref_no, p.bill_no, p.date, sp.name supplier, sp.vat_no, p.taxable, p.tax, p.total
    FROM purchases p JOIN suppliers sp ON sp.id = p.supplier_id WHERE p.date BETWEEN ? AND ? ORDER BY p.date`, from, to);
  return {
    from, to, tax_name: s.tax_name, vat_no: s.company_vat_no, enabled: s.tax_enabled === '1',
    by_rate: byRate, invoices, credit_notes: creditNotes, purchases,
    summary: { output, credit_notes: cn, input, payable: r2(output.tax - cn.tax - input.tax) }
  };
});

/* ---------- Profit & Loss ---------- */
route('GET', '/api/reports/profit', STAFF, ({ query }) => {
  const { from, to } = range(query);
  const sales = q.get(`SELECT COALESCE(SUM(taxable),0) taxable, COALESCE(SUM(discount),0) discount FROM sales WHERE date BETWEEN ? AND ? AND cancelled = 0`, from, to);
  const cogs = q.val(`SELECT COALESCE(SUM(si.qty * si.cost_price),0) FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.date BETWEEN ? AND ? AND s.cancelled = 0`, from, to);
  const ret = q.get(`SELECT COALESCE(SUM(taxable),0) taxable FROM sales_returns WHERE date BETWEEN ? AND ?`, from, to);
  const retCost = q.val(`SELECT COALESCE(SUM(ri.qty * ri.cost_price),0) FROM sales_return_items ri JOIN sales_returns r ON r.id = ri.return_id
    WHERE r.date BETWEEN ? AND ?`, from, to);
  const expenses = q.all('SELECT category, SUM(amount) amount FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC', from, to).map(roundAll);
  const expTotal = r2(expenses.reduce((a, e) => a + e.amount, 0));
  const netSales = r2(sales.taxable - ret.taxable);
  const netCogs = r2(cogs - retCost);
  const gross = r2(netSales - netCogs);
  const adjustments = q.get(`SELECT COALESCE(SUM(CASE WHEN qty < 0 THEN -qty * unit_cost ELSE 0 END),0) loss,
      COALESCE(SUM(CASE WHEN qty > 0 THEN qty * unit_cost ELSE 0 END),0) gain FROM stock_moves WHERE type = 'adjust' AND date BETWEEN ? AND ?`, from, to);
  const stockLoss = r2(adjustments.loss - adjustments.gain);
  return {
    from, to, sales: r2(sales.taxable), discount: r2(sales.discount), returns: r2(ret.taxable), net_sales: netSales,
    cogs: netCogs, gross_profit: gross, gross_margin: netSales ? r2(gross / netSales * 100) : 0,
    stock_adjustment_loss: stockLoss, expenses, expenses_total: expTotal, net_profit: r2(gross - expTotal - stockLoss)
  };
});

/* ---------- Stock valuation ---------- */
route('GET', '/api/reports/stock', STAFF, ({ query }) => {
  const where = ['p.active = 1'];
  const args = [];
  if (query.category_id) { where.push('p.category_id = ?'); args.push(Number(query.category_id)); }
  if (query.only_in_stock) where.push('p.stock > 0');
  const rows = q.all(`SELECT p.id, p.sku, p.name, p.unit, p.size, COALESCE(c.name,'Uncategorised') category, p.stock, p.cost_price,
      p.wholesale_price, p.sale_price, p.reorder_level, p.stock * p.cost_price value_cost, p.stock * p.wholesale_price value_sale,
      (SELECT MAX(date) FROM stock_moves m WHERE m.product_id = p.id AND m.type IN ('sale')) last_sold
    FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE ${where.join(' AND ')} ORDER BY category, p.name`, ...args)
    .map((r) => roundAll({ ...r, stock: r3(r.stock) }));
  const byCat = {};
  for (const r of rows) {
    const b = byCat[r.category] || (byCat[r.category] = { category: r.category, items: 0, pcs: 0, value_cost: 0, value_sale: 0 });
    b.items++; b.pcs += Math.max(0, r.stock); b.value_cost += r.value_cost; b.value_sale += r.value_sale;
  }
  return {
    rows,
    by_category: Object.values(byCat).map(roundAll),
    totals: roundAll({ value_cost: rows.reduce((a, r) => a + r.value_cost, 0), value_sale: rows.reduce((a, r) => a + r.value_sale, 0) })
  };
});

/* ---------- Outstanding with ageing ---------- */
route('GET', '/api/reports/outstanding', STAFF, ({ query }) => {
  const type = query.type === 'supplier' ? 'supplier' : 'customer';
  const t = today();
  if (type === 'supplier') {
    return { type, rows: q.all(`SELECT s.id, s.name, s.country, s.currency, s.phone,
        s.opening_balance + COALESCE((SELECT SUM(credit - debit) FROM ledger l WHERE l.party_type = 'supplier' AND l.party_id = s.id),0) balance
      FROM suppliers s ORDER BY balance DESC`).filter((r) => Math.abs(r.balance) > 0.005).map(roundAll) };
  }
  const rows = q.all(`SELECT c.id, c.name, c.phone, c.city, c.credit_limit,
      c.opening_balance + COALESCE((SELECT SUM(debit - credit) FROM ledger l WHERE l.party_type = 'customer' AND l.party_id = c.id),0) balance
    FROM customers c ORDER BY balance DESC`).filter((r) => Math.abs(r.balance) > 0.005);
  for (const r of rows) {
    const inv = q.all(`SELECT date, total - returned - paid due FROM sales WHERE customer_id = ? AND cancelled = 0 AND total - returned - paid > 0.005`, r.id);
    const age = { a0_30: 0, a31_60: 0, a61_90: 0, a90: 0 };
    for (const i of inv) {
      const days = Math.floor((new Date(t) - new Date(i.date)) / 86400000);
      if (days <= 30) age.a0_30 += i.due; else if (days <= 60) age.a31_60 += i.due; else if (days <= 90) age.a61_90 += i.due; else age.a90 += i.due;
    }
    Object.assign(r, roundAll(age));
    r.balance = r2(r.balance);
  }
  return { type, rows };
});

/* ---------- Day book: money in / out by payment mode ---------- */
route('GET', '/api/reports/daybook', STAFF, ({ query }) => {
  const { from, to } = { from: query.from || today(), to: query.to || query.from || today() };
  const rows = [];
  const push = (src, mode, inAmt, outAmt) => rows.push({ source: src, mode, in: r2(inAmt), out: r2(outAmt) });
  for (const r of q.all(`SELECT sp.mode, SUM(sp.amount) a FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
      WHERE s.date BETWEEN ? AND ? AND s.cancelled = 0 GROUP BY sp.mode`, from, to)) push('Sales (paid at billing)', r.mode, r.a, 0);
  for (const r of q.all(`SELECT mode, direction, party_type, SUM(amount) a FROM payments WHERE date BETWEEN ? AND ? GROUP BY mode, direction, party_type`, from, to)) {
    const label = r.party_type === 'customer' ? (r.direction === 'in' ? 'Customer receipts' : 'Customer refunds') : (r.direction === 'out' ? 'Supplier payments' : 'Supplier refunds');
    push(label, r.mode, r.direction === 'in' ? r.a : 0, r.direction === 'out' ? r.a : 0);
  }
  for (const r of q.all(`SELECT r.refund_mode mode, SUM(r.refunded) a FROM sales_returns r WHERE r.date BETWEEN ? AND ? AND r.refunded > 0 GROUP BY r.refund_mode`, from, to)) {
    push('Sales return refunds', r.mode, 0, r.a);
  }
  for (const r of q.all('SELECT mode, SUM(amount) a FROM expenses WHERE date BETWEEN ? AND ? GROUP BY mode', from, to)) push('Expenses', r.mode, 0, r.a);
  const byMode = {};
  for (const r of rows) {
    const m = byMode[r.mode] || (byMode[r.mode] = { mode: r.mode, in: 0, out: 0 });
    m.in += r.in; m.out += r.out;
  }
  const modes = Object.values(byMode).map((m) => roundAll({ ...m, net: m.in - m.out }));
  const sales = q.get(`SELECT COUNT(*) bills, COALESCE(SUM(total),0) total, COALESCE(SUM(total - paid - returned),0) credit
    FROM sales WHERE date BETWEEN ? AND ? AND cancelled = 0`, from, to);
  const invoices = q.all(`SELECT s.id, s.invoice_no, s.date, s.customer_name, s.total, s.paid, s.status, u.name user_name
    FROM sales s LEFT JOIN users u ON u.id = s.user_id WHERE s.date BETWEEN ? AND ? ORDER BY s.id`, from, to);
  const expenseList = q.all('SELECT * FROM expenses WHERE date BETWEEN ? AND ? ORDER BY id', from, to);
  return { from, to, rows, modes, sales: roundAll(sales), invoices, expenses: expenseList };
});

/* ---------- GRN / India purchase costing ---------- */
route('GET', '/api/reports/grn', STAFF, ({ query }) => {
  const { from, to } = range(query);
  const rows = q.all(`SELECT g.id, g.grn_no, g.date, sp.name supplier, g.cargo_name, g.bale_no, g.lr_no, g.total_pcs, g.india_rate, g.india_value,
      g.goods_value, g.cargo_total, g.other_total, g.final_total,
      CASE WHEN g.goods_value > 0 THEN (g.final_total - g.goods_value) * 100.0 / g.goods_value ELSE 0 END overhead_pct
    FROM grn g JOIN suppliers sp ON sp.id = g.supplier_id WHERE g.cancelled = 0 AND g.date BETWEEN ? AND ? ORDER BY g.date DESC, g.id DESC`, from, to).map(roundAll);
  const bySupplier = q.all(`SELECT sp.name supplier, COUNT(*) grns, SUM(g.total_pcs) pcs, SUM(g.india_value) india_value, SUM(g.goods_value) goods_value,
      SUM(g.cargo_total + g.other_total) charges, SUM(g.final_total) final_total
    FROM grn g JOIN suppliers sp ON sp.id = g.supplier_id WHERE g.cancelled = 0 AND g.date BETWEEN ? AND ? GROUP BY g.supplier_id ORDER BY final_total DESC`, from, to).map(roundAll);
  const byCargo = q.all(`SELECT COALESCE(NULLIF(g.cargo_name,''),'-') cargo, COUNT(*) grns, SUM(g.total_pcs) pcs, SUM(g.cargo_total) cargo_total,
      CASE WHEN SUM(g.total_pcs) > 0 THEN SUM(g.cargo_total) / SUM(g.total_pcs) ELSE 0 END per_pc
    FROM grn g WHERE g.cancelled = 0 AND g.date BETWEEN ? AND ? GROUP BY 1 ORDER BY cargo_total DESC`, from, to).map(roundAll);
  return { from, to, rows, by_supplier: bySupplier, by_cargo: byCargo };
});
