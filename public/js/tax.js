/*
 * Shared calculation engine — used by the server (authoritative) and the
 * browser (live preview), so totals on screen always match the saved bill.
 * Sri Lanka: single VAT rate per item (optional), amounts in LKR.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Tax = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function r2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }
  function r3(n) {
    return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
  }

  /*
   * items: [{ qty, rate, discount_pct, tax_rate }]
   * opts : { tax_enabled, inclusive, bill_discount, round }
   */
  function computeBill(items, opts) {
    opts = opts || {};
    const taxOn = !!opts.tax_enabled;
    const inclusive = !!opts.inclusive;
    const doRound = !!opts.round;

    const pre = items.map(function (it) {
      const qty = Number(it.qty) || 0;
      const rate = Number(it.rate) || 0;
      const gross = qty * rate;
      const dpct = Math.min(Math.max(Number(it.discount_pct) || 0, 0), 100);
      const ldisc = gross * dpct / 100;
      return { qty: qty, rate: rate, gross: gross, ldisc: ldisc, net: gross - ldisc };
    });
    const sumNet = pre.reduce(function (s, p) { return s + p.net; }, 0);
    const billDisc = Math.min(Math.max(Number(opts.bill_discount) || 0, 0), sumNet);

    const t = { gross: 0, line_discount: 0, bill_discount: r2(billDisc), taxable: 0, tax: 0, total: 0, round_off: 0, grand_total: 0 };

    const lines = items.map(function (it, i) {
      const p = pre[i];
      const share = sumNet > 0 ? billDisc * p.net / sumNet : 0;
      const net = p.net - share;
      const g = taxOn ? Number(it.tax_rate) || 0 : 0;
      let taxable, tax;
      if (inclusive) {
        taxable = net / (1 + g / 100);
        tax = net - taxable;
      } else {
        taxable = net;
        tax = taxable * g / 100;
      }
      taxable = r2(taxable);
      tax = r2(tax);
      t.gross += p.gross; t.line_discount += p.ldisc; t.taxable += taxable; t.tax += tax;
      return {
        qty: r3(p.qty), rate: r2(p.rate), gross: r2(p.gross), discount: r2(p.ldisc + share),
        taxable: taxable, tax_rate: g, tax: tax, total: r2(taxable + tax)
      };
    });

    ['gross', 'line_discount', 'taxable', 'tax'].forEach(function (k) { t[k] = r2(t[k]); });
    t.total = r2(t.taxable + t.tax);
    t.grand_total = doRound ? Math.round(t.total) : t.total;
    t.round_off = r2(t.grand_total - t.total);
    return { lines: lines, totals: t };
  }

  /*
   * GRN costing (customer formula), all results in LKR:
   *   Final cost per piece = India cost (INR) x India rate (LKR per 1 INR) + Other expenses + Cargo charge
   * h: { india_rate, cargo_charge, other_expenses, charges_basis: 'per_piece' | 'per_grn' }
   *   per_piece -> cargo & other expenses are LKR per piece, added as-is
   *   per_grn   -> cargo & other expenses are LKR totals for the GRN, shared equally per piece
   * lines: [{ india_cost, pcs }]  (india_cost is INR per piece)
   */
  function grnCost(h, lines) {
    const rate = Number(h.india_rate) || 0;
    const cargo = Number(h.cargo_charge) || 0;
    const other = Number(h.other_expenses) || 0;
    const perGrn = h.charges_basis === 'per_grn';
    const totalPcs = lines.reduce(function (a, l) { return a + (Number(l.pcs) || 0); }, 0);
    const cargoPc = perGrn ? (totalPcs ? cargo / totalPcs : 0) : cargo;
    const otherPc = perGrn ? (totalPcs ? other / totalPcs : 0) : other;
    const t = { pcs: totalPcs, india_value: 0, goods_value: 0, cargo_total: 0, other_total: 0, final_total: 0 };
    const out = lines.map(function (l) {
      const pcs = Number(l.pcs) || 0;
      const inr = Number(l.india_cost) || 0;
      const base = inr * rate;
      const finalCost = r2(base + otherPc + cargoPc);
      const lineTotal = r2(finalCost * pcs);
      t.india_value += inr * pcs;
      t.goods_value += base * pcs;
      t.cargo_total += cargoPc * pcs;
      t.other_total += otherPc * pcs;
      t.final_total += lineTotal;
      return { base_cost: r2(base), cargo_pc: r2(cargoPc), other_pc: r2(otherPc), final_cost: finalCost, line_total: lineTotal };
    });
    ['india_value', 'goods_value', 'cargo_total', 'other_total', 'final_total'].forEach(function (k) { t[k] = r2(t[k]); });
    return { lines: out, totals: t };
  }

  /* Amount in words, international system: Rupees One Million Two Hundred Thousand ... and Fifty Cents Only */
  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function two(n) { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''); }
  function three(n) {
    const h = Math.floor(n / 100), r = n % 100;
    return (h ? ONES[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? two(r) : '');
  }
  function intWords(n) {
    if (n === 0) return 'Zero';
    const scales = [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']];
    const parts = [];
    for (const [v, name] of scales) {
      if (n >= v) { parts.push(three(Math.floor(n / v)) + ' ' + name); n %= v; }
    }
    if (n) parts.push(three(n));
    return parts.join(' ');
  }
  function amountInWords(amount) {
    amount = Math.abs(r2(amount));
    const rupees = Math.floor(amount);
    const cents = Math.round((amount - rupees) * 100);
    let s = 'Rupees ' + intWords(rupees);
    if (cents) s += ' and ' + two(cents) + ' Cents';
    return s + ' Only';
  }

  return { r2: r2, r3: r3, computeBill: computeBill, grnCost: grnCost, amountInWords: amountInWords };
});
