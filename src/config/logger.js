'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('../config/config.js');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const levelValue = LEVELS[config.LOG_LEVEL] ?? LEVELS.info;

const logDir = path.join(config.DATA_DIR, 'logs');
let logStream = null;

function openStream() {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    logStream = fs.createWriteStream(path.join(logDir, `app-${stamp}.log`), { flags: 'a' });
    logStream.on('error', () => {});
  } catch {
    logStream = null;
  }
}

openStream();

function rotate() {
  const stamp = new Date().toISOString().slice(0, 10);
  const target = path.join(logDir, `app-${stamp}.log`);
  if (logStream && logStream.path !== target) {
    openStream();
  }
}

function write(level, msg, extra) {
  if (LEVELS[level] < levelValue) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(extra && Object.keys(extra).length ? { ...extra } : {}),
  };
  const text = JSON.stringify(line);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(text + '\n');
  } else {
    process.stdout.write(text + '\n');
  }
  if (logStream) {
    rotate();
    logStream.write(text + '\n');
  }
}

const logger = {
  debug: (msg, extra) => write('debug', msg, extra),
  info: (msg, extra) => write('info', msg, extra),
  warn: (msg, extra) => write('warn', msg, extra),
  error: (msg, extra) => write('error', msg, extra),
  child: (defaults) => ({
    debug: (m, e) => write('debug', m, { ...defaults, ...e }),
    info: (m, e) => write('info', m, { ...defaults, ...e }),
    warn: (m, e) => write('warn', m, { ...defaults, ...e }),
    error: (m, e) => write('error', m, { ...defaults, ...e }),
    child: (more) => logger.child({ ...defaults, ...more }),
  }),
};

module.exports = logger;
