const { q, tx, audit, getSettings } = require('../db');
const { route, fail, num, str, required, today, dateOr } = require('../app');
const { moveStock, partyBalance } = require('../inventory');

const STAFF = ['admin', 'manager'];

/* ---------- Categories ---------- */
route('GET', '/api/categories', null, () =>
  q.all(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
    FROM categories c ORDER BY name`));
route('POST', '/api/categories', STAFF, ({ body }) => {
  required(body, 'name');
  return { id: q.run('INSERT INTO categories(name) VALUES(?)', body.name.trim()).lastInsertRowid };
});
route('PUT', '/api/categories/:id', STAFF, ({ params, body }) => {
  required(body, 'name');
  q.run('UPDATE categories SET name = ? WHERE id = ?', body.name.trim(), Number(params.id));
});
route('DELETE', '/api/categories/:id', STAFF, ({ params }) => {
  q.run('DELETE FROM categories WHERE id = ?', Number(params.id));
});

/* ---------- Products ---------- */
const PRODUCT_FIELDS = ['sku', 'barcode', 'name', 'category_id', 'unit', 'tax_rate', 'cost_price',
  'sale_price', 'wholesale_price', 'mrp', 'reorder_level', 'color', 'design', 'size', 'composition', 'origin', 'active'];

function productValues(b, existing = {}) {
  const v = { ...existing, ...b };
  return [
    str(v.sku), str(v.barcode) || str(v.sku), str(v.name), v.category_id ? Number(v.category_id) : null,
    str(v.unit) || 'PCS', num(v.tax_rate, num(getSettings().default_tax_rate)), num(v.cost_price),
    num(v.sale_price), num(v.wholesale_price), num(v.mrp), num(v.reorder_level), str(v.color), str(v.design),
    str(v.size), str(v.composition), str(v.origin), v.active === false || v.active === 0 ? 0 : 1
  ];
}

route('GET', '/api/products', null, ({ query }) => {
  const where = [];
  const args = [];
  if (query.q) {
    where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode = ? OR p.size LIKE ? OR p.color LIKE ? OR p.design LIKE ?)');
    const like = `%${query.q}%`;
    args.push(like, like, query.q, like, like, like);
  }
  if (query.category_id) { where.push('p.category_id = ?'); args.push(Number(query.category_id)); }
  if (query.active !== 'all') where.push('p.active = 1');
  if (query.low_stock) where.push('p.stock <= p.reorder_level');
  const limit = Math.min(Number(query.limit) || 1000, 5000);
  return q.all(`SELECT p.*, c.name AS category FROM products p LEFT JOIN categories c ON c.id = p.category_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.name LIMIT ${limit}`, ...args);
});

route('GET', '/api/products/lookup/:code', null, ({ params }) => {
  const p = q.get(`SELECT p.*, c.name AS category FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE (p.barcode = ? OR p.sku = ?) AND p.active = 1`, params.code, params.code);
  if (!p) fail(404, `No product with barcode/SKU "${params.code}"`);
  return p;
});

route('GET', '/api/products/next-sku', STAFF, () => {
  const n = (q.val("SELECT MAX(id) FROM products") || 0) + 1;
  let sku = `TX${String(n).padStart(5, '0')}`;
  while (q.get('SELECT 1 FROM products WHERE sku = ?', sku)) sku = `TX${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`;
  return { sku };
});

route('GET', '/api/products/:id', null, ({ params }) => {
  const p = q.get(`SELECT p.*, c.name AS category FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`, Number(params.id));
  if (!p) fail(404, 'Product not found');
  p.moves = q.all(`SELECT m.*, u.name AS user_name FROM stock_moves m LEFT JOIN users u ON u.id = m.user_id
    WHERE m.product_id = ? ORDER BY m.id DESC LIMIT 200`, p.id);
  return p;
});

route('POST', '/api/products', STAFF, ({ body, user }) => {
  required(body, 'sku', 'name');
  return tx(() => {
    const r = q.run(`INSERT INTO products(${PRODUCT_FIELDS.join(',')}) VALUES(${PRODUCT_FIELDS.map(() => '?').join(',')})`, ...productValues(body));
    const id = Number(r.lastInsertRowid);
    const opening = num(body.opening_stock);
    if (opening) {
      moveStock({ productId: id, qty: opening, type: 'opening', date: today(), unitCost: num(body.cost_price), notes: 'Opening stock', userId: user.id });
    }
    audit(user.id, 'create', 'product', id);
    return { id };
  });
});

route('PUT', '/api/products/:id', STAFF, ({ params, body, user }) => {
  const id = Number(params.id);
  const existing = q.get('SELECT * FROM products WHERE id = ?', id);
  if (!existing) fail(404, 'Product not found');
  q.run(`UPDATE products SET ${PRODUCT_FIELDS.map((f) => f + ' = ?').join(', ')} WHERE id = ?`, ...productValues(body, existing), id);
  audit(user.id, 'update', 'product', id);
});

route('DELETE', '/api/products/:id', STAFF, ({ params, user }) => {
  const id = Number(params.id);
  const used = q.val(`SELECT (SELECT COUNT(*) FROM sale_items WHERE product_id = ?) + (SELECT COUNT(*) FROM purchase_items WHERE product_id = ?)
    + (SELECT COUNT(*) FROM grn_items WHERE product_id = ?)`, id, id, id);
  if (used) {
    q.run('UPDATE products SET active = 0 WHERE id = ?', id);
    audit(user.id, 'deactivate', 'product', id);
    return { deactivated: true };
  }
  tx(() => {
    q.run('DELETE FROM stock_moves WHERE product_id = ?', id);
    q.run('DELETE FROM products WHERE id = ?', id);
  });
  audit(user.id, 'delete', 'product', id);
  return { deleted: true };
});

/* Bulk import: rows of product objects (from CSV on the client). Upserts by SKU. */
route('POST', '/api/products/import', STAFF, ({ body, user }) => {
  const rows = Array.isArray(body.rows) ? body.rows : [];
  let created = 0, updated = 0;
  const errors = [];
  tx(() => {
    rows.forEach((row, i) => {
      try {
        if (!row.sku || !row.name) throw new Error('sku and name are required');
        if (row.category && !row.category_id) {
          let c = q.get('SELECT id FROM categories WHERE name = ?', String(row.category).trim());
          if (!c) c = { id: q.run('INSERT INTO categories(name) VALUES(?)', String(row.category).trim()).lastInsertRowid };
          row.category_id = c.id;
        }
        const ex = q.get('SELECT * FROM products WHERE sku = ?', String(row.sku).trim());
        if (ex) {
          q.run(`UPDATE products SET ${PRODUCT_FIELDS.map((f) => f + ' = ?').join(', ')} WHERE id = ?`, ...productValues(row, ex), ex.id);
          updated++;
        } else {
          const r = q.run(`INSERT INTO products(${PRODUCT_FIELDS.join(',')}) VALUES(${PRODUCT_FIELDS.map(() => '?').join(',')})`, ...productValues(row));
          if (num(row.opening_stock)) {
            moveStock({ productId: Number(r.lastInsertRowid), qty: num(row.opening_stock), type: 'opening', date: today(), unitCost: num(row.cost_price), notes: 'Opening stock (import)', userId: user.id });
          }
          created++;
        }
      } catch (e) {
        errors.push(`Row ${i + 2}: ${e.message}`);
      }
    });
  });
  audit(user.id, 'import', 'product', null, { created, updated });
  return { created, updated, errors };
});

/* ---------- Stock adjustment (damage, shortage, found, roll re-measure) ---------- */
route('POST', '/api/stock/adjust', STAFF, ({ body, user }) => {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) fail(400, 'Add at least one item');
  const date = dateOr(body.date);
  return tx(() => {
    for (const it of items) {
      const qty = num(it.qty);
      if (!qty) continue;
      moveStock({ productId: Number(it.product_id), qty, type: 'adjust', date, notes: [body.reason, it.notes].filter(Boolean).join(' - ') || 'Stock adjustment', userId: user.id });
    }
    audit(user.id, 'adjust', 'stock', null, { reason: body.reason, count: items.length });
    return { ok: true };
  });
});

route('GET', '/api/stock/moves', STAFF, ({ query }) => {
  const where = ['1=1'];
  const args = [];
  if (query.from) { where.push('m.date >= ?'); args.push(query.from); }
  if (query.to) { where.push('m.date <= ?'); args.push(query.to); }
  if (query.type) { where.push('m.type = ?'); args.push(query.type); }
  if (query.product_id) { where.push('m.product_id = ?'); args.push(Number(query.product_id)); }
  return q.all(`SELECT m.*, p.name AS product_name, p.sku, p.unit, u.name AS user_name FROM stock_moves m
    JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.user_id
    WHERE ${where.join(' AND ')} ORDER BY m.id DESC LIMIT 2000`, ...args);
});

/* ---------- Customers ---------- */
const CUSTOMER_FIELDS = ['name', 'type', 'phone', 'email', 'vat_no', 'address', 'city', 'credit_limit', 'opening_balance', 'active'];
const customerValues = (b, ex = {}) => {
  const v = { ...ex, ...b };
  return [str(v.name), v.type === 'retail' ? 'retail' : 'wholesale', str(v.phone), str(v.email),
    str(v.vat_no) ? String(v.vat_no).toUpperCase().trim() : null, str(v.address), str(v.city),
    num(v.credit_limit), num(v.opening_balance), v.active === false || v.active === 0 ? 0 : 1];
};

route('GET', '/api/customers', null, ({ query }) => {
  const where = [];
  const args = [];
  if (query.q) {
    where.push('(c.name LIKE ? OR c.phone LIKE ? OR c.vat_no LIKE ? OR c.city LIKE ?)');
    args.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
  }
  if (query.active !== 'all') where.push('c.active = 1');
  return q.all(`SELECT c.*,
      c.opening_balance + COALESCE((SELECT SUM(debit - credit) FROM ledger l WHERE l.party_type = 'customer' AND l.party_id = c.id), 0) AS balance
    FROM customers c ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.name LIMIT 2000`, ...args);
});

route('GET', '/api/customers/:id', null, ({ params }) => {
  const c = q.get('SELECT * FROM customers WHERE id = ?', Number(params.id));
  if (!c) fail(404, 'Customer not found');
  c.balance = partyBalance('customer', c.id);
  return c;
});

route('POST', '/api/customers', null, ({ body, user }) => {
  required(body, 'name');
  const r = q.run(`INSERT INTO customers(${CUSTOMER_FIELDS.join(',')}) VALUES(${CUSTOMER_FIELDS.map(() => '?').join(',')})`, ...customerValues(body));
  audit(user.id, 'create', 'customer', r.lastInsertRowid);
  return { id: Number(r.lastInsertRowid) };
});

route('PUT', '/api/customers/:id', null, ({ params, body, user }) => {
  const ex = q.get('SELECT * FROM customers WHERE id = ?', Number(params.id));
  if (!ex) fail(404, 'Customer not found');
  if (user.role === 'cashier') { delete body.credit_limit; delete body.opening_balance; }
  q.run(`UPDATE customers SET ${CUSTOMER_FIELDS.map((f) => f + ' = ?').join(', ')} WHERE id = ?`, ...customerValues(body, ex), ex.id);
  audit(user.id, 'update', 'customer', ex.id);
});

route('DELETE', '/api/customers/:id', STAFF, ({ params }) => {
  const id = Number(params.id);
  if (q.val('SELECT COUNT(*) FROM sales WHERE customer_id = ?', id) || q.val("SELECT COUNT(*) FROM ledger WHERE party_type='customer' AND party_id = ?", id)) {
    q.run('UPDATE customers SET active = 0 WHERE id = ?', id);
    return { deactivated: true };
  }
  q.run('DELETE FROM customers WHERE id = ?', id);
  return { deleted: true };
});

/* ---------- Suppliers ---------- */
const SUPPLIER_FIELDS = ['name', 'type', 'country', 'currency', 'contact_person', 'phone', 'email', 'vat_no', 'address', 'bank_details', 'opening_balance', 'active'];
const supplierValues = (b, ex = {}) => {
  const v = { ...ex, ...b };
  const local = v.type === 'local';
  return [str(v.name), local ? 'local' : 'import', str(v.country) || (local ? 'Sri Lanka' : 'India'), str(v.currency) || (local ? 'LKR' : 'INR'),
    str(v.contact_person), str(v.phone), str(v.email), str(v.vat_no), str(v.address),
    str(v.bank_details), num(v.opening_balance), v.active === false || v.active === 0 ? 0 : 1];
};

route('GET', '/api/suppliers', STAFF, ({ query }) => {
  const where = [];
  const args = [];
  if (query.q) { where.push('(s.name LIKE ? OR s.country LIKE ? OR s.phone LIKE ?)'); args.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`); }
  if (query.type) { where.push('s.type = ?'); args.push(query.type); }
  if (query.active !== 'all') where.push('s.active = 1');
  return q.all(`SELECT s.*,
      s.opening_balance + COALESCE((SELECT SUM(credit - debit) FROM ledger l WHERE l.party_type = 'supplier' AND l.party_id = s.id), 0) AS balance
    FROM suppliers s ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.name`, ...args);
});

