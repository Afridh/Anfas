/* Loads realistic sample data (Sri Lankan wholesale shop buying from India) so the system can be explored. */
const { q, tx, getSettings } = require('../db');
const { route, invoke, fail, today } = require('../app');
const { computeBill } = require('../../public/js/tax');

const daysAgo = (n) => {
  const d = new Date(Date.now() - n * 86400000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

route('POST', '/api/system/demo', ['admin'], ({ user }) => {
  if (q.val('SELECT COUNT(*) FROM products')) fail(400, 'Sample data can only be loaded into an empty system (no products yet).');
  const s = getSettings();
  const cat = (name) => q.val('SELECT id FROM categories WHERE name = ?', name);

  return tx(() => {
    const call = (m, p, b) => invoke(m, p, b, user);

    const sup = {
      surat: call('POST', '/api/suppliers', { name: 'Shree Ganesh Sarees, Surat', type: 'import', country: 'India', currency: 'INR', contact_person: 'Rakesh Shah', phone: '+91 98250 11223', address: 'Ring Road Textile Market, Surat, Gujarat' }).id,
      tiruppur: call('POST', '/api/suppliers', { name: 'Tiruppur Knit Garments', type: 'import', country: 'India', currency: 'INR', contact_person: 'S. Murugan', phone: '+91 94430 55667', address: 'Avinashi Road, Tiruppur, Tamil Nadu' }).id,
      kolkata: call('POST', '/api/suppliers', { name: 'Burrabazar Fashions, Kolkata', type: 'import', country: 'India', currency: 'INR', contact_person: 'Amit Agarwal', phone: '+91 98300 44556', address: 'Burrabazar, Kolkata, West Bengal' }).id,
      local: call('POST', '/api/suppliers', { name: 'Pettah Textile Stores', type: 'local', country: 'Sri Lanka', currency: 'LKR', phone: '011 2345678', address: '3rd Cross Street, Pettah, Colombo 11' }).id
    };

    // sku, name, category, unit, size, colour, wholesale, retail, reorder
    const P = [
      ['SR001', 'Soft Silk Saree with Blouse', 'Sarees', 'PCS', 'Free', 'Assorted', 3400, 4250, 10],
      ['SR002', 'Georgette Printed Saree', 'Sarees', 'PCS', 'Free', 'Assorted', 1950, 2450, 10],
      ['SR003', 'Kanchipuram Pattu Saree', 'Sarees', 'PCS', 'Free', 'Maroon / Gold', 14500, 17900, 3],
      ['SL001', 'Cotton Salwar Set (3 pc)', 'Salwar / Churidar Sets', 'SET', 'M-L-XL-XXL', 'Assorted', 2300, 2950, 8],
      ['KT001', 'Rayon Long Kurti', 'Kurtis & Tops', 'PCS', 'M-L-XL-XXL', '6 colours', 1150, 1490, 20],
      ['KT002', 'Embroidered Party Kurti', 'Kurtis & Tops', 'PCS', 'M-L-XL', '4 colours', 2150, 2750, 10],
      ['GS001', 'Gents Cotton Shirt (Full Sleeve)', 'Gents Shirts', 'PCS', '38-40-42-44', '5 colours', 1350, 1750, 24],
      ['GT001', 'Gents Formal Trouser', 'Gents Trousers / Dhoti', 'PCS', '30-32-34-36', 'Black / Navy / Grey', 1850, 2400, 12],
      ['KW001', 'Kids Frock (2-8 yrs)', 'Kids Wear', 'PCS', '2-4-6-8', 'Assorted', 950, 1290, 16],
      ['LH001', 'Bridal Lehenga Set', 'Lehenga / Bridal', 'SET', 'Free', 'Red / Pink', 28500, 35000, 2],
      ['DP001', 'Chiffon Dupatta', 'Shawls & Dupattas', 'PCS', 'Free', '8 colours', 520, 690, 30],
      ['FB001', 'Cotton Cambric Fabric (per m)', 'Fabric (per metre)', 'MTR', '44"', 'Printed', 420, 550, 100]
    ];
    const prod = {};
    for (const p of P) {
      prod[p[0]] = call('POST', '/api/products', {
        sku: p[0], barcode: p[0], name: p[1], category_id: cat(p[2]), unit: p[3], size: p[4], color: p[5],
        wholesale_price: p[6], sale_price: p[7], reorder_level: p[8], origin: 'India', tax_rate: s.default_tax_rate
      }).id;
    }

    /* GRNs: India cost (INR) x India rate + other expenses + cargo (LKR) */
    const grn = (ago, supplier, cargo, bale, lr, rate, cargoCharge, other, basis, items) => call('POST', '/api/grn', {
      date: daysAgo(ago), supplier_id: supplier, cargo_name: cargo, bale_no: bale, lr_no: lr, india_rate: rate,
      cargo_charge: cargoCharge, other_expenses: other, charges_basis: basis, items
    });
    grn(32, sup.surat, 'Lanka Cargo Express', 'B-2041', 'LR 558812', 3.45, 120, 30, 'per_piece', [
      { product_id: prod.SR001, india_cost: 820, pcs: 60, bundles: 3, pcs_per_set: 0, colours: 12, size: 'Free', expected_price: 3400 },
      { product_id: prod.SR002, india_cost: 450, pcs: 100, bundles: 4, colours: 10, size: 'Free', expected_price: 1950 },
      { product_id: prod.SR003, india_cost: 3600, pcs: 8, bundles: 1, colours: 4, size: 'Free', expected_price: 14500 }
    ]);
    grn(21, sup.tiruppur, 'Chennai-Colombo Cargo', 'B-117', 'LR 77341', 3.48, 18500, 4500, 'per_grn', [
      { product_id: prod.GS001, india_cost: 285, pcs: 120, bundles: 5, pcs_per_set: 4, colours: 5, size: '38-40-42-44', expected_price: 1350 },
      { product_id: prod.KW001, india_cost: 190, pcs: 96, bundles: 4, pcs_per_set: 4, colours: 6, size: '2-4-6-8', expected_price: 950 },
      { product_id: prod.KT001, india_cost: 240, pcs: 144, bundles: 6, pcs_per_set: 4, colours: 6, size: 'M-L-XL-XXL', expected_price: 1150 }
    ]);
    grn(9, sup.kolkata, 'Lanka Cargo Express', 'B-2107', 'LR 559020', 3.5, 140, 25, 'per_piece', [
      { product_id: prod.KT002, india_cost: 470, pcs: 48, bundles: 2, pcs_per_set: 3, colours: 4, size: 'M-L-XL', expected_price: 2150 },
      { product_id: prod.SL001, india_cost: 520, pcs: 40, bundles: 2, pcs_per_set: 4, colours: 5, size: 'M-L-XL-XXL', expected_price: 2300 },
      { product_id: prod.LH001, india_cost: 6800, pcs: 4, bundles: 1, colours: 2, size: 'Free', expected_price: 28500 },
      { product_id: prod.DP001, india_cost: 95, pcs: 200, bundles: 4, colours: 8, size: 'Free', expected_price: 520 }
    ]);

    /* Local purchase */
    call('POST', '/api/purchases', { supplier_id: sup.local, bill_no: 'PTS/4471', date: daysAgo(15), other_charges: 1500,
      items: [{ product_id: prod.GT001, qty: 36, rate: 1320 }, { product_id: prod.FB001, qty: 300, rate: 305 }] });

    /* Payment to Indian supplier in INR */
    call('POST', '/api/payments', { party_type: 'supplier', party_id: sup.surat, direction: 'out', date: daysAgo(25), amount: Math.round(80000 * 3.46),
      mode: 'bank', reference: 'TT via Commercial Bank', fc_amount: 80000, fc_currency: 'INR', fc_rate: 3.46 });

    const cust = {
      kandy: call('POST', '/api/customers', { name: 'Kandy Fashion House', type: 'wholesale', phone: '081 2223344', city: 'Kandy', address: 'Dalada Veediya', credit_limit: 750000 }).id,
      galle: call('POST', '/api/customers', { name: 'Galle Textiles', type: 'wholesale', phone: '091 2234567', city: 'Galle', address: 'Main Street', credit_limit: 500000 }).id,
      jaffna: call('POST', '/api/customers', { name: 'Jaffna Silk Centre', type: 'wholesale', phone: '021 2228899', city: 'Jaffna', address: 'Hospital Road', credit_limit: 600000 }).id,
      batti: call('POST', '/api/customers', { name: 'Batticaloa Dress Point', type: 'wholesale', phone: '065 2227788', city: 'Batticaloa', credit_limit: 300000 }).id
    };

    const bills = [
      [18, cust.kandy, [['SR001', 12], ['SR002', 20], ['GS001', 24]], [['cheque', 30000]]],
      [14, cust.jaffna, [['SR003', 2], ['SR001', 10], ['DP001', 40]], [['bank']]],
      [10, cust.galle, [['KT001', 36], ['KW001', 24], ['GT001', 12]], []],
      [6, cust.batti, [['KT002', 12], ['SL001', 8]], [['cash', 20000]]],
      [3, cust.kandy, [['LH001', 1], ['KT002', 6], ['FB001', 60]], [['bank', 25000]]],
      [1, null, [['DP001', 10], ['KW001', 4]], [['cash']]],
      [0, cust.jaffna, [['SR002', 15], ['KT001', 24]], [['lankaqr', 15000]]]
    ];
    for (const [ago, cid, lines, pays] of bills) {
      const items = lines.map(([sku, qty]) => {
        const p = q.get('SELECT * FROM products WHERE sku = ?', sku);
        return { product_id: p.id, qty, rate: p.wholesale_price, tax_rate: p.tax_rate };
      });
      const calc = computeBill(items, { tax_enabled: s.tax_enabled === '1', inclusive: s.prices_include_tax === '1', round: s.round_off === '1' });
      const payments = pays.map(([mode, amt]) => ({ mode, amount: amt || calc.totals.grand_total }));
      call('POST', '/api/sales', { date: daysAgo(ago), customer_id: cid, items, payments, price_type: 'wholesale' });
    }
    call('POST', '/api/payments', { party_type: 'customer', party_id: cust.galle, amount: 50000, mode: 'cheque', reference: 'Chq 004512 (HNB)', date: daysAgo(4) });

    for (const [ago, c, amt, to, mode] of [[25, 'Rent', 150000, 'Building owner', 'bank'], [20, 'Salary', 210000, 'Staff', 'bank'],
      [9, 'Electricity', 18400, 'CEB', 'cash'], [5, 'Transport / Delivery', 12500, 'Lorry hire - Kandy', 'cash'], [2, 'Packing Material', 6800, 'Polythene & boxes', 'cash']]) {
      call('POST', '/api/expenses', { date: daysAgo(ago), category: c, amount: amt, paid_to: to, mode });
    }
    return { ok: true, today: today() };
  });
});
