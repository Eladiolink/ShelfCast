'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config/config.js');
const logger = require('../config/logger.js');

const log = logger.child({ module: 'imagecache' });

function dirFor(kind) {
  return path.join(config.DATA_DIR, kind);
}

function filenameFor(url) {
  const hash = crypto.createHash('sha1').update(url).digest('hex');
  const ext = path.extname(new URL(url).pathname).slice(0, 6) || '.jpg';
  return hash + ext;
}

const { fetchWithTimeout } = require('../metadata/fetch.js');

async function download(url, dest) {
  const res = await fetchWithTimeout(url, {}, 30000);
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar imagem`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

/**
 * Baixa e armazena uma imagem localmente. Retorna o caminho relativo (ex: posters/abc.jpg)
 * ou null em caso de falha. Se já existe, retorna o caminho.
 */
async function getCachedImage(kind, url) {
  if (!url) return null;
  const dir = dirFor(kind);
  fs.mkdirSync(dir, { recursive: true });
  const file = filenameFor(url);
  const full = path.join(dir, file);
  if (fs.existsSync(full)) return `${kind}/${file}`;
  try {
    await download(url, full);
    return `${kind}/${file}`;
  } catch (err) {
    log.debug('falha ao baixar imagem', { kind, url, err: err.message });
    return null;
  }
}

function localPath(relative) {
  if (!relative) return null;
  return path.join(config.DATA_DIR, relative);
}

/**
 * Salva um buffer de imagem (upload local) em disco e retorna o caminho relativo.
 */
function saveImageBuffer(kind, buf, ext = '.jpg') {
  const dir = dirFor(kind);
  fs.mkdirSync(dir, { recursive: true });
  const hash = crypto.createHash('sha1').update(buf).digest('hex');
  const e = String(ext || '.jpg').toLowerCase();
  const file = hash + (e.startsWith('.') ? e : '.' + e);
  const full = path.join(dir, file);
  fs.writeFileSync(full, buf);
  return `${kind}/${file}`;
}

function exists(relative) {
  const p = localPath(relative);
  return p ? fs.existsSync(p) : false;
}

module.exports = { getCachedImage, saveImageBuffer, localPath, exists, dirFor };
