'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchConfidence, similarity, isLikelyAnime, normalize } = require('../src/metadata/manager.js');

test('similaridade entre títulos', () => {
  assert.equal(similarity('The Matrix', 'The Matrix'), 1);
  assert.ok(similarity('The Matrix', 'The Matrix') > 0.9);
  assert.ok(similarity('Breaking Bad', 'Breaking Bad') === 1);
  assert.ok(similarity('Matrix', 'The Matrix') > 0.5);
  assert.ok(similarity('Matrix', 'Inception') < 0.3);
});

test('confiança alta para correspondência exata', () => {
  const score = matchConfidence(
    { title: 'The Matrix', year: 1999, type: 'movie' },
    { title: 'The Matrix', year: 1999, type: 'movie' },
  );
  assert.ok(score >= 0.9, `score = ${score}`);
});

test('ano correto aumenta confiança, ano errado reduz', () => {
  const rightYear = matchConfidence({ title: 'The Matrix', year: 1999, type: 'movie' }, { title: 'The Matrix', year: 1999, type: 'movie' });
  const wrongYear = matchConfidence({ title: 'The Matrix', year: 1999, type: 'movie' }, { title: 'The Matrix', year: 2003, type: 'movie' });
  assert.ok(rightYear > wrongYear);
});

test('confiança muito baixa retorna 0', () => {
  const score = matchConfidence({ title: 'Alien', year: 1979, type: 'movie' }, { title: 'Barbie', year: 2023, type: 'movie' });
  assert.equal(score, 0);
});

test('detecta títulos de anime', () => {
  assert.equal(isLikelyAnime('One Piece'), true);
  assert.equal(isLikelyAnime('Naruto Shippuden'), true);
  assert.equal(isLikelyAnime('Attack on Titan'), true);
  assert.equal(isLikelyAnime('Breaking Bad'), false);
  assert.equal(isLikelyAnime('The Matrix'), false);
});

test('normalização remove acentos e maiúsculas', () => {
  assert.equal(normalize('João & Maria'), 'joao maria');
  assert.equal(normalize('  Hello World!  '), 'hello world');
});
