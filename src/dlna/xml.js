'use strict';

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

function decodeEntities(str) {
  return String(str).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, m) => {
    if (m[0] === '#') {
      const code = m[1] === 'x' ? parseInt(m.slice(2), 16) : parseInt(m.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[m] ?? m;
  });
}

function stripNamespace(name) {
  const i = name.indexOf(':');
  return i === -1 ? name : name.slice(i + 1);
}

function parseAttributes(attrStr) {
  const attrs = {};
  const re = /([a-zA-Z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? '');
  }
  return attrs;
}

/**
 * Parses XML into a simple tree.
 * Node: { name, attrs, children: [], text }
 */
function parse(xml) {
  if (typeof xml !== 'string' || !xml.trim()) return null;
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<(\/?)([a-zA-Z_][\w:.-]*)((?:\s+[a-zA-Z_][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]*)/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    if (m[0] === '') {
      // Evita loop infinito em match vazio (fim de string)
      const { lastIndex } = re;
      if (lastIndex <= m.index) re.lastIndex = m.index + 1;
      continue;
    }
    if (m[3] !== undefined) {
      // elemento (abertura ou fechamento) — m[2]=slash, m[3]=nome, m[4]=attrs, m[5]=self-close
      const closing = m[2] === '/';
      const name = stripNamespace(m[3]);
      if (closing) {
        if (stack.length > 1) stack.pop();
      } else {
        const node = { name, attrs: parseAttributes(m[4] || ''), children: [], text: '' };
        const parent = stack[stack.length - 1];
        parent.children.push(node);
        if (m[5] !== '/') stack.push(node);
      }
    } else if (m[6] !== undefined && m[6].length) {
      const text = decodeEntities(m[6]);
      if (stack[stack.length - 1] && text.trim()) {
        stack[stack.length - 1].text += text;
      }
    } else if (m[1] !== undefined) {
      // CDATA
      if (stack[stack.length - 1]) {
        stack[stack.length - 1].text += m[1];
      }
    }
  }
  return root;
}

function find(node, name) {
  if (!node) return null;
  if (node.name === name) return node;
  for (const child of node.children) {
    const r = find(child, name);
    if (r) return r;
  }
  return null;
}

function findAll(node, name) {
  const out = [];
  (function walk(n) {
    if (!n) return;
    if (n.name === name) out.push(n);
    for (const c of n.children) walk(c);
  })(node);
  return out;
}

function findAllByNs(node, localName) {
  const out = [];
  (function walk(n) {
    if (!n) return;
    if (stripNamespace(n.name) === localName) out.push(n);
    for (const c of n.children) walk(c);
  })(node);
  return out;
}

function children(node, name) {
  if (!node) return [];
  return node.children.filter(c => stripNamespace(c.name) === name);
}

function firstText(node, name) {
  const n = node ? find(node, name) : null;
  return n ? n.text.trim() : null;
}

function firstAttr(node, name) {
  if (!node) return null;
  for (const [k, v] of Object.entries(node.attrs)) {
    if (stripNamespace(k) === name) return v;
  }
  return null;
}

function attrAny(node, names) {
  if (!node) return null;
  const all = { ...node.attrs };
  const out = {};
  for (const [k, v] of Object.entries(all)) out[stripNamespace(k)] = v;
  for (const n of names) {
    if (out[n] !== undefined) return out[n];
  }
  return null;
}

function textOf(node) {
  if (!node) return '';
  let s = node.text || '';
  for (const c of node.children) s += c.children.length ? textOf(c) : (c.text || '');
  return s;
}

module.exports = { parse, find, findAll, findAllByNs, children, firstText, firstAttr, attrAny, textOf, stripNamespace };
