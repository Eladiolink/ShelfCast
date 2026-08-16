'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const config = require('../config/config.js');
const logger = require('../config/logger.js');
const { mediaRepo, serverRepo, historyRepo, metadataCacheRepo } = require('../database/repositories.js');

const log = logger.child({ module: 'playback' });

const TEXT_SUB_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text', 'eia_608', 'eia_708']);
const IMAGE_SUB_CODECS = new Set(['hdmv_pgs_subtitle', 'pgssub', 'dvd_subtitle', 'dvdsub', 'dvb_subtitle', 'xsub', 'vobsub']);

// Codecs de áudio que o Chromium/Electron decodifica nativamente e podem ser
// copiados sem re-encode (perda zero).
const COPY_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus']);

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
    mp3: 'audio/mpeg', flac: 'audio/flac', wav: 'audio/wav',
    m4a: 'audio/mp4', aac: 'audio/aac', oga: 'audio/ogg', opus: 'audio/opus',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  };
  return map[f] || 'video/mp4';
}

/**
 * Serve um arquivo local (pasta do computador) com suporte a Range.
 */
function streamLocalFile({ res, filePath, range }) {
  return new Promise((resolve, reject) => {
    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) return reject(new Error('Arquivo local não encontrado'));
      const total = stat.size;
      let start = 0;
      let end = total - 1;
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (m) {
          if (m[1]) start = parseInt(m[1], 10);
          if (m[2]) end = Math.min(parseInt(m[2], 10), total - 1);
          if (!m[1] && m[2]) start = Math.max(0, total - parseInt(m[2], 10)); // suffix
        }
        if (start >= total) {
          res.statusCode = 416;
          res.setHeader('Content-Range', `bytes */${total}`);
          return res.end();
        }
      }
      const chunksize = end - start + 1;
      res.statusCode = range ? 206 : 200;
      res.setHeader('Content-Type', mimeFor(pathExt(filePath)));
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunksize);
      res.setHeader('Cache-Control', 'no-cache');
      if (range) res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      const stream = fs.createReadStream(filePath, { start, end });
      stream.on('error', (e) => { try { res.destroy(); } catch { /* ok */ } reject(e); });
      res.on('close', () => { try { stream.destroy(); } catch { /* ok */ } });
      stream.pipe(res);
      resolve({ proxied: true, statusCode: res.statusCode });
    });
  });
}

function pathExt(filePath) {
  const dot = String(filePath || '').lastIndexOf('.');
  return dot >= 0 ? String(filePath).slice(dot + 1) : '';
}

/**
 * Fonte real de uma mídia: caminho local (quando existe) ou URL remota.
 */
function sourceOf(media) {
  return media && media.local_path ? media.local_path : (media ? media.url : null);
}

function normalizeFormat(format) {
  const f = String(format || '').toLowerCase();
  const map = { 'x-matroska': 'mkv', 'matroska': 'mkv', 'x-msvideo': 'avi', 'x-ms-wmv': 'wmv', 'x-flv': 'flv', 'mp2t': 'ts', 'quicktime': 'mov' };
  return map[f] || f;
}

/**
 * Monta os argumentos de codificação de áudio do FFmpeg com a melhor qualidade
 * possível: copia codecs já suportados (AAC/MP3/Opus) e, para os demais
 * (DTS/AC3/EAC3/TrueHD/FLAC), re-encoda para AAC preservando os canais e com
 * bitrate proporcional (192k estéreo, 384k 3-5ch, 512k 5.1).
 */
function buildAudioArgs(audioInfo) {
  const codec = String((audioInfo && audioInfo.codec) || '').toLowerCase();
  if (COPY_AUDIO_CODECS.has(codec)) {
    return ['-c:a', 'copy'];
  }
  const ch = audioInfo && audioInfo.channels
    ? Math.min(Math.max(parseInt(audioInfo.channels, 10), 1), 6)
    : 2;
  const bitrate = ch >= 6 ? 512 : ch >= 3 ? 384 : ch === 2 ? 192 : 128;
  return ['-c:a', 'aac', '-b:a', `${bitrate}k`, '-ac', String(ch)];
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

// ---- Aceleração de hardware (transcode full de 4K/HEVC) ----
let hwEncoderPromise = null;

const HW_ENCODER = { qsv: 'h264_qsv', nvenc: 'h264_nvenc', vaapi: 'h264_vaapi' };

function detectHwEncoder() {
  if (hwEncoderPromise) return hwEncoderPromise;
  const forced = String(config.HW_ACCEL || 'auto').toLowerCase();
  hwEncoderPromise = new Promise((resolve) => {
    if (forced === 'none') return resolve(null);
    const child = spawn(config.FFMPEG_PATH, ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => resolve(null));
    child.on('close', () => {
      const preferred = forced !== 'auto' ? [forced] : ['qsv', 'nvenc', 'vaapi'];
      for (const name of preferred) {
        const enc = HW_ENCODER[name];
        if (enc && out.includes(enc)) return resolve(name);
      }
      resolve(null);
    });
  });
  return hwEncoderPromise;
}

function hwInputArgs(hw) {
  if (hw === 'qsv') return ['-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv'];
  if (hw === 'nvenc') return ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'];
  if (hw === 'vaapi') return ['-vaapi_device', '/dev/dri/renderD128', '-hwaccel', 'vaapi', '-hwaccel_output_format', 'vaapi'];
  return [];
}

function hwVideoArgs(hw) {
  if (hw === 'qsv') return ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-q', '20'];
  if (hw === 'nvenc') return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '20', '-b:v', '0'];
  if (hw === 'vaapi') return ['-c:v', 'h264_vaapi', '-qp', '20'];
  return [];
}