route('GET', '/api/suppliers/:id', STAFF, ({ params }) => {
  const s = q.get('SELECT * FROM suppliers WHERE id = ?', Number(params.id));
  if (!s) fail(404, 'Supplier not found');
  s.balance = partyBalance('supplier', s.id);
  return s;
});

route('POST', '/api/suppliers', STAFF, ({ body, user }) => {
  required(body, 'name');
  const r = q.run(`INSERT INTO suppliers(${SUPPLIER_FIELDS.join(',')}) VALUES(${SUPPLIER_FIELDS.map(() => '?').join(',')})`, ...supplierValues(body));
  audit(user.id, 'create', 'supplier', r.lastInsertRowid);
  return { id: Number(r.lastInsertRowid) };
});

route('PUT', '/api/suppliers/:id', STAFF, ({ params, body, user }) => {
  const ex = q.get('SELECT * FROM suppliers WHERE id = ?', Number(params.id));
  if (!ex) fail(404, 'Supplier not found');
  q.run(`UPDATE suppliers SET ${SUPPLIER_FIELDS.map((f) => f + ' = ?').join(', ')} WHERE id = ?`, ...supplierValues(body, ex), ex.id);
  audit(user.id, 'update', 'supplier', ex.id);
});

route('DELETE', '/api/suppliers/:id', STAFF, ({ params }) => {
  const id = Number(params.id);
  const used = q.val(`SELECT (SELECT COUNT(*) FROM purchases WHERE supplier_id = ?) + (SELECT COUNT(*) FROM grn WHERE supplier_id = ?)
    + (SELECT COUNT(*) FROM ledger WHERE party_type='supplier' AND party_id = ?)`, id, id, id);
  if (used) { q.run('UPDATE suppliers SET active = 0 WHERE id = ?', id); return { deactivated: true }; }
  q.run('DELETE FROM suppliers WHERE id = ?', id);
  return { deleted: true };
});

