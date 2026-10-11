const { q, tx, nextNumber, audit } = require('../db');
const { route, fail, num, str, required, dateOr } = require('../app');
const { postLedger, removeLedger } = require('../inventory');
const { r2 } = require('../../public/js/tax');

const STAFF = ['admin', 'manager'];

/* ---------- Payments: receipts from customers / payments to suppliers ---------- */
route('GET', '/api/payments', STAFF, ({ query }) => {
  const where = ['1=1'];
  const args = [];
  if (query.from) { where.push('p.date >= ?'); args.push(query.from); }
  if (query.to) { where.push('p.date <= ?'); args.push(query.to); }
  if (query.party_type) { where.push('p.party_type = ?'); args.push(query.party_type); }
  if (query.direction) { where.push('p.direction = ?'); args.push(query.direction); }
  return q.all(`SELECT p.*, CASE p.party_type WHEN 'customer' THEN c.name ELSE s.name END AS party_name, u.name AS user_name
    FROM payments p LEFT JOIN customers c ON p.party_type = 'customer' AND c.id = p.party_id
    LEFT JOIN suppliers s ON p.party_type = 'supplier' AND s.id = p.party_id
    LEFT JOIN users u ON u.id = p.user_id WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT 3000`, ...args);
});

route('GET', '/api/payments/:id', STAFF, ({ params }) => {
  const p = q.get(`SELECT p.*, CASE p.party_type WHEN 'customer' THEN c.name ELSE s.name END AS party_name,
      CASE p.party_type WHEN 'customer' THEN c.address ELSE s.address END AS party_address
    FROM payments p LEFT JOIN customers c ON p.party_type = 'customer' AND c.id = p.party_id
    LEFT JOIN suppliers s ON p.party_type = 'supplier' AND s.id = p.party_id WHERE p.id = ?`, Number(params.id));
  if (!p) fail(404, 'Voucher not found');
  p.allocations = q.all(`SELECT a.*, s.invoice_no, s.date AS invoice_date FROM payment_allocations a JOIN sales s ON s.id = a.sale_id WHERE a.payment_id = ?`, p.id);
  return p;
});

function refreshSaleStatus(saleId) {
  const s = q.get('SELECT total, paid, returned FROM sales WHERE id = ?', saleId);
  const net = r2(s.total - s.returned);
  const status = net <= 0.005 ? 'returned' : s.paid >= net - 0.005 ? 'paid' : s.paid > 0 ? 'partial' : 'unpaid';
  q.run('UPDATE sales SET status = ? WHERE id = ?', status, saleId);
}

