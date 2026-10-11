const { q, tx, getSettings, nextNumber, audit } = require('../db');
const { route, fail, num, str, dateOr } = require('../app');
const { moveStock, postLedger, removeLedger, partyBalance } = require('../inventory');
const { computeBill, r2, r3 } = require('../../public/js/tax');

const STAFF = ['admin', 'manager'];

function saleStatus(total, paid, returned) {
  const net = r2(total - returned);
  if (net <= 0.005) return 'returned';
  if (paid >= net - 0.005) return 'paid';
  return paid > 0 ? 'partial' : 'unpaid';
}

/* ---------- Create sale (POS bill / tax invoice) ---------- */
route('POST', '/api/sales', null, ({ body, user }) => {
  const s = getSettings();
  const items = Array.isArray(body.items) ? body.items.filter((i) => num(i.qty) > 0) : [];
  if (!items.length) fail(400, 'Cart is empty');

  return tx(() => {
    const date = dateOr(body.date);
    let customer = null;
    if (body.customer_id) {
      customer = q.get('SELECT * FROM customers WHERE id = ?', Number(body.customer_id));
      if (!customer) fail(400, 'Customer not found');
    }
    const taxEnabled = s.tax_enabled === '1';
    const inclusive = body.inclusive == null ? s.prices_include_tax === '1' : !!body.inclusive;
    const priceType = body.price_type === 'retail' ? 'retail' : 'wholesale';

    const lines = items.map((it) => {
      const p = q.get('SELECT * FROM products WHERE id = ?', Number(it.product_id));
      if (!p) fail(400, `Product #${it.product_id} not found`);
      const listRate = priceType === 'wholesale' && p.wholesale_price > 0 ? p.wholesale_price : p.sale_price;
      return { p, qty: r3(num(it.qty)), rate: num(it.rate, listRate), discount_pct: num(it.discount_pct), tax_rate: p.tax_rate };
    });
    const calc = computeBill(lines, { tax_enabled: taxEnabled, inclusive, bill_discount: num(body.bill_discount), round: s.round_off === '1' });
    const T = calc.totals;

    /* Payments: cap at bill total, extra cash = change returned */
    let payments = (Array.isArray(body.payments) ? body.payments : [])
      .map((p) => ({ mode: str(p.mode) || 'cash', amount: r2(num(p.amount)), reference: str(p.reference) }))
      .filter((p) => p.amount > 0 && p.mode !== 'credit');
    let paidSum = r2(payments.reduce((a, p) => a + p.amount, 0));
    if (paidSum > T.grand_total) {
      let excess = r2(paidSum - T.grand_total);
      for (let i = payments.length - 1; i >= 0 && excess > 0; i--) {
        if (payments[i].mode !== 'cash') continue;
        const cut = Math.min(excess, payments[i].amount);
        payments[i].amount = r2(payments[i].amount - cut);
        excess = r2(excess - cut);
      }
      if (excess > 0.005) fail(400, 'Non-cash payments exceed the bill amount');
      payments = payments.filter((p) => p.amount > 0);
      paidSum = T.grand_total;
    }
    const due = r2(T.grand_total - paidSum);
    if (due > 0.005) {
      if (!customer) fail(400, `Balance Rs. ${due} is unpaid. Select a customer to sell on credit.`);
      if (customer.credit_limit > 0) {
        const bal = partyBalance('customer', customer.id);
        if (bal + due > customer.credit_limit && user.role === 'cashier') {
          fail(400, `Credit limit exceeded for ${customer.name}. Limit Rs. ${customer.credit_limit}, current due Rs. ${bal}`);
        }
      }
    }

    const invoiceNo = nextNumber(s.invoice_prefix || 'INV', date);
    const r = q.run(`INSERT INTO sales(invoice_no, date, customer_id, customer_name, customer_phone, customer_vat_no, customer_address,
        price_type, inclusive, tax_enabled, gross, discount, bill_discount, taxable, tax, round_off,
        total, paid, status, notes, user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    invoiceNo, date, customer ? customer.id : null,
    str(body.customer_name) || (customer ? customer.name : 'Cash Customer'),
    str(body.customer_phone) || (customer ? customer.phone : null),
    customer ? customer.vat_no : null,
    customer ? [customer.address, customer.city].filter(Boolean).join(', ') : null,
    priceType, inclusive ? 1 : 0, taxEnabled ? 1 : 0,
    T.gross, r2(T.line_discount + T.bill_discount), T.bill_discount, T.taxable, T.tax, T.round_off,
    T.grand_total, paidSum, saleStatus(T.grand_total, paidSum, 0), str(body.notes), user.id);
    const saleId = Number(r.lastInsertRowid);

    lines.forEach((l, i) => {
      const c = calc.lines[i];
      q.run(`INSERT INTO sale_items(sale_id, product_id, name, unit, qty, rate, discount_pct, discount, taxable, tax_rate, tax, total, cost_price)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      saleId, l.p.id, l.p.name, l.p.unit, c.qty, c.rate, l.discount_pct, c.discount, c.taxable, c.tax_rate, c.tax, c.total, l.p.cost_price);
      moveStock({ productId: l.p.id, qty: -c.qty, type: 'sale', date, refId: saleId, refNo: invoiceNo, userId: user.id });
    });
    for (const p of payments) {
      q.run('INSERT INTO sale_payments(sale_id, mode, amount, reference) VALUES(?,?,?,?)', saleId, p.mode, p.amount, p.reference);
    }
    if (customer) {
      postLedger({ date, partyType: 'customer', partyId: customer.id, refType: 'sale', refId: saleId, refNo: invoiceNo, debit: T.grand_total, narration: 'Sales invoice' });
      if (paidSum > 0) {
        postLedger({ date, partyType: 'customer', partyId: customer.id, refType: 'sale_payment', refId: saleId, refNo: invoiceNo, credit: paidSum,
          narration: 'Paid at billing (' + payments.map((p) => p.mode.toUpperCase()).join('+') + ')' });
      }
    }
    audit(user.id, 'create', 'sale', saleId, { invoice_no: invoiceNo, total: T.grand_total });
    return { id: saleId, invoice_no: invoiceNo, total: T.grand_total, paid: paidSum, change: r2(Math.max(0, num(body.tendered) - T.grand_total)) };
  });
});

