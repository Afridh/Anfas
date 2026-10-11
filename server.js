/*
 * Textile ERP + POS — server entry point.
 * Zero external dependencies: uses Node.js built-in http + sqlite (Node 22.13+).
 *   Run:  node server.js            (default port 3000)
 *         PORT=8080 node server.js
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { handleApi, sendJson } = require('./src/app');
require('./src/routes/system');
require('./src/routes/masters');
require('./src/routes/sales');
require('./src/routes/purchasing');
require('./src/routes/grn');
require('./src/routes/finance');
require('./src/routes/reports');
require('./src/routes/demo');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json'
};

function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  if (pathname === '/' || !path.extname(file) || !fs.existsSync(file)) {
    if (path.extname(pathname) && pathname !== '/') { res.writeHead(404); return res.end('Not found'); }
    file = path.join(PUBLIC_DIR, 'index.html');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, 'http://localhost');
  if (urlObj.pathname.startsWith('/api/')) {
    handleApi(req, res, urlObj).catch((e) => {
      console.error(e);
      if (!res.writableEnded) sendJson(res, 500, { error: 'Server error' });
    });
  } else {
    serveStatic(req, res, urlObj.pathname);
  }
});

server.listen(PORT, HOST, () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('\n  Textile ERP + POS is running');
  console.log(`  This computer : http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  Shop network  : http://${ip}:${PORT}   (open on other PCs / tablets)`);
  console.log('  Press Ctrl+C to stop.\n');
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Is the ERP already running? Or start with: set PORT=3001 && node server.js`);
  else console.error(e);
  process.exit(1);
});