// Converte 10-bit/HDR para 8-bit NV12 (com tone mapping HDR->SDR no QSV) antes
// de codificar — o h264_qsv não aceita P010 (10-bit) e precisa de NV12.
// Nota: use ':' (opções do vpp_qsv) e não ',' (que invocaria o filtro tonemap de software).
function hwVideoFilter(hw) {
  if (hw === 'qsv') return ['-vf', 'vpp_qsv=format=nv12:tonemap=1'];
  if (hw === 'nvenc') return ['-vf', 'scale_cuda=format=nv12'];
  if (hw === 'vaapi') return ['-vf', 'scale_vaapi=format=nv12'];
  return [];
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
  const src = sourceOf(media);
  if (!media || !src) return { audio: [], subtitles: [], video: null };
  if (!media.local_path && !isSafeUrl(src)) return { audio: [], subtitles: [], video: null };
  const cacheKey = `tracks:v2:${media.id}`;
  const cached = metadataCacheRepo.get(cacheKey);
  if (cached && cached.fetched_at) {
    const age = Date.now() - new Date(cached.fetched_at).getTime();
    if (!Number.isNaN(age) && age < 24 * 3600 * 1000) {
      try { return JSON.parse(cached.data); } catch { /* re-probe */ }
    }
  }
  const streams = await probeStreams(src);
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
  const videoStream = streams.find((s) => s.type === 'video');
  const result = { audio, subtitles, video: videoStream ? { codec: videoStream.codec, codecName: videoStream.codec } : null };
  try { metadataCacheRepo.set(cacheKey, 'tracks', result); } catch { /* sem cache */ }
  return result;
}

/**
 * Converte/remuxa via FFmpeg: lê da URL do servidor DLNA e envia para o cliente.
 * mode='remux'  -> copia codecs (rápido, ideal para MKV H.264)
 * mode='full'   -> re-encoda com libx264 + aac (lento, para codecs incompatíveis)
 */
