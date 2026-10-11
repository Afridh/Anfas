const { q, getSettings } = require('./db');
const { fail } = require('./app');
const { r2, r3 } = require('../public/js/tax');

/*
 * Move stock for a product and record it in the stock ledger.
 * qty > 0 = stock in, qty < 0 = stock out.
 * When unitCost is provided on stock-in, the product's cost price is updated
 * using the weighted-average method (standard for traded goods).
 */
function moveStock({ productId, qty, type, date, refId, refNo, unitCost, notes, userId, updateCost = false }) {
  const p = q.get('SELECT id, name, stock, cost_price FROM products WHERE id = ?', productId);
  if (!p) fail(400, `Product #${productId} not found`);
  qty = r3(qty);
  const newStock = r3(p.stock + qty);
  if (qty < 0 && newStock < 0 && getSettings().allow_negative_stock !== '1') {
    fail(400, `Insufficient stock for "${p.name}". Available: ${p.stock}, required: ${-qty}`);
  }
  let cost = p.cost_price;
  if (updateCost && qty > 0 && unitCost != null) {
    const oldQty = Math.max(p.stock, 0);
    cost = oldQty + qty > 0 ? r2((oldQty * p.cost_price + qty * unitCost) / (oldQty + qty)) : unitCost;
  }
  q.run('UPDATE products SET stock = ?, cost_price = ? WHERE id = ?', newStock, cost, productId);
  q.run(`INSERT INTO stock_moves(date, product_id, qty, balance, type, ref_id, ref_no, unit_cost, notes, user_id)
    VALUES(?,?,?,?,?,?,?,?,?,?)`, date, productId, qty, newStock, type, refId, refNo,
  unitCost != null ? unitCost : p.cost_price, notes, userId);
  return { stock: newStock, cost_price: cost };
}

/* Party ledger entry. Customer: debit = they owe us. Supplier: credit = we owe them. */
function postLedger({ date, partyType, partyId, refType, refId, refNo, debit = 0, credit = 0, narration }) {
  if (!partyId) return;
  q.run(`INSERT INTO ledger(date, party_type, party_id, ref_type, ref_id, ref_no, debit, credit, narration)
    VALUES(?,?,?,?,?,?,?,?,?)`, date, partyType, partyId, refType, refId, refNo, r2(debit), r2(credit), narration);
}

function removeLedger(refType, refId) {
  q.run('DELETE FROM ledger WHERE ref_type = ? AND ref_id = ?', refType, refId);
}

/* Customer balance (positive = receivable). Supplier balance (positive = payable). */
function partyBalance(partyType, partyId) {
  const table = partyType === 'customer' ? 'customers' : 'suppliers';
  const opening = q.val(`SELECT opening_balance FROM ${table} WHERE id = ?`, partyId) || 0;
  const row = q.get('SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c FROM ledger WHERE party_type = ? AND party_id = ?', partyType, partyId);
  return r2(partyType === 'customer' ? opening + row.d - row.c : opening + row.c - row.d);
}

module.exports = { moveStock, postLedger, removeLedger, partyBalance };
