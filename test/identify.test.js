'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { identifyFilename, parseEpisode, detectResolution, extractYear, cleanTag } = require('../src/library/identify.js');

test('identifica episódio S01E01', () => {
  const r = identifyFilename('Breaking.Bad.S01E01.720p.mkv');
  assert.equal(r.type, 'series');
  assert.equal(r.season, 1);
  assert.equal(r.episode, 1);
  assert.match(r.title, /breaking bad/i);
  assert.equal(r.resolution, '720p');
});

test('identifica episódio 1x05', () => {
  const r = identifyFilename('The.Wire.1x05.1080p.mkv');
  assert.equal(r.type, 'series');
  assert.equal(r.season, 1);
  assert.equal(r.episode, 5);
});

test('identifica episódio "Season 01 Episode 05"', () => {
  const r = identifyFilename('Stranger Things Season 01 Episode 05.mp4');
  assert.equal(r.season, 1);
  assert.equal(r.episode, 5);
});

test('identifica padrão "02 - 12" (anime)', () => {
  const r = identifyFilename('Naruto 02 - 12.720p.mkv');
  assert.equal(r.episode, 12);
  assert.equal(r.type, 'series');
});

test('identifica episódio final estilo fansub "Bleach - ... - 41"', () => {
  const r = identifyFilename('Bleach - Thousand Year Blood War - 41 (v2)[H3LL][1080p]');
  assert.equal(r.type, 'series');
  assert.equal(r.episode, 41);
  assert.match(r.title, /Bleach/i);
  assert.doesNotMatch(r.title, /H3LL|1080p/);
});

test('identifica filme com ano e qualidade', () => {
  const r = identifyFilename('The.Matrix.1999.1080p.BluRay.x264.mkv');
  assert.equal(r.type, 'movie');
  assert.equal(r.year, 1999);
  assert.equal(r.resolution, '1080p');
  assert.equal(r.codec, 'H.264');
  assert.match(r.title, /the matrix/i);
});

test('extrai ano', () => {
  assert.equal(extractYear('Inception.2010.4K.mkv'), 2010);
  assert.equal(extractYear('The Matrix (1999)'), 1999);
  assert.equal(extractYear('No year here'), null);
});

test('detecta resolução 4K', () => {
  assert.equal(detectResolution('Inception.2010.4K.HDR.mkv'), '4K');
  assert.equal(detectResolution('movie.2160p.mkv'), '2160p');
});

test('detecta HDR', () => {
  const r = identifyFilename('Dune.2021.4K.HDR.mkv');
  assert.equal(r.hdr, 1);
  const s = identifyFilename('Dune.2021.1080p.mkv');
  assert.equal(s.hdr, 0);
});

test('parseEpisode reconhece S01E01 e retorna null para filme', () => {
  assert.deepEqual(parseEpisode('Show.S01E02.mkv'), { season: 1, episode: 2, end: null, matched: 'S01E02' });
  assert.equal(parseEpisode('The.Matrix.1999.mkv'), null);
});

test('cleanTag normaliza', () => {
  assert.equal(cleanTag('Breaking.Bad'), 'breaking bad');
});
