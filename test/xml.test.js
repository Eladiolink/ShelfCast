'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parse, children, find, firstText, findAllByNs, textOf } = require('../src/dlna/xml.js');

test('parseia elemento raiz e filhos', () => {
  const xml = '<root xmlns="urn:x"><device><name>Test</name></device></root>';
  const root = parse(xml);
  assert.equal(root.name, '#document');
  const device = children(children(root, 'root')[0], 'device')[0];
  assert.ok(device);
  assert.equal(firstText(device, 'name'), 'Test');
});

test('lida com atributos e namespaces', () => {
  const xml = '<item id="abc" parentID="0" xmlns="urn:x"><dc:title>Título</dc:title></item>';
  const root = parse(xml);
  const item = children(root, 'item')[0];
  assert.equal(item.attrs.id, 'abc');
  assert.equal(item.attrs.parentID, '0');
  assert.equal(firstText(item, 'title'), 'Título');
});

test('processa CDATA e entidades', () => {
  const xml = '<d><![CDATA[texto & especial]]><e>a &amp; b</e></d>';
  const root = parse(xml);
  const d = children(root, 'd')[0];
  assert.match(textOf(d), /texto & especial/);
  assert.match(textOf(d), /a & b/);
});

test('não trava em XML vazio ou inválido', () => {
  assert.equal(parse(''), null);
  const r = parse('<root>');
  assert.ok(r);
  assert.equal(r.children[0].name, 'root');
});

test('find percorre a árvore', () => {
  const xml = '<r><a><b><c>x</c></b></a></r>';
  const root = parse(xml);
  const c = find(root, 'c');
  assert.ok(c);
  assert.equal(c.text.trim(), 'x');
});

test('lida com self-closing tags', () => {
  const xml = '<root><empty/><filled>1</filled></root>';
  const root = parse(xml);
  const r = children(root, 'root')[0];
  assert.equal(r.children.length, 2);
  assert.equal(r.children[0].name, 'empty');
});
