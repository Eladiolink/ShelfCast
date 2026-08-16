'use strict';

const config = require('../config/config.js');
const logger = require('../config/logger.js');
const { parse, findAllByNs, children, firstText, attrAny, textOf } = require('./xml.js');
const { resolveUrl } = require('./discovery.js');

const log = logger.child({ module: 'contentdirectory' });

const VIDEO_MIME_PREFIX = ['video/', 'application/vnd.apple.mpegurl', 'application/x-mpegURL'];
const IMAGE_MIME_PREFIX = ['image/'];
const AUDIO_MIME_PREFIX = ['audio/'];
const AUDIO_EXTS = ['mp3', 'flac', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'opus', 'wma'];

function isVideoMime(mime) {
  if (!mime) return false;
  const m = String(mime).toLowerCase();
  return VIDEO_MIME_PREFIX.some(p => m.startsWith(p)) || (!mime && isLikelyVideoExt(m));
}

function isLikelyVideoExt(filename) {
  return /\.(mp4|mkv|avi|webm|mov|m4v|ts|m2ts|mts|wmv|flv|mpeg|mpg|mpe|vob|ogv|3gp)$/i.test(filename);
}

function buildBrowseBody(objectId, startingIndex = 0, requestedCount = 0) {
  const soap =
`<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
      <ObjectID>${escapeXml(objectId)}</ObjectID>
      <BrowseFlag>BrowseDirectChildren</BrowseFlag>
      <Filter>*</Filter>
      <StartingIndex>${startingIndex}</StartingIndex>
      <RequestedCount>${requestedCount}</RequestedCount>
      <SortCriteria></SortCriteria>
    </u:Browse>
  </s:Body>
</s:Envelope>`;
  return soap;
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

async function browse(server, objectId, { startingIndex = 0, requestedCount = 0, timeout = config.HTTP_TIMEOUT } = {}) {
  const base = `http://${server.ip}:${server.port}`;
  let controlUrl = server.control_url;
  if (!controlUrl && server.description_url) {
    const url = resolveUrl(base, server.description_url);
    const { fetchDeviceDescription } = require('./discovery.js');
    const desc = await fetchDeviceDescription(url).catch(() => null);
    if (desc && desc.controlUrl) controlUrl = resolveUrl(base, desc.controlUrl);
  }
  if (!controlUrl) throw new Error('Servidor sem ContentDirectory (controlURL)');

  const url = resolveUrl(base, controlUrl);
  const body = buildBrowseBody(objectId, startingIndex, requestedCount);

  const res = await new Promise((resolve, reject) => {
    const req = require('node:http').request(url, {
      method: 'POST',
      timeout,
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPACTION: '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'MediaLibrary/1.0',
        Accept: '*/*',
      },
    }, (r) => {
      const chunks = [];
      r.on('data', (c) => { chunks.push(c); if (Buffer.concat(chunks).length > 10 * 1024 * 1024) { req.destroy(new Error('Resposta SOAP muito grande')); } });
      r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      r.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error(`Timeout no Browse de ${url}`)); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  if (res.status < 200 || res.status >= 300) {
    const fault = /<faultstring>([^<]+)<\/faultstring>/.exec(res.body);
    throw new Error(`Browse falhou (HTTP ${res.status})${fault ? ': ' + fault[1] : ''}`);
  }

  return parseBrowseResult(res.body, base);
}

function parseBrowseResult(body, base) {
  const root = parse(body);
  const browseRes = root ? findAllByNs(root, 'BrowseResponse')[0] || root : null;
  const resultNode = browseRes ? findAllByNs(browseRes, 'Result')[0] : null;
  const totalNode = browseRes ? findAllByNs(browseRes, 'TotalMatches')[0] : null;
  const numberNode = browseRes ? findAllByNs(browseRes, 'NumberReturned')[0] : null;
  const total = totalNode ? parseInt(totalNode.text.trim(), 10) : null;
  const returnedRaw = numberNode ? parseInt(numberNode.text.trim(), 10) : null;

  let items = [];
  let containers = [];
  if (resultNode) {
    const didl = parse(textOf(resultNode));
    if (didl) {
      items = findAllByNs(didl, 'item').map((el) => parseItem(el, base));
      containers = findAllByNs(didl, 'container').map((el) => parseContainer(el, base));
    }
  }
  return {
    total,
    returned: returnedRaw !== null && returnedRaw !== undefined ? returnedRaw : items.length + containers.length,
    items,
    containers,
  };
}

function getResource(node, base) {
  const res = findAllByNs(node, 'res')[0] || null;
  if (!res) return null;
  let href = res.text.trim();
  if (!href) {
    href = attrAny(res, ['value', 'href']) || '';
  }
  if (!href) return null;
  const resolved = resolveUrl(base, href) || href;
  const attrs = {};
  for (const [k, v] of Object.entries(res.attrs)) {
    const local = k.includes(':') ? k.slice(k.indexOf(':') + 1) : k;
    attrs[local] = v;
  }
  const mime = attrs.protocolInfo ? attrs.protocolInfo.split(':')[2] || null : null;
  return {
    url: resolved,
    protocolInfo: attrs.protocolInfo || null,
    mime: mime,
    size: attrs.size ? parseInt(attrs.size, 10) : null,
    duration: attrs.duration ? parseDuration(attrs.duration) : null,
    resolution: attrs.resolution || null,
    bitrate: attrs.bitrate ? parseInt(attrs.bitrate, 10) : null,
    colorDepth: attrs.colorDepth || null,
    sampleFrequency: attrs.sampleFrequency || null,
    nrAudioChannels: attrs.nrAudioChannels ? parseInt(attrs.nrAudioChannels, 10) : null,
    codec: attrs.codec || null,
  };
}

function parseDuration(dur) {
  // formato HH:MM:SS ou H:MM:SS.mmm
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d+))?$/.exec(String(dur).trim());
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  return h * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
}

function resolutionParts(resolution) {
  if (!resolution) return { width: null, height: null };
  const m = /(\d{3,5})x(\d{3,5})/.exec(resolution);
  if (m) return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
  return { width: null, height: null };
}

function classifyResolution(width, height) {
  const h = Math.max(width || 0, height || 0);
  if (h >= 2160) return '4K';
  if (h >= 1080) return '1080p';
  if (h >= 720) return '720p';
  if (h >= 480) return '480p';
  return 'SD';
}

function mimeToFormat(mime) {
  if (!mime) return null;
  const map = {
    'video/x-matroska': 'mkv',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
    'video/x-ms-wmv': 'wmv',
    'video/x-flv': 'flv',
    'video/mp2t': 'ts',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/mpeg': 'mpeg',
    'video/ogg': 'ogv',
  };
  const key = mime.split(';')[0].trim().toLowerCase();
  return map[key] || key.split('/')[1] || null;
}

function parseItem(el, base) {
  const res = getResource(el, base);
  const title = firstText(el, 'title') || attrAny(el, ['title']) || 'Sem título';
  const mime = res ? res.mime : null;
  const mediaType = mime ? (isVideoMime(mime) ? 'video' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('image/') ? 'image' : 'other') : null;

  const attrs = {};
  for (const [k, v] of Object.entries(el.attrs)) attrs[k.includes(':') ? k.slice(k.indexOf(':') + 1) : k] = v;

  const resInfo = res ? res.resolution : null;
  const dims = resInfo ? resolutionParts(resInfo) : { width: null, height: null };
  const width = attrs.width ? parseInt(attrs.width, 10) : dims.width;
  const height = attrs.height ? parseInt(attrs.height, 10) : dims.height;

  const thumb = (() => {
    const t = attrAny(el, ['art', 'albumArtURI']);
    if (t) return resolveUrl(base, t) || t;
    const art = findAllByNs(el, 'albumArtURI')[0] || findAllByNs(el, 'art')[0];
    return art ? (resolveUrl(base, art.text.trim()) || art.text.trim()) : null;
  })();

  const dateRaw = firstText(el, 'date');
  const year = dateRaw ? parseInt(dateRaw.slice(0, 4), 10) : null;
  const seasonRaw = firstText(el, 'episodeSeason') || attrs.season;
  const episodeRaw = firstText(el, 'episodeNumber') || attrs.episode;

  return {
    objectId: attrs.id || attrs.objectID || null,
    parentId: attrs.parentID || null,
    title,
    mime,
    mediaType,
    url: res ? res.url : null,
    size: res ? res.size : null,
    duration: res ? res.duration : null,
    width,
    height,
    bitrate: res ? res.bitrate : null,
    format: mimeToFormat(mime),
    audioChannels: res ? res.nrAudioChannels : null,
    videoCodec: res ? res.codec : (mime ? null : null),
    thumbnail: thumb,
    date: dateRaw || null,
    year,
    season: seasonRaw ? parseInt(seasonRaw, 10) : null,
    episode: episodeRaw ? parseInt(episodeRaw, 10) : null,
    album: firstText(el, 'album'),
    artist: firstText(el, 'artist'),
    genre: firstText(el, 'genre'),
    description: firstText(el, 'description') || null,
    originalTitle: firstText(el, 'originalTitle') || null,
    subtitles: (() => {
      const caps = findAllByNs(el, 'captionInfo');
      if (caps.length) return caps.map((c) => ({ uri: attrAny(c, ['uri', 'href']) || c.text.trim(), mime: attrAny(c, ['mimeType']) || null }));
      const ext = findAllByNs(el, 'res');
      return ext.filter((e) => /srt|vtt|ass|ssa/i.test(attrAny(e, ['protocolInfo']) || '')).map((e) => ({ uri: resolveUrl(base, e.text.trim()) || e.text.trim(), mime: null }));
    })(),
    isVideo: mediaType === 'video',
    isAudio: mediaType === 'audio',
    isImage: mediaType === 'image',
  };
}

function parseContainer(el, base) {
  const attrs = {};
  for (const [k, v] of Object.entries(el.attrs)) attrs[k.includes(':') ? k.slice(k.indexOf(':') + 1) : k] = v;
  return {
    objectId: attrs.id || attrs.objectID || null,
    parentId: attrs.parentID || null,
    title: firstText(el, 'title') || attrAny(el, ['title']) || 'Sem título',
    childCount: attrs.childCount ? parseInt(attrs.childCount, 10) : null,
    thumb: attrAny(el, ['art', 'albumArtURI']),
    genre: firstText(el, 'genre') || null,
  };
}

/**
 * Navega recursivamente por um container, coletando itens de mídia.
 * Respeita limite de profundidade e paginação.
 */
async function walkContainer(server, objectId, {
  onItem = () => {},
  onContainer = () => {},
  depth = 0,
  maxDepth = 20,
  maxItems = 100000,
  cancel = null,
  stats = null,
  seen = null,
} = {}) {
  if (depth > maxDepth) return 0;
  let totalSeen = 0;
  let start = 0;
  let page;

  do {
    page = await browse(server, objectId, { startingIndex: start, requestedCount: 200 });
    for (const container of page.containers) {
      if (seen && seen.has(`c:${container.objectId}`)) continue;
      if (seen) seen.add(`c:${container.objectId}`);
      onContainer(container);
      if (stats) stats.containers++;
      if (depth + 1 <= maxDepth && totalSeen < maxItems) {
        const sub = await walkContainer(server, container.objectId, {
          onItem, onContainer, depth: depth + 1, maxDepth, maxItems, cancel, stats, seen,
        });
        totalSeen += sub;
      }
    }
    for (const item of page.items) {
      if (totalSeen >= maxItems) break;
      if (item.isVideo || item.isAudio) {
        onItem(item);
        totalSeen++;
        if (stats) stats.items++;
      }
      if (cancel && cancel.isCancelled()) throw new Error('Cancelado pelo usuário');
    }
    start += page.returned || page.items.length + page.containers.length;
    if (stats && stats.dialogs) {
      // página a página sem travar a memória
    }
  } while (page.returned > 0 && start < (page.total ?? Infinity) && totalSeen < maxItems);

  return totalSeen;
}

module.exports = { browse, parseBrowseResult, walkContainer, parseDuration, isVideoMime, classifyResolution, resolutionParts };
