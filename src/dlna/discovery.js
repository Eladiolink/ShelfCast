'use strict';

const os = require('node:os');
const dgram = require('node:dgram');
const http = require('node:http');
const config = require('../config/config.js');
const logger = require('../config/logger.js');
const { serverRepo } = require('../database/repositories.js');
const { parse, children, find, firstText } = require('./xml.js');

const log = logger.child({ module: 'discovery' });

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;

const TARGETS = [
  'urn:schemas-upnp-org:device:MediaServer:1',
  'urn:schemas-upnp-org:device:MediaServer:2',
  'upnp:rootdevice',
  'ssdp:all',
];

function httpGet(url, timeout = config.HTTP_TIMEOUT) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch { return reject(new Error(`URL inválida: ${url}`)); }
    const req = http.get(parsed, { timeout, headers: { 'User-Agent': 'MediaLibrary/1.0', Accept: '*/*' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => {
        chunks.push(c);
        if (Buffer.concat(chunks).length > 2 * 1024 * 1024) req.destroy(new Error('Resposta muito grande'));
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error(`Timeout ao acessar ${url}`)); });
    req.on('error', reject);
  });
}

function fetchDeviceDescription(location) {
  return httpGet(location).then(async ({ status, body }) => {
    if (status < 200 || status >= 300) throw new Error(`HTTP ${status} ao obter descrição`);
    const root = parse(body);
    const device = (root && (children(root, 'device')[0] || find(root, 'device'))) || root;
    const services = {};
    let controlUrl = null;
    let eventSubURL = null;

    const serviceList = findChild(device, 'serviceList');
    for (const svc of (serviceList ? children(serviceList, 'service') : [])) {
      const type = firstText(svc, 'serviceType') || '';
      const ctl = firstText(svc, 'controlURL') || '';
      const evt = firstText(svc, 'eventSubURL') || '';
      const scpd = firstText(svc, 'SCPDURL') || '';
      if (type.includes('ContentDirectory')) {
        controlUrl = ctl;
        eventSubURL = evt;
      }
      services[type] = { type, controlURL: ctl, eventSubURL: evt, scpdURL: scpd };
    }

    const friendlyName = firstText(device, 'friendlyName') || 'Servidor DLNA';
    const udn = firstText(device, 'UDN') || location;

    return {
      uuid: udn,
      name: friendlyName,
      manufacturer: firstText(device, 'manufacturer') || null,
      model: firstText(device, 'modelName') || firstText(device, 'modelDescription') || null,
      descriptionUrl: location,
      controlUrl,
      eventSubURL,
      services: Object.values(services),
      iconUrl: (() => {
        const iconList = findChild(device, 'iconList');
        if (!iconList) return null;
        const icon = children(iconList, 'icon')[0];
        return icon ? firstText(icon, 'url') : null;
      })(),
    };
  });
}

function findChild(node, name) {
  return node ? children(node, name)[0] : null;
}

function resolveUrl(base, ref) {
  if (!ref) return null;
  try { return new URL(ref, base).toString(); } catch { return null; }
}

