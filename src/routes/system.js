const fs = require('node:fs');
const path = require('node:path');
const { db, q, tx, getSettings, setSetting, hashPassword, verifyPassword, DB_FILE, DATA_DIR, DEFAULT_SETTINGS, audit } = require('../db');
const { route, fail, createSession, str, required } = require('../app');

const CURRENCIES = ['LKR', 'INR', 'USD', 'EUR', 'GBP', 'CNY', 'AED', 'SGD', 'BDT', 'PKR', 'THB'];
const UNITS = ['PCS', 'SET', 'MTR', 'YDS', 'PRS', 'DOZ', 'BDL', 'ROL', 'KGS', 'BOX', 'NOS'];
const PAYMENT_MODES = ['cash', 'card', 'bank', 'cheque', 'lankaqr', 'credit'];
const EXPENSE_CATEGORIES = ['Rent', 'Salary', 'Electricity', 'Water', 'Transport / Delivery', 'Cargo / Courier (not linked to GRN)', 'Packing Material',
  'Telephone / Internet', 'Repairs & Maintenance', 'Bank Charges', 'Office Expenses', 'Advertising', 'Travel (India buying trips)', 'Other'];

/* ---------- Auth ---------- */
route('POST', '/api/auth/login', 'public', ({ body, res }) => {
  required(body, 'username', 'password');
  const u = q.get('SELECT * FROM users WHERE username = ?', body.username.trim());
  if (!u || !u.active || !verifyPassword(body.password, u.password_hash)) fail(401, 'Invalid username or password');
  const token = createSession(u.id);
  res.setHeader('Set-Cookie', `erp_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 12}`);
  audit(u.id, 'login', 'user', u.id);
  return { user: { id: u.id, username: u.username, name: u.name, role: u.role } };
});

route('POST', '/api/auth/logout', null, ({ user, res }) => {
  q.run('DELETE FROM sessions WHERE token = ?', user.token);
  res.setHeader('Set-Cookie', 'erp_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
});

route('GET', '/api/auth/me', null, ({ user }) => ({
  user: { id: user.id, username: user.username, name: user.name, role: user.role }
}));

route('POST', '/api/auth/change-password', null, ({ user, body }) => {
  required(body, 'old_password', 'new_password');
  if (String(body.new_password).length < 6) fail(400, 'New password must be at least 6 characters');
  const u = q.get('SELECT * FROM users WHERE id = ?', user.id);
  if (!verifyPassword(body.old_password, u.password_hash)) fail(400, 'Current password is incorrect');
  q.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(body.new_password), user.id);
  q.run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', user.id, user.token);
});

/* ---------- Meta (dropdown lists) ---------- */
route('GET', '/api/meta', null, () => {
  const s = getSettings();
  return {
    currencies: CURRENCIES, units: UNITS, payment_modes: PAYMENT_MODES,
    expense_categories: EXPENSE_CATEGORIES,
    categories: q.all('SELECT * FROM categories ORDER BY name'),
    settings: s
  };
});

/* ---------- Settings ---------- */
route('GET', '/api/settings', ['admin', 'manager'], () => getSettings());
route('PUT', '/api/settings', ['admin'], ({ body, user }) => {
  tx(() => {
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in body) setSetting(k, body[k]);
  });
  audit(user.id, 'update', 'settings', null);
  return getSettings();
});

/* ---------- Users ---------- */
route('GET', '/api/users', ['admin'], () =>
  q.all('SELECT id, username, name, role, active, created_at FROM users ORDER BY id'));

route('POST', '/api/users', ['admin'], ({ body, user }) => {
  required(body, 'username', 'name', 'role', 'password');
  if (String(body.password).length < 6) fail(400, 'Password must be at least 6 characters');
  if (!['admin', 'manager', 'cashier'].includes(body.role)) fail(400, 'Invalid role');
  const r = q.run('INSERT INTO users(username, password_hash, name, role) VALUES(?,?,?,?)',
    body.username.trim(), hashPassword(body.password), body.name.trim(), body.role);
  audit(user.id, 'create', 'user', r.lastInsertRowid);
  return { id: r.lastInsertRowid };
});

route('PUT', '/api/users/:id', ['admin'], ({ params, body, user }) => {
  const id = Number(params.id);
  const u = q.get('SELECT * FROM users WHERE id = ?', id);
  if (!u) fail(404, 'User not found');
  if (id === user.id && (body.active === false || body.active === 0 || (body.role && body.role !== 'admin'))) {
    fail(400, 'You cannot deactivate or demote your own account');
  }
  q.run('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?',
    str(body.name) || u.name, body.role || u.role, body.active == null ? u.active : (body.active ? 1 : 0), id);
  if (body.password) {
    if (String(body.password).length < 6) fail(400, 'Password must be at least 6 characters');
    q.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(body.password), id);
    q.run('DELETE FROM sessions WHERE user_id = ?', id);
  }
  if (body.active === false || body.active === 0) q.run('DELETE FROM sessions WHERE user_id = ?', id);
  audit(user.id, 'update', 'user', id);
});

/* ---------- Audit log ---------- */
route('GET', '/api/audit', ['admin'], ({ query }) =>
  q.all(`SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.id DESC LIMIT ?`, Math.min(Number(query.limit) || 300, 2000)));

/* ---------- Backup / Restore ---------- */
route('GET', '/api/backup', ['admin'], ({ res, user }) => {
  const file = path.join(DATA_DIR, `backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const buf = fs.readFileSync(file);
  fs.unlinkSync(file);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="erp-backup-${stamp}.db"`,
    'Content-Length': buf.length
  });
  res.end(buf);
  audit(user.id, 'backup', 'system', null);
});

/* Automatic daily backup copy kept inside data/backups (last 30). */
function autoBackup() {
  try {
    const dir = path.join(DATA_DIR, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const name = `auto-${new Date().toISOString().slice(0, 10)}.db`;
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) {
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      const files = fs.readdirSync(dir).filter((f) => f.startsWith('auto-')).sort();
      while (files.length > 30) fs.unlinkSync(path.join(dir, files.shift()));
    }
  } catch (e) {
    console.error('Auto backup failed:', e.message);
  }
}
autoBackup();
setInterval(autoBackup, 60 * 60 * 1000).unref();

route('GET', '/api/system/info', ['admin'], () => ({
  db_file: DB_FILE,
  db_size: fs.statSync(DB_FILE).size,
  backups_dir: path.join(DATA_DIR, 'backups'),
  counts: {
    products: q.val('SELECT COUNT(*) FROM products'),
    customers: q.val('SELECT COUNT(*) FROM customers'),
    suppliers: q.val('SELECT COUNT(*) FROM suppliers'),
    sales: q.val('SELECT COUNT(*) FROM sales'),
    grns: q.val('SELECT COUNT(*) FROM grn WHERE cancelled = 0')
  }
}));


