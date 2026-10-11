/* Local purchase bills (goods bought in Sri Lanka, in LKR). Goods from India come in through GRN. */
const { q, tx, getSettings, nextNumber, audit } = require('../db');
const { route, fail, num, str, required, dateOr, today } = require('../app');
const { moveStock, postLedger, removeLedger } = require('../inventory');
const { computeBill, r2 } = require('../../public/js/tax');

const STAFF = ['admin', 'manager'];

function loadPurchase(id) {
  const p = q.get(`SELECT p.*, s.name AS supplier_name, s.vat_no AS supplier_vat_no
    FROM purchases p JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?`, id);
  if (!p) fail(404, 'Purchase not found');
  p.items = q.all(`SELECT i.*, pr.name, pr.sku, pr.unit FROM purchase_items i JOIN products pr ON pr.id = i.product_id
    WHERE i.purchase_id = ? ORDER BY i.id`, id);
  return p;
}

route('GET', '/api/purchases', STAFF, ({ query }) => {
  const where = ['1=1'];
  const args = [];
  if (query.from) { where.push('p.date >= ?'); args.push(query.from); }
  if (query.to) { where.push('p.date <= ?'); args.push(query.to); }
  if (query.supplier_id) { where.push('p.supplier_id = ?'); args.push(Number(query.supplier_id)); }
  return q.all(`SELECT p.*, s.name AS supplier_name FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
    WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT 2000`, ...args);
});

route('GET', '/api/purchases/:id', STAFF, ({ params }) => loadPurchase(Number(params.id)));

route('POST', '/api/purchases', STAFF, ({ body, user }) => {
  required(body, 'supplier_id');
  const items = (Array.isArray(body.items) ? body.items : []).filter((i) => num(i.qty) > 0);
  if (!items.length) fail(400, 'Add at least one item');
  const s = getSettings();
  const supplier = q.get('SELECT * FROM suppliers WHERE id = ?', Number(body.supplier_id));
  if (!supplier) fail(400, 'Supplier not found');

  return tx(() => {
    const date = dateOr(body.date);
    const taxOn = s.tax_enabled === '1';
    const calc = computeBill(items.map((i) => ({ qty: i.qty, rate: i.rate, discount_pct: i.discount_pct, tax_rate: i.tax_rate })),
      { tax_enabled: taxOn, inclusive: false });
    const other = r2(num(body.other_charges));
    const T = calc.totals;
    const grand = r2(T.total + other);
    const refNo = nextNumber('PUR', date);
    const r = q.run(`INSERT INTO purchases(ref_no, bill_no, supplier_id, date, taxable, tax, other_charges, round_off, total, notes, user_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`, refNo, str(body.bill_no), supplier.id, date, T.taxable, T.tax, other, 0, grand, str(body.notes), user.id);
    const pid = Number(r.lastInsertRowid);
    items.forEach((it, i) => {
      const c = calc.lines[i];
      const share = T.taxable > 0 ? other * c.taxable / T.taxable : 0;
      const unitCost = c.qty ? r2((c.taxable + share) / c.qty) : 0;
      q.run(`INSERT INTO purchase_items(purchase_id, product_id, qty, rate, discount_pct, taxable, tax_rate, tax, total, unit_cost)
        VALUES(?,?,?,?,?,?,?,?,?,?)`, pid, Number(it.product_id), c.qty, c.rate, num(it.discount_pct), c.taxable, c.tax_rate, c.tax, c.total, unitCost);
      moveStock({ productId: Number(it.product_id), qty: c.qty, type: 'purchase', date, refId: pid, refNo, unitCost, updateCost: true, userId: user.id });
      if (it.update_sale_price && num(it.sale_price) > 0) q.run('UPDATE products SET wholesale_price = ? WHERE id = ?', num(it.sale_price), Number(it.product_id));
    });
    postLedger({ date, partyType: 'supplier', partyId: supplier.id, refType: 'purchase', refId: pid, refNo, credit: grand, narration: `Purchase bill ${body.bill_no || ''}`.trim() });
    audit(user.id, 'create', 'purchase', pid, { total: grand });
    return { id: pid, ref_no: refNo, total: grand };
  });
});

route('DELETE', '/api/purchases/:id', ['admin'], ({ params, user }) => {
  const p = loadPurchase(Number(params.id));
  return tx(() => {
    for (const it of p.items) {
      moveStock({ productId: it.product_id, qty: -it.qty, type: 'purchase_delete', date: today(), refId: p.id, refNo: p.ref_no, notes: 'Purchase deleted', userId: user.id });
    }
    removeLedger('purchase', p.id);
    q.run('DELETE FROM purchases WHERE id = ?', p.id);
    audit(user.id, 'delete', 'purchase', p.id, { ref_no: p.ref_no });
    return { deleted: true };
  });
});
