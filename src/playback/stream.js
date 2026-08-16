'use strict';

const http = require('node:http');
const https = require('node:https');
const { spawn } = require('node:child_process');
const config = require('../config/config.js');
const logger = require('../config/logger.js');
const { mediaRepo, serverRepo, historyRepo, metadataCacheRepo } = require('../database/repositories.js');

const log = logger.child({ module: 'playback' });

const TEXT_SUB_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text', 'eia_608', 'eia_708']);
const IMAGE_SUB_CODECS = new Set(['hdmv_pgs_subtitle', 'pgssub', 'dvd_subtitle', 'dvdsub', 'dvb_subtitle', 'xsub', 'vobsub']);

function isSafeUrl(raw) {
  try {
    const u = new URL(raw);
    return (u.protocol === 'http:' || u.protocol === 'https:');
  } catch {
    return false;
  }
}

/**
 * Faz proxy de uma URL remota (servidor DLNA) para o cliente, suportando Range.
 * Retorna um objeto com pipe/response ou lança erro.
 */
function streamDirect({ res, url, headers = {}, range }) {
  return new Promise((resolve, reject) => {
    if (!isSafeUrl(url)) return reject(new Error('URL de mídia inválida'));
    const mod = url.startsWith('https') ? https : http;
    const upstreamHeaders = {
      'User-Agent': 'MediaLibrary/1.0',
      Accept: '*/*',
      ...headers,
    };
    if (range) upstreamHeaders.Range = range;

    const req = mod.request(url, { method: 'GET', headers: upstreamHeaders, timeout: config.HTTP_TIMEOUT }, (upstream) => {
      if (upstream.statusCode === 302 || upstream.statusCode === 301) {
        if (upstream.headers.location) {
          req.destroy();
          return streamDirect({ res, url: new URL(upstream.headers.location, url).toString(), headers, range }).then(resolve, reject);
        }
        upstream.resume();
        return reject(new Error(`Servidor DLNA redirecionou sem location (${upstream.statusCode})`));
      }
      if (upstream.statusCode >= 400) {
        upstream.resume();
        return reject(new Error(`Servidor DLNA respondeu HTTP ${upstream.statusCode}`));
      }
      res.statusCode = upstream.statusCode || 200;
      for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
      }
      res.setHeader('Cache-Control', 'no-cache');
      upstream.pipe(res);
      upstream.on('error', (err) => {
        log.warn('erro no stream upstream', { err: err.message });
        try { res.destroy(); } catch { /* já fechado */ }
        reject(err);
      });
      res.on('close', () => { req.destroy(); });
      resolve({ proxied: true, statusCode: upstream.statusCode });
    });
    req.on('timeout', () => { req.destroy(new Error('Timeout no streaming')); });
    req.on('error', (err) => reject(err));
    req.end();
  });
}

function mimeFor(format) {
  const f = normalizeFormat(format);
  const map = {
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime',
    mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo',
    mpg: 'video/mpeg', mpeg: 'video/mpeg', ts: 'video/mp2t',
    m2ts: 'video/mp2t', wmv: 'video/x-ms-wmv', flv: 'video/x-flv',
    ogv: 'video/ogg', ogg: 'video/ogg',
  };
  return map[f] || 'video/mp4';
}

function normalizeFormat(format) {
  const f = String(format || '').toLowerCase();
  const map = { 'x-matroska': 'mkv', 'matroska': 'mkv', 'x-msvideo': 'avi', 'x-ms-wmv': 'wmv', 'x-flv': 'flv', 'mp2t': 'ts', 'quicktime': 'mov' };
  return map[f] || f;
}

function canDirectPlay(media, acceptHeader = '') {
  const format = normalizeFormat(media.format);
  const mime = (media.mime_type || '').toLowerCase();
  // Áudio direto
  const audioOk = mime.startsWith('audio/') || ['mp3', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'wav'].includes(format);
  if (audioOk) return true;
  // Formatos de vídeo que os navegadores reproduzem nativamente
  const directVideo = ['mp4', 'm4v', 'mov', 'webm', 'ogv', 'ogg'];
  if (directVideo.includes(format)) return true;
  if (mime.includes('mp4') || mime.includes('webm') || mime.includes('quicktime')) return true;
  // Qualquer outro (mkv, avi, wmv, mpeg...) → remux/transcode
  return false;
}