/* ---------- List / view ---------- */
route('GET', '/api/sales', null, ({ query, user }) => {
  const where = ['1=1'];
  const args = [];
  if (query.from) { where.push('s.date >= ?'); args.push(query.from); }
  if (query.to) { where.push('s.date <= ?'); args.push(query.to); }
  if (query.customer_id) { where.push('s.customer_id = ?'); args.push(Number(query.customer_id)); }
  if (query.status) { where.push('s.status = ?'); args.push(query.status); }
  if (query.q) { where.push('(s.invoice_no LIKE ? OR s.customer_name LIKE ? OR s.customer_phone LIKE ?)'); args.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`); }
  if (user.role === 'cashier' && !query.q) { where.push("s.date >= date('now','localtime','-7 days')"); }
  return q.all(`SELECT s.*, u.name AS user_name,
      (SELECT GROUP_CONCAT(mode, '+') FROM (SELECT DISTINCT mode FROM sale_payments sp WHERE sp.sale_id = s.id)) AS modes
    FROM sales s LEFT JOIN users u ON u.id = s.user_id WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT 3000`, ...args);
});

function loadSale(id) {
  const sale = q.get('SELECT s.*, u.name AS user_name FROM sales s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?', id);
  if (!sale) fail(404, 'Invoice not found');
  sale.items = q.all('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id', id);
  sale.payments = q.all('SELECT * FROM sale_payments WHERE sale_id = ? ORDER BY id', id);
  sale.returns = q.all('SELECT * FROM sales_returns WHERE sale_id = ? ORDER BY id', id);
  sale.receipts = q.all(`SELECT p.id, p.voucher_no, p.date, p.mode, p.reference, a.amount FROM payment_allocations a
    JOIN payments p ON p.id = a.payment_id WHERE a.sale_id = ? ORDER BY p.id`, id);
  if (sale.customer_id) sale.customer_balance = partyBalance('customer', sale.customer_id);
  return sale;
}
route('GET', '/api/sales/:id', null, ({ params }) => loadSale(Number(params.id)));

/* ---------- Collect balance against an invoice ---------- */
route('POST', '/api/sales/:id/payment', null, ({ params, body, user }) => {
  const sale = loadSale(Number(params.id));
  if (sale.cancelled) fail(400, 'Invoice is cancelled');
  const amount = r2(num(body.amount));
  const due = r2(sale.total - sale.returned - sale.paid);
  if (amount <= 0) fail(400, 'Enter amount');
  if (amount > due + 0.005) fail(400, `Amount exceeds balance due (Rs. ${due})`);
  return tx(() => {
    const date = dateOr(body.date);
    const mode = str(body.mode) || 'cash';
    const paid = r2(sale.paid + amount);
    q.run('UPDATE sales SET paid = ?, status = ? WHERE id = ?', paid, saleStatus(sale.total, paid, sale.returned), sale.id);
    if (sale.customer_id) {
      const vno = nextNumber('RCT', date);
      const r = q.run(`INSERT INTO payments(voucher_no, date, direction, party_type, party_id, amount, mode, reference, notes, user_id)
        VALUES(?,?,'in','customer',?,?,?,?,?,?)`, vno, date, sale.customer_id, amount, mode, str(body.reference), `Against ${sale.invoice_no}`, user.id);
      const pid = Number(r.lastInsertRowid);
      q.run('INSERT INTO payment_allocations(payment_id, sale_id, amount) VALUES(?,?,?)', pid, sale.id, amount);
      postLedger({ date, partyType: 'customer', partyId: sale.customer_id, refType: 'payment', refId: pid, refNo: vno, credit: amount, narration: `Receipt against ${sale.invoice_no}` });
    } else {
      /* walk-in balance collection: keep as an invoice payment line */
      q.run('INSERT INTO sale_payments(sale_id, mode, amount, reference) VALUES(?,?,?,?)', sale.id, mode, amount, str(body.reference));
    }
    audit(user.id, 'payment', 'sale', sale.id, { amount });
    return loadSale(sale.id);
  });
});

/* ---------- Cancel invoice (reverses stock & ledger) ---------- */
route('POST', '/api/sales/:id/cancel', STAFF, ({ params, body, user }) => {
  const sale = loadSale(Number(params.id));
  if (sale.cancelled) fail(400, 'Already cancelled');
  if (sale.returns.length) fail(400, 'Invoice has returns; cannot cancel. Use sales return instead.');
  const receipts = q.val('SELECT COUNT(*) FROM payment_allocations WHERE sale_id = ?', sale.id);
  if (receipts) fail(400, 'Receipts were recorded against this invoice later. Delete those receipts first.');
  return tx(() => {
    for (const it of sale.items) {
      moveStock({ productId: it.product_id, qty: it.qty, type: 'cancel', date: sale.date, refId: sale.id, refNo: sale.invoice_no, notes: 'Invoice cancelled', userId: user.id });
    }
    removeLedger('sale', sale.id);
    removeLedger('sale_payment', sale.id);
    q.run(`UPDATE sales SET cancelled = 1, status = 'cancelled', notes = TRIM(COALESCE(notes,'') || ' [Cancelled: ' || ? || ']') WHERE id = ?`,
      str(body.reason) || 'no reason', sale.id);
    audit(user.id, 'cancel', 'sale', sale.id, { reason: body.reason });
    return loadSale(sale.id);
  });
});

/* ---------- Sales return / credit note ---------- */
route('POST', '/api/sales/:id/return', null, ({ params, body, user }) => {
  const sale = loadSale(Number(params.id));
  if (sale.cancelled) fail(400, 'Invoice is cancelled');
  const reqItems = (Array.isArray(body.items) ? body.items : []).filter((i) => num(i.qty) > 0);
  if (!reqItems.length) fail(400, 'Select items and quantities to return');
  const refundMode = str(body.refund_mode) || 'cash';
  if (refundMode === 'credit' && !sale.customer_id) fail(400, 'Credit note needs a customer account. Choose a refund mode instead.');

  return tx(() => {
    const date = dateOr(body.date);
    const returnNo = nextNumber('CN', date);
    const r = q.run('INSERT INTO sales_returns(return_no, sale_id, date, refund_mode, reason, user_id) VALUES(?,?,?,?,?,?)',
      returnNo, sale.id, date, refundMode, str(body.reason), user.id);
    const retId = Number(r.lastInsertRowid);
    const tot = { taxable: 0, tax: 0, total: 0 };
    for (const ri of reqItems) {
      const it = sale.items.find((x) => x.id === Number(ri.sale_item_id));
      if (!it) fail(400, 'Invalid invoice item');
      const qty = r3(num(ri.qty));
      if (qty > r3(it.qty - it.returned_qty) + 0.0005) fail(400, `Return qty for "${it.name}" exceeds sold qty (${r3(it.qty - it.returned_qty)} left)`);
      const f = qty / it.qty;
      const line = { taxable: r2(it.taxable * f), tax: r2(it.tax * f) };
      line.total = r2(line.taxable + line.tax);
      q.run(`INSERT INTO sales_return_items(return_id, sale_item_id, product_id, name, qty, tax_rate, taxable, tax, total, cost_price)
        VALUES(?,?,?,?,?,?,?,?,?,?)`, retId, it.id, it.product_id, it.name, qty, it.tax_rate, line.taxable, line.tax, line.total, it.cost_price);
      q.run('UPDATE sale_items SET returned_qty = returned_qty + ? WHERE id = ?', qty, it.id);
      if (body.restock !== false) {
        moveStock({ productId: it.product_id, qty, type: 'return', date, refId: retId, refNo: returnNo, unitCost: it.cost_price, notes: `Return of ${sale.invoice_no}`, userId: user.id });
      }
      for (const k of Object.keys(tot)) tot[k] += line[k];
    }
    for (const k of Object.keys(tot)) tot[k] = r2(tot[k]);
    const total = getSettings().round_off === '1' ? Math.round(tot.total) : tot.total;
    q.run('UPDATE sales_returns SET taxable = ?, tax = ?, total = ? WHERE id = ?', tot.taxable, tot.tax, total, retId);

    const returned = r2(sale.returned + total);
    let paid = sale.paid;
    /* Refunding money reduces what the customer has paid on this invoice */
    if (refundMode !== 'credit') paid = r2(Math.max(0, paid - Math.max(0, total - Math.max(0, r2(sale.total - sale.returned - sale.paid)))));
    q.run('UPDATE sales SET returned = ?, paid = ?, status = ? WHERE id = ?', returned, paid, saleStatus(sale.total, paid, returned), sale.id);
    q.run('UPDATE sales_returns SET refunded = ? WHERE id = ?', r2(sale.paid - paid), retId);

    if (sale.customer_id) {
      postLedger({ date, partyType: 'customer', partyId: sale.customer_id, refType: 'return', refId: retId, refNo: returnNo, credit: total, narration: `Credit note for ${sale.invoice_no}` });
      const refunded = r2(sale.paid - paid);
      if (refundMode !== 'credit' && refunded > 0) {
        postLedger({ date, partyType: 'customer', partyId: sale.customer_id, refType: 'refund', refId: retId, refNo: returnNo, debit: refunded, narration: `Refund paid (${refundMode})` });
      }
    }
    audit(user.id, 'create', 'sales_return', retId, { sale: sale.invoice_no, total });
    return { id: retId, return_no: returnNo, total, refunded: r2(sale.paid - paid) };
  });
});

route('GET', '/api/returns', null, ({ query }) => {
  const where = ['1=1'];
  const args = [];
  if (query.from) { where.push('r.date >= ?'); args.push(query.from); }
  if (query.to) { where.push('r.date <= ?'); args.push(query.to); }
  return q.all(`SELECT r.*, s.invoice_no, s.customer_name FROM sales_returns r JOIN sales s ON s.id = r.sale_id
    WHERE ${where.join(' AND ')} ORDER BY r.id DESC LIMIT 2000`, ...args);
});

route('GET', '/api/returns/:id', null, ({ params }) => {
  const r = q.get(`SELECT r.*, s.invoice_no, s.date AS invoice_date, s.customer_name, s.customer_phone, s.customer_vat_no,
      s.customer_address, s.tax_enabled FROM sales_returns r JOIN sales s ON s.id = r.sale_id WHERE r.id = ?`, Number(params.id));
  if (!r) fail(404, 'Credit note not found');
  r.items = q.all('SELECT * FROM sales_return_items WHERE return_id = ?', r.id);
  return r;
});
