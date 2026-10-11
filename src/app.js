const crypto = require('node:crypto');
const { q } = require('./db');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => { throw new HttpError(status, message); };

const routes = [];
/*
 * route('GET', '/api/products/:id', ['admin','manager'], handler)
 * roles: null = any logged-in user, 'public' = no login needed
 * handler(ctx) -> returns JSON-able value. ctx: { params, query, body, user, req, res }
 */
function route(method, pattern, roles, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, roles, handler });
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function currentUser(req) {
  const token = parseCookies(req.headers.cookie).erp_session || (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!token) return null;
  const s = q.get(`SELECT u.id, u.username, u.name, u.role, u.active, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`, token);
  if (!s || !s.active || s.expires_at < new Date().toISOString()) return null;
  return { id: s.id, username: s.username, name: s.name, role: s.role, token };
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString(); // 12h shift
  q.run('DELETE FROM sessions WHERE expires_at < ?', new Date().toISOString());
  q.run('INSERT INTO sessions(token, user_id, expires_at) VALUES(?,?,?)', token, userId, expires);
  return token;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 20 * 1024 * 1024) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

async function handleApi(req, res, urlObj) {
  const method = req.method;
  const pathname = urlObj.pathname;
  let match = null;
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = pathname.match(r.re);
    if (m) { match = { r, m }; break; }
  }
  try {
    if (!match) fail(404, 'API route not found');
    const { r, m } = match;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    const user = currentUser(req);
    if (r.roles !== 'public') {
      if (!user) fail(401, 'Please log in');
      if (Array.isArray(r.roles) && !r.roles.includes(user.role)) fail(403, 'You do not have permission for this action');
    }
    const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? await readBody(req) : {};
    const query = Object.fromEntries(urlObj.searchParams.entries());
    const result = await r.handler({ params, query, body, user, req, res });
    if (res.writableEnded) return;
    sendJson(res, 200, result === undefined ? { ok: true } : result);
  } catch (e) {
    let status = e.status || 500;
    let message = e.message || 'Server error';
    if (/UNIQUE constraint failed/.test(message)) { status = 409; message = 'Duplicate value: ' + message.split(':').pop().trim() + ' already exists'; }
    else if (/FOREIGN KEY constraint failed/.test(message)) { status = 409; message = 'This record is linked to other records and cannot be changed/deleted'; }
    else if (status === 500) console.error(e);
    if (!res.writableEnded) sendJson(res, status, { error: message });
  }
}

/* Call a route handler internally (used by the demo-data loader). */
function invoke(method, pathname, body, user) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = pathname.match(r.re);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = m[i + 1]; });
    return r.handler({ params, query: {}, body: body || {}, user, req: null, res: { setHeader() {} } });
  }
  throw new Error('No route ' + method + ' ' + pathname);
}

/* Validation helpers */
const num = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const str = (v) => (v == null ? null : String(v).trim() || null);
const required = (obj, ...keys) => {
  for (const k of keys) if (obj[k] == null || String(obj[k]).trim() === '') fail(400, `${k.replace(/_/g, ' ')} is required`);
};
const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const dateOr = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : today());

module.exports = { route, invoke, handleApi, HttpError, fail, createSession, currentUser, num, str, required, today, dateOr, sendJson };
