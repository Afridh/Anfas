/* GRN — Goods Receipt Note (bale / cargo receipts with customer costing formula) */
const { q, tx, getSettings, setSetting, nextNumber, audit } = require('../db');
const { route, fail, num, str, required, dateOr, today } = require('../app');
const { moveStock, postLedger, removeLedger } = require('../inventory');
const { grnCost, r3 } = require('../../public/js/tax');

const STAFF = ['admin', 'manager'];

function loadGrn(id) {
  const g = q.get(`SELECT g.*, s.name AS supplier_name, s.phone AS supplier_phone, s.address AS supplier_address, u.name AS user_name
    FROM grn g JOIN suppliers s ON s.id = g.supplier_id LEFT JOIN users u ON u.id = g.user_id WHERE g.id = ?`, id);
  if (!g) fail(404, 'GRN not found');
  g.items = q.all(`SELECT i.*, p.name, p.sku, p.unit, p.sale_price FROM grn_items i JOIN products p ON p.id = i.product_id
    WHERE i.grn_id = ? ORDER BY i.id`, id);
  return g;
}

route('GET', '/api/grn/defaults', STAFF, () => {
  const s = getSettings();
  return { india_rate: num(s.grn_india_rate, 1), other_expenses: num(s.grn_other_expenses), charges_basis: s.grn_charges_basis || 'per_piece' };
});

route('GET', '/api/grn', STAFF, ({ query }) => {
  const where = ['1=1'];
  const args = [];
  if (query.from) { where.push('g.date >= ?'); args.push(query.from); }
  if (query.to) { where.push('g.date <= ?'); args.push(query.to); }
  if (query.supplier_id) { where.push('g.supplier_id = ?'); args.push(Number(query.supplier_id)); }
  if (query.q) {
    where.push('(g.grn_no LIKE ? OR g.bale_no LIKE ? OR g.lr_no LIKE ? OR g.cargo_name LIKE ? OR s.name LIKE ?)');
    for (let i = 0; i < 5; i++) args.push(`%${query.q}%`);
  }
  return q.all(`SELECT g.*, s.name AS supplier_name FROM grn g JOIN suppliers s ON s.id = g.supplier_id
    WHERE ${where.join(' AND ')} ORDER BY g.id DESC LIMIT 3000`, ...args);
});

route('GET', '/api/grn/:id', STAFF, ({ params }) => loadGrn(Number(params.id)));

route('POST', '/api/grn', STAFF, ({ body, user }) => {
  required(body, 'supplier_id');
  const items = (Array.isArray(body.items) ? body.items : []).filter((i) => num(i.pcs) > 0);
  if (!items.length) fail(400, 'Add at least one item with Pcs');
  const supplier = q.get('SELECT * FROM suppliers WHERE id = ?', Number(body.supplier_id));
  if (!supplier) fail(400, 'Supplier not found');
  const s = getSettings();
  const h = {
    india_rate: body.india_rate === '' || body.india_rate == null ? num(s.grn_india_rate, 1) : num(body.india_rate),
    other_expenses: body.other_expenses === '' || body.other_expenses == null ? num(s.grn_other_expenses) : num(body.other_expenses),
    cargo_charge: num(body.cargo_charge),
    charges_basis: body.charges_basis === 'per_grn' ? 'per_grn' : 'per_piece'
  };
  if (!(h.india_rate > 0)) fail(400, 'India rate must be greater than zero');
  for (const it of items) if (num(it.india_cost) < 0) fail(400, 'India cost cannot be negative');

  return tx(() => {
    const date = dateOr(body.date);
    const calc = grnCost(h, items);
    const T = calc.totals;
    const grnNo = nextNumber('GRN', date);
    const r = q.run(`INSERT INTO grn(grn_no, date, supplier_id, cargo_name, bale_no, lr_no, india_rate, cargo_charge, other_expenses, charges_basis,
        total_pcs, india_value, goods_value, cargo_total, other_total, final_total, notes, user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    grnNo, date, supplier.id, str(body.cargo_name), str(body.bale_no), str(body.lr_no), h.india_rate, h.cargo_charge, h.other_expenses,
    h.charges_basis, r3(T.pcs), T.india_value, T.goods_value, T.cargo_total, T.other_total, T.final_total, str(body.notes), user.id);
    const id = Number(r.lastInsertRowid);
    items.forEach((it, i) => {
      const c = calc.lines[i];
      const pcs = r3(num(it.pcs));
      q.run(`INSERT INTO grn_items(grn_id, product_id, india_cost, pcs, bundles, pcs_per_set, colours, size, expected_price, base_cost, final_cost, line_total)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, id, Number(it.product_id), num(it.india_cost), pcs, num(it.bundles), num(it.pcs_per_set),
      Math.round(num(it.colours)), str(it.size), num(it.expected_price), c.base_cost, c.final_cost, c.line_total);
      moveStock({ productId: Number(it.product_id), qty: pcs, type: 'grn', date, refId: id, refNo: grnNo, unitCost: c.final_cost, updateCost: true,
        notes: [body.bale_no && 'Bale ' + body.bale_no, body.lr_no && 'LR ' + body.lr_no].filter(Boolean).join(' · ') || null, userId: user.id });
      if (num(it.expected_price) > 0 && it.update_price !== false) {
        /* Wholesale shop: expected selling price becomes the wholesale price (and retail price if none set yet) */
        q.run('UPDATE products SET wholesale_price = ?, sale_price = CASE WHEN sale_price > 0 THEN sale_price ELSE ? END WHERE id = ?',
          num(it.expected_price), num(it.expected_price), Number(it.product_id));
      }
    });
    /* Supplier is owed the goods value in LKR (India cost x India rate). Cargo & other expenses are paid to others. */
    postLedger({ date, partyType: 'supplier', partyId: supplier.id, refType: 'grn', refId: id, refNo: grnNo, credit: T.goods_value,
      narration: `GRN${body.bale_no ? ' bale ' + body.bale_no : ''}${body.lr_no ? ' LR ' + body.lr_no : ''} (INR ${T.india_value} @ ${h.india_rate})` });
    if (body.save_defaults) {
      setSetting('grn_india_rate', h.india_rate);
      setSetting('grn_other_expenses', h.other_expenses);
      setSetting('grn_charges_basis', h.charges_basis);
    }
    audit(user.id, 'create', 'grn', id, { grn_no: grnNo, total: T.final_total });
    return { id, grn_no: grnNo, final_total: T.final_total };
  });
});

route('POST', '/api/grn/:id/cancel', STAFF, ({ params, body, user }) => tx(() => {
  const g = loadGrn(Number(params.id));
  if (g.cancelled) fail(400, 'GRN already cancelled');
  for (const it of g.items) {
    moveStock({ productId: it.product_id, qty: -it.pcs, type: 'grn_cancel', date: today(), refId: g.id, refNo: g.grn_no, notes: 'GRN cancelled', userId: user.id });
  }
  removeLedger('grn', g.id);
  q.run(`UPDATE grn SET cancelled = 1, notes = TRIM(COALESCE(notes,'') || ' [Cancelled: ' || ? || ']') WHERE id = ?`, str(body.reason) || 'no reason', g.id);
  audit(user.id, 'cancel', 'grn', g.id, { reason: body.reason });
  return loadGrn(g.id);
}));
