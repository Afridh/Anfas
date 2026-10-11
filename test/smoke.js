/* End-to-end API smoke test against a throwaway database. Run: npm test */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-test-'));
const PORT = 3900 + Math.floor(Math.random() * 90);
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, ERP_DATA_DIR: dataDir, HOST: '127.0.0.1' } });
let out = '';
srv.stdout.on('data', (d) => { out += d; });
srv.stderr.on('data', (d) => { out += d; });

let cookie = '';
async function api(method, url, body) {
  const r = await fetch(`http://127.0.0.1:${PORT}${url}`, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`${method} ${url} -> ${r.status} ${data.error}`); e.status = r.status; throw e; }
  return data;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const approx = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.02, `${msg}: expected ${b}, got ${a}`);

(async () => {
  try {
    for (let i = 0; i < 50 && !out.includes('running'); i++) await wait(100);
    await assert.rejects(api('GET', '/api/products'), /401/);
    await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
    const meta = await api('GET', '/api/meta');
    assert.equal(meta.settings.currency_symbol, 'Rs.');
    assert.equal(meta.settings.tax_enabled, '0', 'VAT off by default');
    await api('POST', '/api/system/demo');

    const products = await api('GET', '/api/products');
    assert.equal(products.length, 12);
    const bySku = (sku) => products.find((p) => p.sku === sku);

    // ---- GRN costing: India cost (INR) x India rate + other expenses + cargo (LKR) ----
    const grns = await api('GET', '/api/grn');
    assert.equal(grns.length, 3);
    const g1 = await api('GET', `/api/grn/${grns.find((g) => g.bale_no === 'B-2041').id}`);
    approx(g1.items[0].final_cost, 820 * 3.45 + 30 + 120, 'per-piece GRN final cost');
    approx(g1.india_value, 820 * 60 + 450 * 100 + 3600 * 8, 'GRN INR value');
    const g2 = await api('GET', `/api/grn/${grns.find((g) => g.bale_no === 'B-117').id}`);
    approx(g2.items[0].final_cost, 285 * 3.48 + (18500 + 4500) / 360, 'per-GRN charges shared per piece');
    approx(bySku('SR001').cost_price, 2979, 'product cost = GRN final cost');
    approx(bySku('SR001').wholesale_price, 3400, 'expected price -> wholesale price');

    // GRN with defaults left blank uses settings defaults
    await api('PUT', '/api/settings', { grn_india_rate: '3.6', grn_other_expenses: '15' });
    const d = await api('GET', '/api/grn/defaults');
    assert.equal(d.india_rate, 3.6);
    const sups = await api('GET', '/api/suppliers');
    const ng = await api('POST', '/api/grn', { supplier_id: sups[0].id, india_rate: '', other_expenses: '', cargo_charge: 100,
      items: [{ product_id: bySku('DP001').id, india_cost: 100, pcs: 10, expected_price: 600 }] });
    approx((await api('GET', `/api/grn/${ng.id}`)).items[0].final_cost, 100 * 3.6 + 15 + 100, 'GRN defaults');
    await api('POST', `/api/grn/${ng.id}/cancel`, { reason: 'test' });

    // ---- Billing in LKR, VAT off: total = qty x rate, cents kept ----
    const kurti = bySku('KT001');
    const sale = await api('POST', '/api/sales', { items: [{ product_id: kurti.id, qty: 3, rate: 1150.5 }], payments: [{ mode: 'cash', amount: 5000 }] });
    const full = await api('GET', `/api/sales/${sale.id}`);
    approx(full.total, 3451.5, 'no-VAT total');
    approx(full.tax, 0, 'no VAT');
    approx(full.paid, 3451.5, 'cash excess treated as change');
    assert.equal(full.price_type, 'wholesale', 'wholesale is default price list');

    // ---- VAT on, exclusive 18% ----
    await api('PUT', '/api/settings', { tax_enabled: '1' });
    const vs = await api('POST', '/api/sales', { items: [{ product_id: kurti.id, qty: 2, rate: 1000 }], payments: [{ mode: 'card', amount: 2360 }] });
    const vfull = await api('GET', `/api/sales/${vs.id}`);
    approx(vfull.tax, 360, 'VAT 18%'); approx(vfull.total, 2360, 'VAT total');
    await api('PUT', '/api/settings', { tax_enabled: '0' });

    // ---- Credit sale, return, receipt ----
    await assert.rejects(api('POST', '/api/sales', { items: [{ product_id: kurti.id, qty: 1, rate: 1150 }], payments: [] }), /customer/);
    const custs = await api('GET', '/api/customers');
    const galle = custs.find((c) => c.name === 'Galle Textiles');
    const credit = await api('POST', '/api/sales', { customer_id: galle.id, items: [{ product_id: kurti.id, qty: 10, rate: 1150 }], payments: [] });
    const cs = await api('GET', `/api/sales/${credit.id}`);
    approx(cs.total, 11500, 'credit total');
    const ret = await api('POST', `/api/sales/${credit.id}/return`, { items: [{ sale_item_id: cs.items[0].id, qty: 2 }], refund_mode: 'credit' });
    approx(ret.total, 2300, 'credit note total');
    await api('POST', '/api/payments', { party_type: 'customer', party_id: galle.id, amount: 1000, mode: 'lankaqr' });
    const led = await api('GET', `/api/ledger/customer/${galle.id}`);
    assert.ok(led.entries.length >= 4);
    await assert.rejects(api('POST', '/api/sales', { items: [{ product_id: kurti.id, qty: 99999, rate: 1 }], payments: [{ mode: 'cash', amount: 99999 }] }), /Insufficient/);

    const vat = await api('GET', '/api/reports/vat?from=2000-01-01&to=2100-01-01');
    approx(vat.summary.output.tax, 360, 'VAT report output tax');
    const gr = await api('GET', '/api/reports/grn?from=2000-01-01&to=2100-01-01');
    assert.equal(gr.rows.length, 3);
    const pl = await api('GET', '/api/reports/profit?from=2000-01-01&to=2100-01-01');
    assert.ok(pl.net_sales > 0 && pl.cogs > 0);
    for (const u of ['/api/dashboard', '/api/reports/stock', '/api/reports/outstanding', '/api/reports/outstanding?type=supplier',
      '/api/reports/daybook', '/api/reports/sales?group=product&from=2000-01-01', '/api/reports/sales?group=customer&from=2000-01-01',
      '/api/stock/moves', '/api/purchases', '/api/payments', '/api/expenses', '/api/returns', '/api/audit', '/api/system/info']) {
      await api('GET', u);
    }
    // cashier permissions
    await api('POST', '/api/users', { username: 'cash1', name: 'Counter 1', role: 'cashier', password: 'secret1' });
    await api('POST', '/api/auth/logout');
    await api('POST', '/api/auth/login', { username: 'cash1', password: 'secret1' });
    await assert.rejects(api('GET', '/api/reports/vat'), /403/);
    await assert.rejects(api('GET', '/api/grn'), /403/);
    await api('GET', '/api/products');
    console.log('ALL SMOKE TESTS PASSED');
  } catch (e) {
    console.error('TEST FAILED:', e.message);
    console.error(out);
    process.exitCode = 1;
  } finally {
    srv.kill();
    await wait(300);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})();
