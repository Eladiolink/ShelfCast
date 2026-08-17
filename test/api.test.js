'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-api-'));
const config = require('../src/config/config.js');
config.DATA_DIR = tmpDir;
config.DATABASE_PATH = path.join(tmpDir, 'library.db');
config.ENABLE_METADATA = false; // sem rede nos testes
config.SCAN_INTERVAL = '9999m';

const db = require('../src/database/db.js');
const { serverRepo, mediaRepo } = require('../src/database/repositories.js');
const { JobManager } = require('../src/jobs/job.js');
const { createServer } = require('../src/server.js');
const { scanServer, scanFolder } = require('../src/library/scanner.js');

let server;
let baseUrl;
let jobs;

function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(baseUrl + p, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(method === 'GET' ? { Range: 'bytes=0-15' } : {}),
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        const ct = res.headers['content-type'] || '';
        const body = ct.includes('json') ? (d ? JSON.parse(d) : null) : d;
        resolve({ status: res.statusCode, body, raw: d, contentType: ct });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

before(async () => {
  db.open();
  jobs = new JobManager({ maxConcurrent: 2 });
  server = createServer({ jobs, metadata: null });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  const s = serverRepo.upsert({
    uuid: 'uuid:mock-1', name: 'Mock', manufacturer: 'M', model: 'X', ip: '127.0.0.1',
    port: 8199, description_url: 'http://127.0.0.1:8199/device.xml', control_url: '/cms/cd',
    event_sub_url: '/sub', services: '[]', icon_url: null, status: 'online',
  });

  // Popula a biblioteca diretamente (sem depender do mock externo nos testes)
  mediaRepo.upsert({
    server_id: s.id, object_id: 'm1', title: 'The.Matrix.1999.1080p.mkv', type: 'video',
    media_type: 'video', url: 'http://127.0.0.1:8199/media/m1', duration: 5400,
    format: 'mkv', video_codec: 'H.264', width: 1920, height: 1080, resolution: '1080p',
    year: 1999, last_seen: new Date().toISOString(),
  });
  mediaRepo.upsert({
    server_id: s.id, object_id: 'bb', title: 'Breaking.Bad.S01E01.mkv', type: 'video',
    media_type: 'video', url: 'http://127.0.0.1:8199/media/bb', duration: 2700,
    format: 'mkv', season: 1, episode: 1, last_seen: new Date().toISOString(),
  });
});

after(() => {
  server.close();
  db.close();
});

test('GET /api/system/info', async () => {
  const r = await req('GET', '/api/system/info');
  assert.equal(r.status, 200);
  assert.ok(r.body.total >= 2);
  assert.equal(r.body.servers, 1);
});

test('GET /api/dashboard', async () => {
  const r = await req('GET', '/api/dashboard');
  assert.equal(r.status, 200);
  assert.ok(r.body.stats.total >= 2);
});

test('GET /api/servers', async () => {
  const r = await req('GET', '/api/servers');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
  assert.equal(r.body[0].name, 'Mock');
});

test('GET /api/media com paginação e busca', async () => {
  const all = await req('GET', '/api/media?perPage=5');
  assert.equal(all.status, 200);
  assert.ok(all.body.total >= 2);

  const search = await req('GET', '/api/media?q=matrix');
  assert.equal(search.status, 200);
  assert.equal(search.body.items.length, 1);
  assert.match(search.body.items[0].title, /matrix/i);
});

test('GET /api/search', async () => {
  const r = await req('GET', '/api/search?q=breaking');
  assert.equal(r.status, 200);
  assert.ok(r.body.items.length >= 1);
});

test('GET /api/media/:id com detalhes', async () => {
  const list = await req('GET', '/api/media?perPage=1');
  const id = list.body.items[0].id;
  const r = await req('GET', `/api/media/${id}`);
  assert.equal(r.status, 200);
  assert.ok(r.body.server);
  assert.ok(r.body.history === null || r.body.history);
});

test('POST /api/media/:id/progress salva histórico', async () => {
  const list = await req('GET', '/api/media?perPage=1');
  const id = list.body.items[0].id;
  const r = await req('POST', `/api/media/${id}/progress`, { position: 100, duration: 1000, finished: false });
  assert.equal(r.status, 200);
  const h = await req('GET', '/api/history');
  assert.ok(h.body.length >= 1);
});

test('GET /api/jobs e filtros', async () => {
  const jobsR = await req('GET', '/api/jobs');
  assert.equal(jobsR.status, 200);
  const filters = await req('GET', '/api/filters');
  assert.equal(filters.status, 200);
  assert.ok(Array.isArray(filters.body.genres));
});

test('rotas desconhecidas retornam 404', async () => {
  const r = await req('GET', '/api/nao-existe');
  assert.equal(r.status, 404);
});

test('servidor serve index.html', async () => {
  const r = await req('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.raw, /ShelfCast/);
});

test('POST /api/servers/local adiciona pasta local e reusa duplicada', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-local-'));
  const r = await req('POST', '/api/servers/local', { path: folder });
  assert.equal(r.status, 200);
  assert.equal(r.body.server.isLocal, true);
  assert.equal(r.body.server.type, 'local');
  assert.equal(r.body.server.path, path.resolve(folder));
  assert.ok(r.body.jobId);

  const dup = await req('POST', '/api/servers/local', { path: folder });
  assert.equal(dup.status, 200);
  assert.equal(dup.body.duplicate, true);

  // Pasta inexistente → 400
  const bad = await req('POST', '/api/servers/local', { path: path.join(os.tmpdir(), 'nao-existe-xyz') });
  assert.equal(bad.status, 400);
});

test('scanFolder varre pasta local e persiste mídia', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-scan-'));
  const sub = path.join(folder, 'Filmes');
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, 'The Matrix 1999 1080p.mkv'), 'fake-video-data');
  fs.writeFileSync(path.join(sub, 'ignored.txt'), 'not media');

  const local = serverRepo.createLocal('LocalTest', folder);
  const job = new (require('../src/jobs/job.js').JobManager)({ maxConcurrent: 1 }).create({ type: 'library-scan', serverId: local.id });
  await job.run((j) => scanFolder(local.id, { job: j }));

  const items = mediaRepo.list({ serverId: local.id, hidden: 'all' }).items;
  assert.ok(items.length >= 1);
  const video = items.find((i) => i.title.includes('Matrix'));
  assert.ok(video, 'arquivo de vídeo deveria ser indexado');
  assert.ok(video.local_path, 'deveria guardar o caminho local');
  assert.match(video.object_id, /Filmes\//);
  assert.equal(video.mime_type, 'video/x-matroska');

  // Sincronização novamente não deve criar duplicatas
  const second = await job.run((j) => scanFolder(local.id, { job: j }));
  const items2 = mediaRepo.list({ serverId: local.id, hidden: 'all' }).items;
  assert.equal(items2.length, items.length);
});
