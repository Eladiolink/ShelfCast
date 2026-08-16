#!/usr/bin/env node
'use strict';

const config = require('./config/config.js');
const logger = require('./config/logger.js');
const db = require('./database/db.js');
const { JobManager } = require('./jobs/job.js');
const { createServer } = require('./server.js');
const { runDiscovery, startPersistentListener } = require('./dlna/discovery.js');
const { scanServer } = require('./library/scanner.js');
const { serverRepo, mediaRepo } = require('./database/repositories.js');

const log = logger.child({ module: 'main' });

async function start() {
  config.ensureDirs();
  db.open();

  const jobs = new JobManager({ maxConcurrent: 2 });
  const metadata = null; // instanciado por demanda no router

  const server = createServer({ jobs, metadata });
  server.listen(config.PORT, config.HOST, () => {
    log.info('Media Library iniciada', { url: `http://${config.HOST}:${config.PORT}` });
    console.log('');
    console.log('  ┌─────────────────────────────────────────┐');
    console.log('  │            Media Library                │');
    console.log(`  │                                         │`);
    console.log(`  │  Acesse: http://localhost:${config.PORT}          │`);
    console.log('  │                                         │');
    console.log('  └─────────────────────────────────────────┘');
    console.log('');
  });

  // ---- Jobs de inicialização ----
  jobs.create({ type: 'discovery' }).run(async (job) => {
    job.message('Descobrindo servidores DLNA na rede…');
    const added = await runDiscovery();
    job.setTotal(added);
    job.advance(added);
    job.finish('success');
  });

  // Sincronização inicial dos servidores conhecidos e habilitados
  const initial = serverRepo.list(true);
  if (initial.length) {
    for (const s of initial) {
      jobs.create({ type: 'library-scan', serverId: s.id }).run((job) => scanServer(s.id, { job }));
    }
  } else {
    log.info('nenhum servidor configurado ainda; aguardando descoberta');
  }

  // ---- Sincronização periódica ----
  setInterval(() => {
    for (const s of serverRepo.list(true)) {
      if (s.paused) continue;
      jobs.create({ type: 'library-scan', serverId: s.id }).run((job) => scanServer(s.id, { job }));
    }
  }, config.SCAN_INTERVAL_MS).unref();

  // ---- Descoberta periódica ----
  setInterval(async () => {
    await runDiscovery().catch((err) => log.warn('descoberta periódica falhou', { err: err.message }));
  }, config.DISCOVERY_INTERVAL_MS).unref();

  // ---- Listener persistente (NOTIFY + M-SEARCH recorrente) ----
  // Importante em redes onde o roteador bloqueia multicast: captura anúncios
  // ssdp:alive e re-sonda a rede continuamente.
  const listener = startPersistentListener({ intervalMs: config.DISCOVERY_INTERVAL_MS });

  // ---- Verificação de conectividade periódica ----
  setInterval(async () => {
    const { probeServerOnline } = require('./library/scanner.js');
    for (const s of serverRepo.list(true)) {
      const online = await probeServerOnline(s).catch(() => false);
      if (online && s.status !== 'online') serverRepo.setStatus(s.id, 'online');
      else if (!online && s.status === 'online') serverRepo.setStatus(s.id, 'offline', 'Servidor sem resposta');
    }
  }, 5 * 60 * 1000).unref();

  const shutdown = (signal) => {
    log.info('encerrando', { signal });
    try { listener.stop(); } catch { /* ok */ }
    server.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => log.error('exceção não capturada', { err: err.stack || err.message }));
  process.on('unhandledRejection', (err) => log.error('promise rejeitada não capturada', { err: err.message }));
}

start().catch((err) => {
  console.error('Falha ao iniciar a aplicação:', err.message);
  log.error('falha na inicialização', { err: err.stack || err.message });
  process.exit(1);
});
