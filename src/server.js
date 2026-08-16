'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config/config.js');
const logger = require('./config/logger.js');
const { handleApi } = require('./api/router.js');
const { localPath } = require('./cache/images.js');

const log = logger.child({ module: 'server' });

const PUBLIC_DIR = path.join(config.ROOT, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function safeJoin(base, rel) {
  const full = path.resolve(base, '.' + path.sep + rel.replace(/^\/+/, ''));
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

function serveStatic(req, res, pathname) {
  let rel = pathname;
  if (rel === '/') rel = '/index.html';

  if (rel.startsWith('/data/')) {
    const relFile = rel.slice('/data/'.length);
    const p = localPath(relFile);
    if (!p || !fs.existsSync(p)) {
      res.statusCode = 404;
      return res.end('Not Found');
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[path.extname(p).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return fs.createReadStream(p).pipe(res);
  }

  const file = safeJoin(PUBLIC_DIR, rel);
  if (!file || !fs.existsSync(file)) {
    // SPA fallback: para rotas não-API, entrega o index.html
    if (!rel.includes('.')) {
      const idx = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(idx)) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(fs.readFileSync(idx));
      }
    }
    res.statusCode = 404;
    return res.end('Not Found');
  }

  const isDir = fs.statSync(file).isDirectory();
  if (isDir) {
    const idx = path.join(file, 'index.html');
    if (fs.existsSync(idx)) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(fs.readFileSync(idx));
    }
    res.statusCode = 403;
    return res.end('Forbidden');
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-cache');
  return fs.createReadStream(file).pipe(res);
}

function createServer({ jobs, metadata }) {
  const server = http.createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Accept');
      return res.end();
    }

    if (url.pathname.startsWith('/api/')) {
      handleApi(req, res, { jobs, metadata, app: server })
        .catch((err) => {
          log.error('erro na API', { path: url.pathname, err: err.message });
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Erro interno: ' + err.message }));
          }
        });
      return;
    }

    serveStatic(req, res, url.pathname);
  });

  server.requestTimeout = 0;
  server.headersTimeout = 60000;
  if (config.SOCKET_TIMEOUT > 0) server.timeout = config.SOCKET_TIMEOUT;

  return server;
}

module.exports = { createServer };