function probeWithFfmpeg(url, ffprobePath) {
  return new Promise((resolve) => {
    const args = ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name:format=format_name,duration', '-of', 'json', url];
    let out = '';
    let err = '';
    let child;
    try {
      child = spawn(ffprobePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      return resolve(null);
    }
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', () => resolve(null));
    child.on('close', () => {
      try {
        const info = JSON.parse(out);
        resolve(info);
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * Sonda as streams (áudio/vídeo/legenda) de uma URL via ffprobe.
 * Retorna um array com índice absoluto, codec e idioma de cada faixa.
 */
function probeStreams(url) {
  return new Promise((resolve) => {
    const ffprobePath = config.FFPROBE_PATH || 'ffprobe';
    const args = ['-v', 'error', '-show_entries', 'stream=index,codec_type,codec_name,channels:stream_tags=language,title', '-of', 'json', url];
    let out = '';
    let child;
    try {
      child = spawn(ffprobePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      return resolve([]);
    }
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', () => {});
    child.on('error', () => resolve([]));
    child.on('close', () => {
      try {
        const info = JSON.parse(out);
        resolve((info.streams || []).map((s) => ({
          index: s.index,
          type: s.codec_type,
          codec: s.codec_name,
          channels: s.channels ?? null,
          language: (s.tags && (s.tags.language || s.tags.title)) || null,
          title: (s.tags && s.tags.title) || null,
        })));
      } catch {
        resolve([]);
      }
    });
  });
}

/**
 * Lista as faixas de áudio e legenda de uma mídia (com cache de 24h).
 * Retorna { audio: [...], subtitles: [...] }.
 */
async function getTracks(media) {
  if (!media || !media.url || !isSafeUrl(media.url)) return { audio: [], subtitles: [] };
  const cacheKey = `tracks:${media.id}`;
  const cached = metadataCacheRepo.get(cacheKey);
  if (cached && cached.fetched_at) {
    const age = Date.now() - new Date(cached.fetched_at).getTime();
    if (!Number.isNaN(age) && age < 24 * 3600 * 1000) {
      try { return JSON.parse(cached.data); } catch { /* re-probe */ }
    }
  }
  const streams = await probeStreams(media.url);
  const codecSet = (codec) => String(codec || '').toLowerCase();
  const audio = streams.filter((s) => s.type === 'audio').map((s) => ({
    index: s.index,
    codec: s.codec,
    channels: s.channels,
    language: s.language || null,
  }));
  const subtitles = streams.filter((s) => s.type === 'subtitle').map((s) => ({
    index: s.index,
    codec: s.codec,
    language: s.language || null,
    kind: TEXT_SUB_CODECS.has(codecSet(s.codec)) ? 'text' : IMAGE_SUB_CODECS.has(codecSet(s.codec)) ? 'image' : 'other',
  }));
  const result = { audio, subtitles };
  try { metadataCacheRepo.set(cacheKey, 'tracks', result); } catch { /* sem cache */ }
  return result;
}

/**
 * Converte/remuxa via FFmpeg: lê da URL do servidor DLNA e envia para o cliente.
 * mode='remux'  -> copia codecs (rápido, ideal para MKV H.264)
 * mode='full'   -> re-encoda com libx264 + aac (lento, para codecs incompatíveis)
 */
function streamTranscode({ res, media, range, mode = 'remux', audioIndex = null, start = null }) {
  return new Promise((resolve, reject) => {
    const { url } = media;
    if (!config.FFMPEG_PATH) return reject(new Error('FFmpeg não configurado'));
    const args = ['-hide_banner', '-loglevel', 'error'];

    // Início do stream em segundos (seek por parâmetro explícito, usado ao
    // trocar faixa de áudio/retomar — streams remux não são seekable no cliente).
    const startSec = start != null && start > 0 ? parseFloat(start) : 0;
    if (startSec > 0) args.push('-ss', String(startSec));

    args.push('-i', url);

    // Com seek (start > 0) NÃO dá para usar "-c:v copy": o vídeo começa no
    // keyframe anterior ao ponto de seek, enquanto o áudio re-encodado começa
    // no ponto exato → dessincroniza. Re-encoda o vídeo para seek preciso e
    // A/V sincronizado.
    const effectiveMode = startSec > 0 ? 'full' : mode;

    const audioMap = audioIndex != null && audioIndex !== '' ? `0:${audioIndex}` : '0:a:0?';

    if (effectiveMode === 'full') {
      args.push(
        '-map', '0:v:0', '-map', audioMap, '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
        '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', '-'
      );
    } else {
      // Remux: copia o vídeo (rápido), mas re-encoda o áudio para AAC estéreo.
      // MKVs costumam trazer DTS/AC3/EAC3/TrueHD/FLAC, que o Chromium do Electron
      // não decodifica — com "-c copy" o vídeo tocaria sem som.
      args.push(
        '-map', '0:v:0', '-map', audioMap, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', '-'
      );
    }

    let child;
    try {
      child = spawn(config.FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return reject(err);
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Accept-Ranges', 'none');

    child.stdout.pipe(res);
    child.stderr.on('data', (d) => {
      const s = d.toString();
      if (/error|not found|invalid/i.test(s) && config.LOG_LEVEL === 'debug') log.debug('ffmpeg stderr', { s: s.slice(0, 500) });
    });
    child.on('error', (err) => reject(err));
    res.on('close', () => {
      try { child.kill('SIGKILL'); } catch { /* ok */ }
    });
    child.on('close', () => resolve({ proxied: true, mode }));
  });
}

/**
 * Converte uma legenda para WebVTT e envia ao cliente.
 * streamIndex: índice absoluto da stream embutida (0:N) ou null para URL externa.
 * externalUri: URL de legenda externa (SRT/ASS) fornecida pelo DLNA.
 */
function streamSubtitle({ res, media, streamIndex = null, externalUri = null }) {
  return new Promise((resolve, reject) => {
    if (!config.FFMPEG_PATH) return reject(new Error('FFmpeg não configurado'));
    const src = externalUri || media.url;
    if (!isSafeUrl(src) && !externalUri) return reject(new Error('URL de mídia inválida'));
    const args = ['-hide_banner', '-loglevel', 'error', '-i', src];
    if (streamIndex != null) args.push('-map', `0:${streamIndex}`);
    args.push('-c:s', 'webvtt', '-f', 'webvtt', 'pipe:1');

    let child;
    try {
      child = spawn(config.FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return reject(err);
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    child.stdout.pipe(res);
    child.stderr.on('data', () => {});
    child.on('error', (err) => reject(err));
    res.on('close', () => {
      try { child.kill('SIGKILL'); } catch { /* ok */ }
    });
    child.on('close', () => resolve({ proxied: true }));
  });
}

/**
 * Endpoint principal de streaming.
 * transcode: 'remux' | 'full' | undefined (auto: direct ou remux)
 * audio: índice absoluto da faixa de áudio (0:N)
 * start: início do stream em segundos (para retomar/seek em streams transcodificados)
 */
async function handleStream(req, res, { id, transcode, range, audio, start }) {
  const media = mediaRepo.get(id);
  if (!media) return { status: 404, body: 'Mídia não encontrada' };
  if (!media.url || !isSafeUrl(media.url)) return { status: 400, body: 'Mídia sem URL válida' };

  try {
    if (transcode === 'full') {
      await streamTranscode({ res, media, range, mode: 'full', audioIndex: audio, start });
      return null;
    }
    if (transcode === 'remux') {
      await streamTranscode({ res, media, range, mode: 'remux', audioIndex: audio, start });
      return null;
    }
    if (canDirectPlay(media, req.headers.accept)) {
      await streamDirect({ res, url: media.url, headers: {}, range });
      return null;
    }
    if (config.ENABLE_TRANSCODE) {
      // Formato que o navegador não reproduz: remux rápido primeiro
      await streamTranscode({ res, media, range, mode: 'remux', audioIndex: audio, start });
      return null;
    }
    return { status: 415, body: 'Formato não suportado pelo navegador e transcoding desativado' };
  } catch (err) {
    if (!res.headersSent) {
      return { status: 502, body: `Falha no streaming: ${err.message}` };
    }
    try { res.destroy(); } catch { /* ok */ }
    return null;
  }
}

function saveProgress({ mediaItemId, position, duration, finished }) {
  historyRepo.save({ media_item_id: mediaItemId, position: position || 0, duration: duration || 0, finished: finished ? 1 : 0 });
}

module.exports = { handleStream, streamDirect, streamTranscode, streamSubtitle, getTracks, probeStreams, probeWithFfmpeg, canDirectPlay, mimeFor, saveProgress, isSafeUrl };
