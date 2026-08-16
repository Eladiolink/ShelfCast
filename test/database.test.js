'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-test-'));
const config = require('../src/config/config.js');
config.DATA_DIR = tmpDir;
config.DATABASE_PATH = path.join(tmpDir, 'library.db');

const db = require('../src/database/db.js');
const {
  serverRepo, mediaRepo, movieRepo, seriesRepo, seasonRepo, episodeRepo,
  genreRepo, personRepo, metadataCacheRepo, jobRepo, historyRepo,
} = require('../src/database/repositories.js');

before(() => { db.open(); });
after(() => { db.close(); });

test('upsert de servidor', () => {
  const s = serverRepo.upsert({
    uuid: 'uuid:test-1', name: 'Servidor Teste', manufacturer: 'Acme', model: 'X1',
    ip: '192.168.1.10', port: 5000, description_url: 'http://x/device.xml',
    control_url: '/ctl', event_sub_url: '/sub', services: '[]', icon_url: null, status: 'online',
  });
  assert.ok(s.id);
  const got = serverRepo.get(s.id);
  assert.equal(got.name, 'Servidor Teste');
  assert.equal(serverRepo.count(), 1);
});

test('upsert e busca de mídia', () => {
  const s = serverRepo.list()[0];
  const id = mediaRepo.upsert({
    server_id: s.id, object_id: 'm1', parent_id: null, title: 'The Matrix', type: 'video',
    media_type: 'video', url: 'http://192.168.1.10/m.mkv', duration: 5400, format: 'mkv',
    video_codec: 'H.264', width: 1920, height: 1080, resolution: '1080p', year: 1999,
    season: null, episode: null, metadata_status: 'none', last_seen: new Date().toISOString(),
  });
  const m = mediaRepo.get(id);
  assert.equal(m.title, 'The Matrix');
  assert.equal(m.resolution, '1080p');

  // idempotente (mesmo object_id)
  const id2 = mediaRepo.upsert({ ...m, title: 'The Matrix 2' });
  assert.equal(id2, id);
});

test('listagem com busca por texto', () => {
  const res = mediaRepo.list({ search: 'matrix' });
  assert.ok(res.total >= 1);
});

test('movie repo', () => {
  const s = serverRepo.list()[0];
  const id = mediaRepo.upsert({
    server_id: s.id, object_id: 'mv1', title: 'Inception', type: 'video', media_type: 'video',
    url: 'http://x/i.mp4', year: 2010, resolution: '4K', last_seen: new Date().toISOString(),
  });
  movieRepo.upsert({ media_item_id: id, title: 'Inception', year: 2010, rating: 8.8, overview: 'Sonhos', poster_path: null, backdrop_path: null, release_date: '2010-07-16', metadata_source: 'tmdb' });
  const mv = movieRepo.byMediaItem(id);
  assert.equal(mv.rating, 8.8);
  const list = movieRepo.list({});
  assert.ok(list.items.some((x) => x.title === 'Inception'));
});

test('série, temporada e episódio', () => {
  const s = serverRepo.list()[0];
  const eid = mediaRepo.upsert({
    server_id: s.id, object_id: 'bb-s1e1', title: 'Breaking.Bad.S01E01.mkv', type: 'video', media_type: 'video',
    url: 'http://x/bb.mkv', season: 1, episode: 1, last_seen: new Date().toISOString(),
  });
  const sid = seriesRepo.upsert({ title: 'Breaking Bad', year: 2008, rating: 9.5, overview: null, poster_path: null, backdrop_path: null, status: 'Ended', metadata_source: 'tvmaze', metadata_ref: '1', media_item_id: eid });
  const seasonId = seasonRepo.upsert({ series_id: sid, season_number: 1, title: 'Season 1', overview: null, poster_path: null });
  episodeRepo.upsert({ series_id: sid, season_id: seasonId, episode_number: 1, title: 'Pilot', overview: null, rating: 9, air_date: '2008-01-20', media_item_id: eid });

  const episodes = episodeRepo.forSeason(seasonId);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].title, 'Pilot');
  assert.equal(episodeRepo.byMediaItem(eid).series_id, sid);
});

test('gêneros e pessoas', () => {
  const s = serverRepo.list()[0];
  const id = mediaRepo.upsert({
    server_id: s.id, object_id: 'g1', title: 'Filme G', type: 'video', media_type: 'video',
    url: 'http://x/g.mp4', last_seen: new Date().toISOString(),
  });
  genreRepo.setForMedia(id, ['Ação', 'Drama']);
  personRepo.setForMedia(id, ['Ator Um', 'Atriz Dois'], 'actor');
  assert.deepEqual(genreRepo.all().sort(), ['Ação', 'Drama']);
  const people = personRepo.forMedia(id);
  assert.equal(people.length, 2);
});

test('cache de metadados', () => {
  metadataCacheRepo.set('movie:matrix', 'movie', { title: 'The Matrix' });
  const c = metadataCacheRepo.get('movie:matrix');
  assert.equal(JSON.parse(c.data).title, 'The Matrix');
});

test('jobs e progresso', () => {
  const id = jobRepo.create({ type: 'library-scan', server_id: null, total: 100 });
  jobRepo.progress(id, 50, 100);
  const j = jobRepo.get(id);
  assert.equal(j.progress, 50);
  jobRepo.finish(id, 'success');
  assert.equal(jobRepo.get(id).status, 'success');
});

test('histórico de reprodução upsert', () => {
  const s = serverRepo.list()[0];
  const id = mediaRepo.upsert({
    server_id: s.id, object_id: 'h1', title: 'Hist', type: 'video', media_type: 'video',
    url: 'http://x/h.mp4', last_seen: new Date().toISOString(),
  });
  historyRepo.save({ media_item_id: id, position: 100, duration: 1000, finished: 0 });
  historyRepo.save({ media_item_id: id, position: 200, duration: 1000, finished: 0 });
  const h = historyRepo.get(id);
  assert.equal(h.position, 200);
  assert.equal(historyRepo.list().length, 1);
});

test('markMissing', () => {
  const s = serverRepo.list()[0];
  const id = mediaRepo.upsert({
    server_id: s.id, object_id: 'keep1', title: 'Fica', type: 'video', media_type: 'video',
    url: 'http://x/f.mp4', last_seen: new Date().toISOString(),
  });
  mediaRepo.upsert({
    server_id: s.id, object_id: 'gone1', title: 'Some', type: 'video', media_type: 'video',
    url: 'http://x/s.mp4', last_seen: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
  });
  const removed = mediaRepo.markMissing(s.id, ['keep1']);
  assert.equal(removed, 1);
  assert.equal(mediaRepo.get(id).type, 'video');
});
