const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.ERP_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'erp.db');
const SCHEMA_VERSION = 'lk1';

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');

/*
 * One-time upgrade from the earlier India/GST layout. Only allowed while that database
 * holds no business data (just the default login); otherwise refuse so nothing is lost.
 */
(function upgradeOldLayout() {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
  if (!tables.length) return;
  const hasSettings = tables.includes('settings');
  const version = hasSettings ? db.prepare("SELECT value FROM settings WHERE key = 'schema_version'").get() : null;
  if (version && version.value === SCHEMA_VERSION) return;
  const count = (t) => (tables.includes(t) ? db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c : 0);
  const business = ['products', 'customers', 'suppliers', 'sales', 'purchases', 'payments', 'expenses'].reduce((a, t) => a + count(t), 0);
  if (business > 0) {
    throw new Error(`The database at ${DB_FILE} uses an older layout and already contains data. Move it out of the data folder to start fresh.`);
  }
  console.log('  Upgrading empty database to the Sri Lanka layout…');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const t of tables) db.exec(`DROP TABLE IF EXISTS "${t}"`);
})();
db.exec('PRAGMA foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','cashier')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
  barcode TEXT,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  unit TEXT NOT NULL DEFAULT 'PCS',
  tax_rate REAL NOT NULL DEFAULT 0,
  cost_price REAL NOT NULL DEFAULT 0,
  sale_price REAL NOT NULL DEFAULT 0,
  wholesale_price REAL NOT NULL DEFAULT 0,
  mrp REAL NOT NULL DEFAULT 0,
  stock REAL NOT NULL DEFAULT 0,
  reorder_level REAL NOT NULL DEFAULT 0,
  color TEXT, design TEXT, size TEXT, composition TEXT, origin TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'wholesale' CHECK (type IN ('retail','wholesale')),
  phone TEXT, email TEXT, vat_no TEXT, address TEXT, city TEXT,
  credit_limit REAL NOT NULL DEFAULT 0,
  opening_balance REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'import' CHECK (type IN ('import','local')),
  country TEXT, currency TEXT NOT NULL DEFAULT 'INR',
  contact_person TEXT, phone TEXT, email TEXT, vat_no TEXT, address TEXT,
  bank_details TEXT,
  opening_balance REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT, customer_phone TEXT, customer_vat_no TEXT, customer_address TEXT,
  price_type TEXT NOT NULL DEFAULT 'wholesale',
  inclusive INTEGER NOT NULL DEFAULT 0,
  tax_enabled INTEGER NOT NULL DEFAULT 0,
  gross REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  bill_discount REAL NOT NULL DEFAULT 0,
  taxable REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  round_off REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  paid REAL NOT NULL DEFAULT 0,
  returned REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'paid',
  notes TEXT,
  user_id INTEGER REFERENCES users(id),
  cancelled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  name TEXT NOT NULL, unit TEXT,
  qty REAL NOT NULL, rate REAL NOT NULL, discount_pct REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  taxable REAL NOT NULL, tax_rate REAL NOT NULL DEFAULT 0, tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  cost_price REAL NOT NULL DEFAULT 0,
  returned_qty REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);

CREATE TABLE IF NOT EXISTS sale_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  mode TEXT NOT NULL, amount REAL NOT NULL, reference TEXT
);