function streamTranscode({ res, media, range, mode = 'remux', audioIndex = null, start = null, audioInfo = null }) {
  const url = sourceOf(media);
  if (!url) return Promise.reject(new Error('Mídia sem fonte'));
  if (!config.FFMPEG_PATH) return Promise.reject(new Error('FFmpeg não configurado'));

  const startSec = start != null && start > 0 ? parseFloat(start) : 0;
  const effectiveMode = startSec > 0 ? 'full' : mode;
  const audioMap = audioIndex != null && audioIndex !== '' ? `0:${audioIndex}` : '0:a:0?';
  const audioArgs = buildAudioArgs(audioInfo);
  const mp4Args = ['-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', '-'];

  const buildArgs = (hw) => {
    const args = ['-hide_banner', '-loglevel', 'error'];
    if (startSec > 0) args.push('-ss', String(startSec));

    if (effectiveMode === 'full') {
      if (hw) args.push(...hwInputArgs(hw));
      args.push('-i', url, '-map', '0:v:0', '-map', audioMap);
      if (hw) {
        args.push(...hwVideoFilter(hw));
        args.push(...hwVideoArgs(hw));
      } else {
        args.push('-c:v', 'libx264', '-preset', 'faster', '-crf', '18', '-pix_fmt', 'yuv420p');
      }
      args.push(...audioArgs, ...mp4Args);
    } else {
      // Remux: copia o vídeo (rápido, sem perda). O áudio é copiado quando
      // compatível (AAC/MP3/Opus) ou re-encodado para AAC multicanal quando não.
      args.push('-i', url, '-map', '0:v:0', '-map', audioMap, '-c:v', 'copy', ...audioArgs, ...mp4Args);
    }
    return args;
  };

  return new Promise((resolve, reject) => {
    let headersSent = false;
    const spawnFfmpeg = (args, isHw) => {
      let child;
      try {
        child = spawn(config.FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        return reject(err);
      }
      if (!headersSent) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Accept-Ranges', 'none');
        headersSent = true;
      }

      let wrote = false;
      child.stdout.on('data', (d) => { if (d && d.length) wrote = true; });
      child.stdout.pipe(res);
      child.stderr.on('data', (d) => {
        const s = d.toString();
        if (/error|not found|invalid/i.test(s) && config.LOG_LEVEL === 'debug') log.debug('ffmpeg stderr', { s: s.slice(0, 500) });
      });
      child.on('error', (err) => reject(err));
      res.on('close', () => {
        try { child.kill('SIGKILL'); } catch { /* ok */ }
      });
      child.on('close', (code) => {
        // Se o encoder por hardware falhou antes de produzir qualquer dado,
        // tenta novamente com software (libx264).
        if (isHw && code !== 0 && !wrote) {
          log.warn('transcode por hardware falhou, caindo para software', { code });
          spawnFfmpeg(buildArgs(null), false);
          return;
        }
        resolve({ proxied: true, mode });
      });
    };

    if (effectiveMode === 'full' && config.ENABLE_HW_TRANSCODE) {
      detectHwEncoder().then((hw) => spawnFfmpeg(buildArgs(hw), !!hw)).catch(() => spawnFfmpeg(buildArgs(null), false));
    } else {
      spawnFfmpeg(buildArgs(null), false);
    }
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
    const src = externalUri || sourceOf(media);
    if (!src) return reject(new Error('Mídia sem fonte'));
    if (!externalUri && !media.local_path && !isSafeUrl(src)) return reject(new Error('URL de mídia inválida'));
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
 * Descobre o codec/canais da faixa de áudio selecionada e o codec de vídeo.
 * Usa o cache de 24h do getTracks; retorna valores nulos se a sondagem falhar.
 */
async function mediaInfoFor(media, audioIndex) {
  try {
    const tracks = await getTracks(media);
    const list = (tracks && tracks.audio) || [];
    let audioInfo = null;
    if (audioIndex != null) {
      audioInfo = list.find((a) => a.index === audioIndex) || null;
    }
    if (!audioInfo) audioInfo = list[0] || null;
    const videoCodec = tracks && tracks.video ? tracks.video.codec : null;
    return { audioInfo, videoCodec };
  } catch {
    return { audioInfo: null, videoCodec: null };
  }
}

/**
 * Chromium/Electron não decodifica HEVC (H.265); nesses casos o remux (-c:v copy)
 * resultaria em tela preta. Detecta se o codec de vídeo exige re-encode.
 * Usa o codec sondado e, como fallback, o codec inferido do nome do arquivo.
 */
function videoNeedsTranscode(videoCodec, mediaCodec) {
  const c = String(videoCodec || mediaCodec || '').toLowerCase();
  if (!c) return false;
  return /hevc|h\.?265|x265/.test(c);
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
  const src = sourceOf(media);
  if (!src) return { status: 400, body: 'Mídia sem URL válida' };
  if (media.local_path && (!fs.existsSync(media.local_path) || !fs.statSync(media.local_path).isFile())) {
    return { status: 404, body: 'Arquivo local não encontrado' };
  }
  if (!media.local_path && !isSafeUrl(src)) return { status: 400, body: 'Mídia sem URL válida' };

  try {
    if (transcode === 'full') {
      const { audioInfo } = await mediaInfoFor(media, audio);
      await streamTranscode({ res, media, range, mode: 'full', audioIndex: audio, start, audioInfo });
      return null;
    }
    if (transcode === 'remux') {
      const { audioInfo, videoCodec } = await mediaInfoFor(media, audio);
      const mode = videoNeedsTranscode(videoCodec, media.video_codec) ? 'full' : 'remux';
      await streamTranscode({ res, media, range, mode, audioIndex: audio, start, audioInfo });
      return null;
    }
    if (canDirectPlay(media, req.headers.accept) && !videoNeedsTranscode(null, media.video_codec)) {
      if (media.local_path) {
        await streamLocalFile({ res, filePath: media.local_path, range });
      } else {
        await streamDirect({ res, url: media.url, headers: {}, range });
      }
      return null;
    }
    if (config.ENABLE_TRANSCODE) {
      // Formato que o navegador não reproduz: remux rápido (se codec compatível)
      // ou transcode completo (ex.: HEVC, que daria tela preta no Chromium).
      const { audioInfo, videoCodec } = await mediaInfoFor(media, audio);
      const mode = videoNeedsTranscode(videoCodec, media.video_codec) ? 'full' : 'remux';
      await streamTranscode({ res, media, range, mode, audioIndex: audio, start, audioInfo });
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

module.exports = { handleStream, streamDirect, streamLocalFile, streamTranscode, streamSubtitle, getTracks, probeStreams, probeWithFfmpeg, canDirectPlay, mimeFor, sourceOf, saveProgress, isSafeUrl };
