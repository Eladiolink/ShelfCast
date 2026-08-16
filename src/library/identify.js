'use strict';

const RESOLUTIONS = ['2160p', '4k', '1080p', '720p', '480p', '576p', '360p', '240p'];
const CODECS = ['x264', 'h264', 'x265', 'h265', 'hevc', 'av1', 'xvid', 'divx', 'mpeg4', 'vp9'];
const AUDIO_CODECS = ['aac', 'ac3', 'dts', 'mp3', 'flac', 'opus', 'vorbis', 'eac3', 'truehd', 'dts-hd'];
const HDR_TAGS = ['hdr10', 'hdr10+', 'dolby vision', 'dv', 'hlg', 'hdr'];
const SOURCES = ['bluray', 'brrip', 'bdrip', 'webrip', 'web-dl', 'webdl', 'hdtv', 'dvdrip', 'hdtvrip', 'web', 'hdr'];
const OTHER_TAGS = [
  'x265', 'hevc', 'x264', 'h264', 'avc', 'av1', 'aac', 'ac3', 'dts', 'mp3', 'flac',
  'remux', 'repack', 'proper', 'extended', 'unrated', 'directors.cut', 'theatrical',
  'internal', 'hdr10', 'hdr10plus', 'dv', '10bit', '8bit', 'multi', 'dual.audio', 'subs',
  'nordic', 'german', 'french', 'italian', 'spanish', 'english', 'truefrench', 'dubbed',
  '2ch', '5.1', '7.1', '1.0', '2.0', '60fps', '30fps', '24fps', '2160p', '1080p', '720p', '480p', '576p', '4k',
  'dsnp', 'ddp5.1', 'ddp5', 'ddp', 'atmos', 'truehd', 'dts-hd', 'eac3',
  'webdl', 'webrip', 'bluray', 'hdtv', 'hdr', 'uhd', 'sdr', 'amzn', 'hmax',
  'dual', 'dualp', 'vinci', 'yts', 'yify', 'rarbg', 'ettv', 'eztv', 'deflate',
  'vff', 'vostfr', 'multi.audio', 'xvid', 'divx',
  'www', 'bludv', 'fullhd', 'full-hd', 'hdrip', 'hd-rip', 'brrip', 'bdrip', 'web-dl', 'webdl',
  'nf', 'promo', '1xbet', 'bet365', 'casino', 'aposta', 'comercial', 'propaganda', 'dinheiro', 'livre',
];

// Palavras comuns que NÃO devem iniciar um título de filme (títulos iniciados assim são genéricos)
const STOP_TAGS = ['anime', 'ova', 'special', 'omake', 'oped', 'bdbox'];

const JUNK_TITLES = new Set(['trailer', 'untitled', 'sample', 'na', 'unknown', 'video', 'sem titulo', 'sem título']);

function isJunkTitle(title) {
  const t = cleanTag(String(title || ''));
  if (!t) return true;
  if (JUNK_TITLES.has(t)) return true;
  if (/1xbet|bet365|casino|promo|aposta|propaganda|comercial/.test(t)) return true;
  return false;
}

function cleanTag(s) {
  return s.replace(/\./g, ' ').trim().toLowerCase();
}

function detectResolution(filename) {
  const lower = filename.toLowerCase();
  for (const r of RESOLUTIONS) {
    if (new RegExp(`(^|[\\s.\\-_])(?:${r})(?:[\\s.\\-_]|$)`).test(lower)) {
      if (r === '4k') return '4K';
      return r;
    }
  }
  return null;
}

function detectCodec(filename) {
  const lower = filename.toLowerCase();
  for (const c of CODECS) {
    if (new RegExp(`(^|[\\s.\\-_])${c}(?:[\\s.\\-_]|$)`).test(lower)) {
      return c === 'x265' || c === 'hevc' ? 'H.265/HEVC' : c === 'x264' || c === 'h264' ? 'H.264' : c === 'av1' ? 'AV1' : c.toUpperCase();
    }
  }
  return null;
}

function detectAudioCodec(filename) {
  const lower = filename.toLowerCase();
  for (const c of AUDIO_CODECS) {
    if (new RegExp(`(^|[\\s.\\-_])${c}(?:[\\s.\\-_]|$)`).test(lower)) {
      return c.toUpperCase();
    }
  }
  return null;
}