CREATE TABLE IF NOT EXISTS sales_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_no TEXT NOT NULL UNIQUE,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  date TEXT NOT NULL,
  taxable REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  refunded REAL NOT NULL DEFAULT 0,
  refund_mode TEXT NOT NULL DEFAULT 'cash',
  reason TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sales_return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  name TEXT, qty REAL NOT NULL, tax_rate REAL NOT NULL DEFAULT 0,
  taxable REAL NOT NULL, tax REAL NOT NULL DEFAULT 0, total REAL NOT NULL, cost_price REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_no TEXT NOT NULL UNIQUE,
  bill_no TEXT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  date TEXT NOT NULL,
  taxable REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  other_charges REAL NOT NULL DEFAULT 0,
  round_off REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  notes TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL, rate REAL NOT NULL, discount_pct REAL NOT NULL DEFAULT 0,
  taxable REAL NOT NULL, tax_rate REAL NOT NULL DEFAULT 0, tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL, unit_cost REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS grn (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grn_no TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  cargo_name TEXT, bale_no TEXT, lr_no TEXT,
  india_rate REAL NOT NULL DEFAULT 1,
  cargo_charge REAL NOT NULL DEFAULT 0,
  other_expenses REAL NOT NULL DEFAULT 0,
  charges_basis TEXT NOT NULL DEFAULT 'per_piece' CHECK (charges_basis IN ('per_piece','per_grn')),
  total_pcs REAL NOT NULL DEFAULT 0,
  india_value REAL NOT NULL DEFAULT 0,
  goods_value REAL NOT NULL DEFAULT 0,
  cargo_total REAL NOT NULL DEFAULT 0,
  other_total REAL NOT NULL DEFAULT 0,
  final_total REAL NOT NULL DEFAULT 0,
  notes TEXT,
  cancelled INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_grn_date ON grn(date);
CREATE TABLE IF NOT EXISTS grn_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grn_id INTEGER NOT NULL REFERENCES grn(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  india_cost REAL NOT NULL DEFAULT 0,
  pcs REAL NOT NULL DEFAULT 0,
  bundles REAL NOT NULL DEFAULT 0,
  pcs_per_set REAL NOT NULL DEFAULT 0,
  colours INTEGER NOT NULL DEFAULT 0,
  size TEXT,
  expected_price REAL NOT NULL DEFAULT 0,
  base_cost REAL NOT NULL DEFAULT 0,
  final_cost REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  type TEXT NOT NULL,
  ref_id INTEGER, ref_no TEXT,
  unit_cost REAL NOT NULL DEFAULT 0,
  notes TEXT,
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_stock_moves_product ON stock_moves(product_id, id);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  party_type TEXT NOT NULL CHECK (party_type IN ('customer','supplier')),
  party_id INTEGER NOT NULL,
  ref_type TEXT NOT NULL, ref_id INTEGER, ref_no TEXT,
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  narration TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_party ON ledger(party_type, party_id, date);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_no TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  party_type TEXT NOT NULL CHECK (party_type IN ('customer','supplier')),
  party_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  mode TEXT NOT NULL DEFAULT 'cash',
  reference TEXT,
  fc_amount REAL, fc_currency TEXT, fc_rate REAL,
  notes TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  amount REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alloc_sale ON payment_allocations(sale_id);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  mode TEXT NOT NULL DEFAULT 'cash',
  paid_to TEXT,
  notes TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, action TEXT NOT NULL, entity TEXT, entity_id INTEGER, details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;

db.exec(SCHEMA);
db.prepare("INSERT INTO settings(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SCHEMA_VERSION);

const DEFAULT_SETTINGS = {
  company_name: 'My Textiles (Pvt) Ltd',
  company_tagline: 'Wholesale Dealers in Indian Textiles & Garments',
  company_address: 'No. 1, Main Street',
  company_city: 'Colombo 11',
  company_br_no: '',
  company_vat_no: '',
  company_phone: '',
  company_email: '',
  bank_details: '',
  invoice_prefix: 'INV',
  invoice_terms: '1. Goods once sold will not be taken back or exchanged.\n2. Cheques should be drawn in favour of the company.\n3. E. & O.E.',
  currency_symbol: 'Rs.',
  tax_enabled: '0',
  tax_name: 'VAT',
  default_tax_rate: '18',
  prices_include_tax: '0',
  round_off: '0',
  default_price_list: 'wholesale',
  print_format: 'a4',
  allow_negative_stock: '0',
  grn_india_rate: '3.5',
  grn_other_expenses: '0',
  grn_charges_basis: 'per_piece'
};

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return s;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value == null ? '' : String(value));
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(pw), salt, 64);
  const buf = Buffer.from(hash, 'hex');
  return buf.length === test.length && crypto.timingSafeEqual(buf, test);
}

/* Financial year label (Sri Lanka: April–March): 2026-10-07 -> "26-27" */
function fyLabel(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

/* Sequential document numbers per prefix per financial year: INV/26-27/00001 */
function nextNumber(prefix, date) {
  const fy = fyLabel(date);
  const key = `${prefix}/${fy}`;
  db.prepare('INSERT INTO counters(key, value) VALUES(?, 0) ON CONFLICT(key) DO NOTHING').run(key);
  db.prepare('UPDATE counters SET value = value + 1 WHERE key = ?').run(key);
  const { value } = db.prepare('SELECT value FROM counters WHERE key = ?').get(key);
  return `${prefix}/${fy}/${String(value).padStart(5, '0')}`;
}

/* Run fn inside a transaction (nested calls reuse the outer transaction). */
let txDepth = 0;
function tx(fn) {
  if (txDepth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  txDepth++;
  try {
    const result = fn();
    txDepth--;
    db.exec('COMMIT');
    return result;
  } catch (e) {
    txDepth--;
    db.exec('ROLLBACK');
    throw e;
  }
}

/* Small query helpers that convert undefined -> null and null-prototype rows -> plain objects */
const clean = (args) => args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a));
const plain = (r) => (r ? { ...r } : r);
const q = {
  all: (sql, ...args) => db.prepare(sql).all(...clean(args)).map(plain),
  get: (sql, ...args) => plain(db.prepare(sql).get(...clean(args))),
  run: (sql, ...args) => db.prepare(sql).run(...clean(args)),
  val: (sql, ...args) => {
    const r = db.prepare(sql).get(...clean(args));
    return r ? Object.values(r)[0] : null;
  }
};

function audit(userId, action, entity, entityId, details) {
  q.run('INSERT INTO audit_log(user_id, action, entity, entity_id, details) VALUES(?,?,?,?,?)',
    userId, action, entity, entityId, details ? JSON.stringify(details) : null);
}

function seed() {
  if (!q.val('SELECT COUNT(*) FROM users')) {
    q.run('INSERT INTO users(username, password_hash, name, role) VALUES(?,?,?,?)',
      'admin', hashPassword('admin123'), 'Administrator', 'admin');
    console.log('  Created default login ->  username: admin   password: admin123  (change it after first login)');
  }
  if (!q.val('SELECT COUNT(*) FROM categories')) {
    for (const c of ['Sarees', 'Salwar / Churidar Sets', 'Kurtis & Tops', 'Lehenga / Bridal', 'Gents Shirts', 'Gents Trousers / Dhoti',
      'Kids Wear', 'Fabric (per metre)', 'Dress Materials', 'Shawls & Dupattas']) {
      q.run('INSERT INTO categories(name) VALUES(?)', c);
    }
  }
}
seed();

module.exports = { db, q, tx, DB_FILE, DATA_DIR, getSettings, setSetting, hashPassword, verifyPassword, nextNumber, fyLabel, audit, DEFAULT_SETTINGS };
