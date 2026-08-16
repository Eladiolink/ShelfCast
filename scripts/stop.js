#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const pidFile = path.join(__dirname, '..', 'data', 'server.pid');

let pid = null;
try {
  pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
} catch {
  console.log('Nenhum PID em data/server.pid — o daemon não está rodando.');
  process.exit(0);
}

try {
  process.kill(pid, 'SIGTERM');
  console.log(`Sinal SIGTERM enviado ao daemon (PID ${pid}).`);
} catch (err) {
  if (err.code === 'ESRCH') {
    console.log(`Daemon (PID ${pid}) já não está rodando.`);
  } else {
    console.error('Erro ao encerrar o daemon:', err.message);
    process.exit(1);
  }
}