function detectHdr(filename) {
  const lower = filename.toLowerCase();
  return HDR_TAGS.some((t) => lower.includes(t.replace(/[+ ]/g, '.').replace(/\.\./g, '.'))) || HDR_TAGS.some((t) => lower.includes(t)) ? 1 : 0;
}

const EPISODE_PATTERNS = [
  // S01E01, S01E01E02, S01E01-02, s01e01
  { re: /(?:^|[\s.\-_()])(s(\d{1,2})e(\d{1,2})(?:e(\d{1,2}))?)(?:[\s.\-_()]|$)/i, kind: 'se' },
  // 1x05
  { re: /(?:^|[\s.\-_()])((\d{1,2})x(\d{1,3}))(?:[\s.\-_()]|$)/i, kind: 'x' },
  // Season 01 Episode 05
  { re: /(?:^|[\s.\-_()])season[\s._-]*(\d{1,2})[\s._-]*episode[\s._-]*(\d{1,3})(?:[\s.\-_()]|$)/i, kind: 'word' },
  // S01.Ep.05
  { re: /(?:^|[\s.\-_()])(s(\d{1,2})[\s.\-_]*ep[\s.\-_]*(\d{1,3}))(?:[\s.\-_()]|$)/i, kind: 'se' },
  // Episódio 12 (comum em animes), '02 - 12'
  { re: /(?:^|[\s.\-_()])(?:episode|ep|episodio|episódio)[\s._-]*(\d{1,3})(?:[\s.\-_()]|$)/i, kind: 'ep-only' },
  // 02 - 12 (padrão anime: episódio - capítulo) -> season=0? interpretamos como episode 12
  { re: /(?:^|\s)(\d{1,3})\s*-\s*(\d{1,3})(?=[\s.-]|$)/, kind: 'dash' },
  // "Bleach - Thousand Year Blood War - 41 (v2)[H3LL][1080p]" -> episódio final
  { re: /-\s*(\d{1,3})\s*(?:\(v\d+\))?\s*(?=\[|\.|$)/, kind: 'trailing' },
];

const YEAR_RE = /(?:19\d{2}|20\d{2})/;

function parseEpisode(filename) {
  for (const { re, kind } of EPISODE_PATTERNS) {
    const m = re.exec(filename);
    if (!m) continue;
    if (kind === 'se') {
      const season = parseInt(m[2], 10);
      const episode = parseInt(m[3], 10);
      const end = m[4] ? parseInt(m[4], 10) : null;
      return { season, episode, end, matched: m[1] };
    }
    if (kind === 'x') {
      return { season: parseInt(m[2], 10), episode: parseInt(m[3], 10), matched: m[1] };
    }
    if (kind === 'word') {
      return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10), matched: m[0] };
    }
    if (kind === 'ep-only') {
      return { season: null, episode: parseInt(m[1], 10), matched: m[0] };
    }
    if (kind === 'dash') {
      return { season: null, episode: parseInt(m[2], 10), matched: m[0] };
    }
    if (kind === 'trailing') {
      return { season: null, episode: parseInt(m[1], 10), matched: m[0] };
    }
  }
  return null;
}

function extractYear(filename) {
  const m = YEAR_RE.exec(filename);
  return m ? parseInt(m[0], 10) : null;
}

function removeTags(str) {
  let s = str;
  for (const tag of OTHER_TAGS) {
    s = s.replace(new RegExp(`(^|[\\s.\\-_()])${tag}(?:[\\s.\\-_()]|$)`, 'ig'), ' ');
  }
  return s.replace(/\s+/g, ' ').trim();
}