route('POST', '/api/payments', STAFF, ({ body, user }) => {
  required(body, 'party_type', 'party_id', 'amount');
  const partyType = body.party_type;
  if (!['customer', 'supplier'].includes(partyType)) fail(400, 'Invalid party type');
  const direction = body.direction || (partyType === 'customer' ? 'in' : 'out');
  const amount = r2(num(body.amount));
  if (amount <= 0) fail(400, 'Amount must be greater than zero');
  const party = q.get(`SELECT * FROM ${partyType}s WHERE id = ?`, Number(body.party_id));
  if (!party) fail(400, 'Party not found');

  return tx(() => {
    const date = dateOr(body.date);
    const vno = nextNumber(direction === 'in' ? 'RCT' : 'PAY', date);
    const r = q.run(`INSERT INTO payments(voucher_no, date, direction, party_type, party_id, amount, mode, reference, fc_amount, fc_currency, fc_rate, notes, user_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, vno, date, direction, partyType, party.id, amount, str(body.mode) || 'cash', str(body.reference),
    body.fc_amount ? num(body.fc_amount) : null, str(body.fc_currency), body.fc_rate ? num(body.fc_rate) : null, str(body.notes), user.id);
    const pid = Number(r.lastInsertRowid);

    /* Customer receipts settle open invoices, oldest first (or the invoices chosen) */
    if (partyType === 'customer' && direction === 'in') {
      let left = amount;
      const chosen = Array.isArray(body.sale_ids) && body.sale_ids.length ? body.sale_ids.map(Number) : null;
      const open = q.all(`SELECT id, total, paid, returned FROM sales WHERE customer_id = ? AND cancelled = 0
        AND paid < total - returned - 0.005 ORDER BY date, id`, party.id).filter((s) => !chosen || chosen.includes(s.id));
      for (const s of open) {
        if (left <= 0.005) break;
        const due = r2(s.total - s.returned - s.paid);
        const pay = Math.min(due, left);
        q.run('INSERT INTO payment_allocations(payment_id, sale_id, amount) VALUES(?,?,?)', pid, s.id, r2(pay));
        q.run('UPDATE sales SET paid = paid + ? WHERE id = ?', r2(pay), s.id);
        refreshSaleStatus(s.id);
        left = r2(left - pay);
      }
    }
    const isDebit = (partyType === 'customer' && direction === 'out') || (partyType === 'supplier' && direction === 'out');
    postLedger({ date, partyType, partyId: party.id, refType: 'payment', refId: pid, refNo: vno,
      debit: isDebit ? amount : 0, credit: isDebit ? 0 : amount,
      narration: (direction === 'in' ? 'Received' : 'Paid') + ` (${(body.mode || 'cash').toUpperCase()})` + (body.reference ? ` Ref: ${body.reference}` : '') +
        (body.fc_amount ? ` [${body.fc_currency} ${body.fc_amount} @ ${body.fc_rate}]` : '') });
    audit(user.id, 'create', 'payment', pid, { amount, partyType, direction });
    return { id: pid, voucher_no: vno };
  });
});

route('DELETE', '/api/payments/:id', ['admin'], ({ params, user }) => tx(() => {
  const p = q.get('SELECT * FROM payments WHERE id = ?', Number(params.id));
  if (!p) fail(404, 'Voucher not found');
  for (const a of q.all('SELECT * FROM payment_allocations WHERE payment_id = ?', p.id)) {
    q.run('UPDATE sales SET paid = MAX(0, paid - ?) WHERE id = ?', a.amount, a.sale_id);
    refreshSaleStatus(a.sale_id);
  }
  q.run('DELETE FROM payment_allocations WHERE payment_id = ?', p.id);
  removeLedger('payment', p.id);
  q.run('DELETE FROM payments WHERE id = ?', p.id);
  audit(user.id, 'delete', 'payment', p.id, { voucher_no: p.voucher_no, amount: p.amount });
}));

/* ---------- Expenses ---------- */
route('GET', '/api/expenses', STAFF, ({ query }) => {
  const where = ['1=1'];
  const args = [];
  if (query.from) { where.push('e.date >= ?'); args.push(query.from); }
  if (query.to) { where.push('e.date <= ?'); args.push(query.to); }
  if (query.category) { where.push('e.category = ?'); args.push(query.category); }
  return q.all(`SELECT e.*, u.name AS user_name FROM expenses e LEFT JOIN users u ON u.id = e.user_id
    WHERE ${where.join(' AND ')} ORDER BY e.date DESC, e.id DESC LIMIT 3000`, ...args);
});
route('POST', '/api/expenses', STAFF, ({ body, user }) => {
  required(body, 'category', 'amount');
  if (num(body.amount) <= 0) fail(400, 'Amount must be greater than zero');
  const r = q.run('INSERT INTO expenses(date, category, amount, mode, paid_to, notes, user_id) VALUES(?,?,?,?,?,?,?)',
    dateOr(body.date), str(body.category), r2(num(body.amount)), str(body.mode) || 'cash', str(body.paid_to), str(body.notes), user.id);
  audit(user.id, 'create', 'expense', r.lastInsertRowid);
  return { id: Number(r.lastInsertRowid) };
});
route('PUT', '/api/expenses/:id', STAFF, ({ params, body, user }) => {
  q.run('UPDATE expenses SET date = ?, category = ?, amount = ?, mode = ?, paid_to = ?, notes = ? WHERE id = ?',
    dateOr(body.date), str(body.category), r2(num(body.amount)), str(body.mode) || 'cash', str(body.paid_to), str(body.notes), Number(params.id));
  audit(user.id, 'update', 'expense', Number(params.id));
});
route('DELETE', '/api/expenses/:id', STAFF, ({ params, user }) => {
  q.run('DELETE FROM expenses WHERE id = ?', Number(params.id));
  audit(user.id, 'delete', 'expense', Number(params.id));
});