function buildMsearch(target) {
  return [
    'M-SEARCH * HTTP/1.1',
    `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
    'MAN: "ssdp:discover"',
    `ST: ${target}`,
    'MX: 3',
    '', '',
  ].join('\r\n');
}

function parseHeaders(text) {
  const headers = {};
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return headers;
}

/**
 * Descobre os intervalos de IP da rede local (sub-redes /24 e /16).
 */
function getSubnets() {
  const subnets = new Set();
  const nets = os.networkInterfaces();
  for (const ifaces of Object.values(nets)) {
    for (const i of ifaces || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      if (!i.netmask) continue;
      const ipParts = i.address.split('.').map(Number);
      const maskParts = i.netmask.split('.').map(Number);
      const bits = maskParts.reduce((a, m) => a + (m.toString(2).match(/1/g) || []).length, 0);
      if (bits < 8 || bits > 30) continue;
      const net = ipParts.map((p, idx) => p & maskParts[idx]).join('.');
      subnets.add(`${net}/${bits}`);
    }
  }
  return Array.from(subnets);
}

function hostsInSubnet(subnet) {
  const [net, bits] = subnet.split('/');
  const b = parseInt(bits, 10);
  const parts = net.split('.').map(Number);
  const hosts = [];
  if (b === 24) {
    for (let i = 1; i < 255; i++) hosts.push(`${parts[0]}.${parts[1]}.${parts[2]}.${i}`);
  } else if (b === 16) {
    for (let i = 0; i < 256; i++) {
      for (let j = 1; j < 255; j++) hosts.push(`${parts[0]}.${parts[1]}.${i}.${j}`);
    }
  } else if (b >= 25 && b <= 30) {
    const hostBits = 32 - b;
    const base = (parts.reduce((a, p, idx) => a + (p << (8 * (3 - idx))), 0) >>> 0);
    const count = 2 ** hostBits;
    for (let i = 1; i < count - 1; i++) {
      const ip = (base + i) >>> 0;
      hosts.push([(ip >>> 24) & 255, (ip >>> 16) & 255, (ip >>> 8) & 255, ip & 255].join('.'));
    }
  }
  return hosts;
}

/**
 * Uma única rodada de descoberta SSDP.
 * Envia M-SEARCH via multicast e broadcast, e opcionalmente varre a sub-rede
 * com M-SEARCH unicast (funciona mesmo quando o roteador bloqueia multicast).
 */
function discoverOnce({ multicast = true, broadcast = true, subnetScan = true, timeoutMs = 6000, onlyHosts = null } = {}) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const results = new Map();
    const seen = new Set();
    const rinfoByLoc = new Map();
    let finished = false;

    const sendTo = (dest, msg) => {
      socket.send(Buffer.from(msg), SSDP_PORT, dest, (err) => {
        if (err) log.debug('ssdp send error', { dest, err: err.message });
      });
    };

    const handleResponse = (msg, rinfo) => {
      const text = msg.toString('utf8');
      const headers = parseHeaders(text);
      const st = headers.st || headers['usn'] || '';
      const location = headers.location;
      if (!st || !location) return;
      const key = location;
      if (seen.has(key)) return;
      seen.add(key);
      // Guarda TODAS as respostas (mesmo não-MediaServer) para diagnóstico/fallback
      results.set(key, { location, st, usn: headers.usn, nts: headers.nts, rinfo });
      rinfoByLoc.set(key, rinfo);
    };

    socket.on('message', handleResponse);
    socket.on('error', (err) => {
      log.warn('ssdp socket error', { err: err.message });
      clearTimeout(timer);
      try { socket.close(); } catch { /* ok */ }
      if (!finished) { finished = true; resolve([]); }
    });

    socket.bind(0, () => {
      socket.setBroadcast(true);
      try { socket.addMembership(SSDP_ADDR); } catch { /* sem multicast */ }

      if (multicast) {
        for (const target of TARGETS) sendTo(SSDP_ADDR, buildMsearch(target));
      }
      if (broadcast) {
        const broadcastHosts = new Set();
        for (const subnet of getSubnets()) {
          const [net, bits] = subnet.split('/');
          const parts = net.split('.').map(Number);
          const b = parseInt(bits, 10);
          if (b === 24) broadcastHosts.add(`${parts[0]}.${parts[1]}.${parts[2]}.255`);
          else if (b === 16) broadcastHosts.add(`${parts[0]}.${parts[1]}.255.255`);
        }
        broadcastHosts.add('255.255.255.255');
        for (const bh of broadcastHosts) {
          for (const target of TARGETS) sendTo(bh, buildMsearch(target));
        }
      }
      if (subnetScan) {
        const hosts = onlyHosts || [];
        if (!hosts.length) {
          for (const subnet of getSubnets()) hosts.push(...hostsInSubnet(subnet));
        }
        const unique = Array.from(new Set(hosts));
        log.debug('varredura unicast da sub-rede', { hosts: unique.length });
        // Usa apenas ST ssdp:all e MediaServer para não sobrecarregar
        for (const host of unique) {
          sendTo(host, buildMsearch('ssdp:all'));
          sendTo(host, buildMsearch('urn:schemas-upnp-org:device:MediaServer:1'));
        }
      }
    });

    const timer = setTimeout(() => {
      try { socket.close(); } catch { /* ok */ }
      if (!finished) {
        finished = true;
        resolve(Array.from(results.entries()).map(([location, r]) => ({ location, ...r, rinfo: rinfoByLoc.get(location) })));
      }
    }, timeoutMs);
  });
}

function looksLikeMediaServer(st) {
  if (!st) return false;
  if (/MediaServer/i.test(st) || /dlna/i.test(st)) return true;
  return false;
}

function toServerRecord(desc, ip, port) {
  const { services, ...rest } = desc;
  return {
    uuid: rest.uuid,
    name: rest.name,
    manufacturer: rest.manufacturer,
    model: rest.model,
    ip,
    port,
    description_url: rest.descriptionUrl,
    control_url: rest.controlUrl,
    event_sub_url: rest.eventSubURL,
    services: services ? JSON.stringify(services) : '[]',
    icon_url: rest.iconUrl,
    status: 'online',
  };
}

async function enrich(entries, { requireContentDirectory = true } = {}) {
  const out = [];
  const tasks = entries.map(async (entry) => {
    try {
      const desc = await fetchDeviceDescription(entry.location);
      const ip = entry.rinfo ? entry.rinfo.address : (() => {
        try { return new URL(entry.location).hostname; } catch { return null; }
      })();
      const port = (() => {
        try { return new URL(entry.location).port || 80; } catch { return 80; }
      })();
      if (requireContentDirectory && !desc.controlUrl) return;
      out.push({ ...desc, ip, port, st: entry.st || null, nts: entry.nts || null });
    } catch (err) {
      log.debug('falha ao obter descrição do dispositivo', { url: entry.location, err: err.message });
    }
  });
  await Promise.all(tasks);
  return out;
}

async function runDiscovery() {
  const logRun = log.child({ run: Date.now() });
  logRun.info('iniciando descoberta DLNA (multicast + broadcast + varredura de sub-rede)');
  const entries = await discoverOnce({ timeoutMs: 8000 });
  logRun.info('dispositivos respondendo ao SSDP', { total: entries.length });
  const servers = await enrich(entries);
  let added = 0;
  for (const s of servers) {
    try {
      const saved = serverRepo.upsert(toServerRecord(s, s.ip, s.port));
      logRun.info('servidor DLNA descoberto', { name: saved.name, ip: saved.ip, port: saved.port });
      added++;
    } catch (err) {
      logRun.error('erro ao salvar servidor descoberto', { name: s.name, err: err.message });
    }
  }
  if (servers.length === 0) logRun.warn('nenhum servidor DLNA encontrado na rede');
  return added;
}

/**
 * Listener persistente: mantém o socket aberto e captura anúncios NOTIFY
 * (ssdp:alive) de dispositivos que entram na rede, além de reenviar M-SEARCH
 * periodicamente. Útil quando o roteador bloqueia multicast: muitos servidores
 * só são vistos via NOTIFY.
 */
function startPersistentListener({ intervalMs = 60000, onServer = null } = {}) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const seenKeys = new Set();
  let stopped = false;

  const processDevice = (location, rinfo) => {
    const key = location;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    fetchDeviceDescription(location)
      .then((desc) => {
        const ip = rinfo ? rinfo.address : (() => { try { return new URL(location).hostname; } catch { return null; } })();
        const port = (() => { try { return new URL(location).port || 80; } catch { return 80; } })();
        const saved = serverRepo.upsert(toServerRecord(desc, ip, port));
        log.info('servidor descoberto via NOTIFY', { name: saved.name, ip, port });
        if (onServer) onServer(saved);
      })
      .catch((err) => log.debug('falha no NOTIFY', { location, err: err.message }));
  };

  socket.on('message', (msg, rinfo) => {
    const text = msg.toString('utf8');
    const headers = parseHeaders(text);
    const nts = headers.nts || '';
    if (!/^NOTIFY/i.test(text)) return;
    if (nts && nts !== 'ssdp:alive') return;
    const location = headers.location;
    if (!location) return;
    processDevice(location, rinfo);
  });

  socket.on('error', (err) => log.warn('listener ssdp error', { err: err.message }));

  socket.bind(0, () => {
    try { socket.addMembership(SSDP_ADDR); } catch { /* ok */ }
    log.info('listener SSDP persistente ativo');
    for (const target of TARGETS) {
      socket.send(Buffer.from(buildMsearch(target)), SSDP_PORT, SSDP_ADDR, () => {});
    }
  });

  const interval = setInterval(() => {
    if (stopped) return;
    for (const target of TARGETS) {
      socket.send(Buffer.from(buildMsearch(target)), SSDP_PORT, SSDP_ADDR, () => {});
    }
  }, intervalMs);
  if (interval.unref) interval.unref();

  return {
    stop() {
      stopped = true;
      clearInterval(interval);
      try { socket.close(); } catch { /* ok */ }
    },
  };
}

/**
 * Adiciona um servidor manualmente, sondando um IP/porta conhecidos.
 * Procura a descrição UPnP em caminhos comuns e também por M-SEARCH unicast.
 */
async function addServerManually(host, port = null) {
  const candidates = [];
  const ports = port ? [port] : [80, 1900, 5000, 8080, 8200, 9000, 49494, 4244];
  for (const p of ports) {
    for (const path of ['/rootDesc.xml', '/rootdesc.xml', '/description.xml', '/DeviceDescription.xml', '/upnp/desc.xml']) {
      candidates.push(`http://${host}:${p}${path}`);
    }
  }

  for (const url of candidates) {
    try {
      const desc = await fetchDeviceDescription(url);
      if (desc.controlUrl) {
        const saved = serverRepo.upsert(toServerRecord(desc, host, new URL(url).port));
        return saved;
      }
    } catch { /* tentar próximo */ }
  }

  // Fallback: M-SEARCH unicast direto ao host
  const entries = await discoverOnce({ multicast: false, broadcast: false, subnetScan: false, onlyHosts: [host], timeoutMs: 4000 });
  const servers = await enrich(entries);
  if (servers.length) {
    const s = servers[0];
    return serverRepo.upsert(toServerRecord(s, s.ip, s.port));
  }
  throw new Error(`Nenhum dispositivo UPnP encontrado em ${host}`);
}

function probeServer(server) {
  const base = `http://${server.ip}:${server.port}`;
  const controlUrl = server.control_url
    ? resolveUrl(base, server.control_url)
    : (async () => {
        const desc = await fetchDeviceDescription(server.description_url).catch(() => null);
        return desc ? resolveUrl(base, desc.controlUrl) : null;
      })();
  return controlUrl;
}

module.exports = {
  runDiscovery,
  discoverOnce,
  fetchDeviceDescription,
  addServerManually,
  startPersistentListener,
  probeServer,
  resolveUrl,
  getSubnets,
  hostsInSubnet,
};