/* ---------- Party ledger statement ---------- */
route('GET', '/api/ledger/:type/:id', null, ({ params, query, user }) => {
  const type = params.type;
  if (!['customer', 'supplier'].includes(type)) fail(400, 'Invalid party type');
  if (type === 'supplier' && user.role === 'cashier') fail(403, 'Not allowed');
  const id = Number(params.id);
  const party = q.get(`SELECT * FROM ${type}s WHERE id = ?`, id);
  if (!party) fail(404, 'Party not found');
  const from = query.from || '0000-01-01';
  const to = query.to || '9999-12-31';
  const sign = type === 'customer' ? 1 : -1; // customer: dr - cr ; supplier: cr - dr
  const before = q.get('SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c FROM ledger WHERE party_type = ? AND party_id = ? AND date < ?', type, id, from);
  let running = party.opening_balance + sign * (before.d - before.c);
  const opening = running;
  const entries = q.all('SELECT * FROM ledger WHERE party_type = ? AND party_id = ? AND date BETWEEN ? AND ? ORDER BY date, id', type, id, from, to)
    .map((e) => { running += sign * (e.debit - e.credit); return { ...e, balance: Math.round(running * 100) / 100 }; });
  return { party, opening: Math.round(opening * 100) / 100, closing: Math.round(running * 100) / 100, entries };
});