function titleCase(s) {
  const SMALL = new Set(['and', 'of', 'the', 'for', 'a', 'an', 'to', 'on', 'in', 'at', 'or',
    'e', 'de', 'da', 'do', 'das', 'dos', 'o', 'os', 'a', 'as', 'em', 'com', 'um', 'uma',
    'na', 'no', 'nas', 'nos', 'por', 'para', 'el', 'la', 'le', 'les', 'il', 'lo', 'los', 'las', 'del', 'al']);
  const words = s.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
  return words.map((w, i) => {
    if (!w) return w;
    const lower = w.toLowerCase();
    if (i > 0 && SMALL.has(lower)) return lower;
    // preserva siglas/acrônimos (já em maiúsculas) e numerais romanos curtos
    if (/^[A-Z0-9]{1,4}$/.test(w) && w === w.toUpperCase()) return w;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
}

/**
 * Normaliza o título de uma mídia para exibição: remove tags de qualidade,
 * codec, fonte, ano, grupos de release e aplica Title Case, deixando apenas
 * o nome real da mídia.
 */
function normalizeTitle(filename) {
  const idf = identifyFilename(filename);
  const base = idf.title || String(filename || '').trim();
  return titleCase(base) || String(filename || '').trim();
}

function removeStopWords(s) {
  return s.replace(/^(anime|ova|special|movie|filme|video)\s+/i, '');
}

/**
 * Normaliza o nome de arquivo de um filme, removendo qualidade, codec, source, ano, etc.
 * Retorna { title, year, quality, codec, audio, hdr, season, episode, type }
 */
function identifyFilename(filename) {
  const base = String(filename || '').replace(/\.[a-z0-9]{2,4}$/i, '');
  const ep = parseEpisode(base);
  const year = extractYear(base);
  const resolution = detectResolution(base);
  const codec = detectCodec(base);
  const audio = detectAudioCodec(base);
  const hdr = detectHdr(base);

  let titleRaw = base;
  let title;

  if (ep) {
    // Remove padrões de episódio do nome
    titleRaw = base.replace(ep.matched, ' ');
    titleRaw = titleRaw.replace(/(?:^|\s)(?:season[\s._-]*\d+|[\s.\-_()]*(?:episode|ep|episodio|episódio)[\s._-]*\d+)(?:[\s.\-_()]|$)/gi, ' ');
  }

  // Remove ano
  titleRaw = titleRaw.replace(new RegExp(`(?:^|[\\s.\\-_()])${year}(?:[\\s.\\-_()]|$)`, 'g'), ' ');
  // Remove resolução
  for (const r of RESOLUTIONS) {
    titleRaw = titleRaw.replace(new RegExp(`(?:^|[\\s.\\-_()])${r}(?:[\\s.\\-_()]|$)`, 'ig'), ' ');
  }
  // Remove grupos de release anexados a codec/source por hífen (ex: "HEVC-The.PunisheR", "x264-RARBG")
  const GROUP_TAGS = '(?:x264|x265|h264|h265|hevc|avc|av1|xvid|divx|web-dl|webdl|webrip|bluray|brrip|bdrip|hdtv|dvdrip|remux|dual|dualp|1080p|720p|2160p|480p|576p|4k|atmos|truehd|dts-hd|ddp5[.]1|ddp5|ddp|eac3|aac|ac3|dts|10bit|8bit|5[.]1|7[.]1|2[.]0)';
  titleRaw = titleRaw.replace(new RegExp(`(?:^|[\\s._-])${GROUP_TAGS}[\\s._]*-[A-Za-z0-9]+(?:[._][A-Za-z0-9]+)*`, 'gi'), ' ');
  // Remove codecs, sources e tags
  const allTags = [...OTHER_TAGS, ...SOURCES];
  for (const tag of allTags) {
    titleRaw = titleRaw.replace(new RegExp(`(?:^|[\\s.\\-_()])${tag}(?:[\\s.\\-_()]|$)`, 'ig'), ' ');
  }
  // Remove grupos de release com números (ex: 210GJI, 1337x)
  titleRaw = titleRaw.replace(/\b\d{1,4}[A-Za-z]{2,}\b/g, ' ');

  title = removeStopWords(removeTags(titleRaw))
    .replace(/\[[^\]]*\]/g, ' ')       // remove grupos entre colchetes ([H3LL], [1080p], [x264])
    .replace(/\([^)]*\)/g, ' ')        // remove grupos entre parênteses (original), (v2)…
    .replace(/[.\[\]()_-]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  title = title.replace(/^[\s.-]+|[\s.-]+$/g, '');
  title = title.replace(/\s+/g, ' ');

  const type = ep ? 'series' : 'movie';

  return {
    type,
    title,
    titleClean: cleanTag(title),
    year,
    resolution,
    codec,
    audioCodec: audio,
    hdr,
    season: ep ? ep.season : null,
    episode: ep ? ep.episode : null,
    episodeEnd: ep ? ep.end : null,
  };
}

module.exports = { identifyFilename, normalizeTitle, parseEpisode, extractYear, detectResolution, detectCodec, detectAudioCodec, detectHdr, cleanTag, isJunkTitle };
