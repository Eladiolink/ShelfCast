'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const config = require('../config/config.js');
const logger = require('../config/logger.js');
const { serverRepo, mediaRepo, stateRepo } = require('../database/repositories.js');
const { walkContainer, classifyResolution } = require('../dlna/contentdirectory.js');
const { identifyFilename, detectHdr, isJunkTitle, normalizeTitle } = require('../library/identify.js');
const { MetadataManager } = require('../metadata/manager.js');

const log = logger.child({ module: 'scanner' });

// Extensões de mídia reconhecidas em pastas locais.
const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.m4v', '.webm', '.ts', '.m2ts', '.mts', '.wmv', '.flv', '.mpg', '.mpeg', '.vob', '.ogv', '.3gp', '.mkv', '.divx']);
const AUDIO_EXTS = new Set(['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wma', '.webm']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif']);
const SKIP_DIRS = new Set(['node_modules', '.git', '@eaDir', '#recycle', '$RECYCLE.BIN', 'Thumbs.db']);

function extFor(file) {
  return path.extname(file).toLowerCase();
}

function mimeForExt(ext) {
  const map = {
    '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm',
    '.ts': 'video/mp2t', '.m2ts': 'video/mp2t', '.mts': 'video/mp2t',
    '.wmv': 'video/x-ms-wmv', '.flv': 'video/x-flv', '.mpg': 'video/mpeg',
    '.mpeg': 'video/mpeg', '.vob': 'video/mpeg', '.ogv': 'video/ogg',
    '.3gp': 'video/3gpp', '.divx': 'video/x-msvideo',
    '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav',
    '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg', '.opus': 'audio/opus', '.wma': 'audio/x-ms-wma',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif',
  };
  return map[ext] || 'application/octet-stream';
}

function probeLocalFile(filePath) {
  return new Promise((resolve) => {
    const args = ['-v', 'error', '-show_entries', 'format=duration,size,format_name:stream=codec_type,codec_name,width,height,channels', '-of', 'json', filePath];
    let out = '';
    let child;
    try {
      child = spawn(config.FFPROBE_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      return resolve(null);
    }
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', () => {});
    child.on('error', () => resolve(null));
    child.on('close', () => {
      try { resolve(JSON.parse(out)); } catch { resolve(null); }
    });
  });
}

/**
 * Gera um thumbnail para um vídeo local com ffmpeg (frame ~10% da duração),
 * salvando em data/thumbnails/. Retorna o caminho relativo (ex: thumbnails/abc.jpg)
 * ou null em caso de falha. Se o arquivo já existe, retorna o caminho direto.
 */
function generateLocalThumbnail(filePath, duration) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha1').update(filePath).digest('hex');
    const rel = `thumbnails/${hash}.jpg`;
    const dest = path.join(config.DATA_DIR, rel);
    if (fs.existsSync(dest)) return resolve(rel);
    const seek = duration ? Math.min(Math.max(duration * 0.1, 0), 600) : 10;
    const args = ['-hide_banner', '-loglevel', 'error', '-ss', String(seek), '-i', filePath,
      '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', '-y', dest];
    let child;
    try {
      child = spawn(config.FFMPEG_PATH, args, { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
      return resolve(null);
    }
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      resolve(code === 0 && fs.existsSync(dest) ? rel : null);
    });
  });
}

/**
 * Copia uma imagem local para data/thumbnails/ (usada como thumbnail de imagens).
 */
function copyImageThumbnail(filePath) {
  const hash = crypto.createHash('sha1').update(filePath).digest('hex');
  const ext = path.extname(filePath).toLowerCase() || '.jpg';
  const rel = `thumbnails/${hash}${ext}`;
  const dest = path.join(config.DATA_DIR, rel);
  if (fs.existsSync(dest)) return rel;
  try {
    fs.copyFileSync(filePath, dest);
    return rel;
  } catch {
    return null;
  }
}

/**
 * Varre uma pasta local (recursivamente) e persiste a mídia encontrada,
 * sondando metadados técnicos com ffprobe e identificando filmes/séries.
 */
async function scanFolder(folderId, { job } = {}) {
  const folder = serverRepo.get(folderId);
  if (!folder) throw new Error('Pasta local não encontrada');
  if (folder.type !== 'local') throw new Error('Fonte não é uma pasta local');
  if (folder.paused) throw new Error('Sincronização pausada para esta pasta');

  const root = folder.path;
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    serverRepo.setStatus(folderId, 'offline', 'Pasta não existe ou não é um diretório');
    throw new Error('Pasta não existe ou não é um diretório');
  }
  serverRepo.setStatus(folderId, 'online');

  const metadata = new MetadataManager();
  const seen = new Set();
  const pendingIdentify = [];
  const stats = { items: 0 };

  const walk = async (dir, depth = 0) => {
    if (depth > 24 || (job && job.isCancelled())) return;
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (job && job.isCancelled()) return;
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = extFor(entry.name);
      const isVideo = VIDEO_EXTS.has(ext);
      const isAudio = AUDIO_EXTS.has(ext);
      const isImage = IMAGE_EXTS.has(ext);
      if (!isVideo && !isAudio && !isImage) continue;

      const rel = path.relative(root, full).split(path.sep).join('/');
      seen.add(rel);

      const probe = await probeLocalFile(full);
      const videoStream = probe && probe.streams && probe.streams.find((s) => s.codec_type === 'video');
      const audioStream = probe && probe.streams && probe.streams.find((s) => s.codec_type === 'audio');
      const format = ext.slice(1);
      const baseName = entry.name.replace(/\.[A-Za-z0-9]{2,4}$/, '');
      const resolution = classifyResolution(videoStream ? videoStream.width : 0, videoStream ? videoStream.height : 0);
      const duration = probe && probe.format && probe.format.duration ? parseFloat(probe.format.duration) : null;
      const thumb = isVideo
        ? await generateLocalThumbnail(full, duration)
        : isImage ? copyImageThumbnail(full) : null;

      const row = {
        server_id: folderId,
        object_id: rel,
        parent_id: path.posix.dirname(rel) || null,
        title: baseName,
        original_title: null,
        type: isVideo ? 'video' : isAudio ? 'audio' : 'image',
        media_type: isVideo ? 'video' : isAudio ? 'audio' : 'other',
        url: null,
        local_path: full,
        duration,
        format,
        video_codec: videoStream ? videoStream.codec_name : null,
        audio_codec: audioStream ? audioStream.codec_name : null,
        width: videoStream ? videoStream.width : null,
        height: videoStream ? videoStream.height : null,
        bitrate: null,
        mime_type: mimeForExt(ext),
        size: probe && probe.format && probe.format.size ? parseInt(probe.format.size, 10) : null,
        thumbnail: thumb,
        season: null,
        episode: null,
        year: null,
        date: null,
        album: null,
        artist: null,
        genre: null,
        description: null,
        resolution: resolution !== 'SD' ? resolution : null,
        hdr: 0,
        audio_channels: audioStream ? audioStream.channels : null,
        subtitles: null,
        last_seen: new Date().toISOString(),
      };

      const id = mediaRepo.upsert(row);
      stats.items++;
      if (job) job.advance();
      if (isVideo && baseName) pendingIdentify.push({ id, title: baseName, mediaItem: mediaRepo.get(id) });
    }
  };

  job.message(`Varrendo ${root}…`);
  await walk(root);

  job.message('Removendo mídias desaparecidas…');
  const removed = mediaRepo.markMissing(folderId, Array.from(seen));

  // Identificação + metadados (mesmo fluxo do scanServer)
  job.message('Identificando filmes, séries e animes…');
  let identified = 0;
  let enriched = 0;
  for (const { id, title } of pendingIdentify) {
    if (job.isCancelled()) break;
    if (isJunkTitle(title)) {
      mediaRepo.setMetadataStatus(id, 'skipped');
      continue;
    }
    const m = mediaRepo.get(id);
    const identify = identifyFilename(m.manual_title || title);
    mediaRepo.updateMetadata(id, {
      normalized_title: normalizeTitle(title),
      season: identify.season ?? undefined,
      episode: identify.episode ?? undefined,
      year: identify.year ?? undefined,
      resolution: identify.resolution || undefined,
      video_codec: identify.codec || undefined,
      audio_codec: identify.audioCodec || undefined,
      hdr: identify.hdr || 0,
    });
    identified++;
    if (config.ENABLE_METADATA) {
      await fetchMetadataForMedia(metadata, m, identify, job);
      enriched++;
    }
  }

  serverRepo.setLastSync(folderId);
  log.info('varredura de pasta local concluída', { folderId, items: stats.items, identified, enriched, removed });
  return { items: stats.items, identified, enriched, removed };
}

async function probeServerOnline(server) {
  try {
    const { probeServer } = require('../dlna/discovery.js');
    const ctl = await probeServer(server);
    return !!ctl;
  } catch {
    return false;
  }
}

async function fetchMetadataForMedia(metadata, mediaItem, identify, job) {
  if (!metadata || !metadata.enabled) return;
  const key = `md:${mediaItem.id}`;
  if (stateRepo.get(key)) return;
  const matched = await metadata.enrich(mediaItem, identify);
  if (matched) stateRepo.set(key, '1');
  job.advance(0); // mantém UI viva
}

/**
 * Escaneia o servidor DLNA (navegação completa) e persiste na biblioteca.
 */
async function scanServer(serverId, { job } = {}) {
  const server = serverRepo.get(serverId);
  if (!server) throw new Error('Servidor não encontrado');
  if (server.paused) throw new Error('Sincronização pausada para este servidor');

  const stats = { items: 0, containers: 0 };
  const metadata = new MetadataManager();
  const seen = new Set();
  const pendingIdentify = [];

  job.message('Conectando ao servidor…');
  serverRepo.setStatus(serverId, 'online');

  const handleItem = async (item) => {
    if (!item.url && !item.objectId) return;
    const mediaType = item.mediaType || (item.isVideo ? 'video' : item.isAudio ? 'audio' : 'other');
    const objectId = item.objectId || `url:${item.url}`;
    seen.add(objectId);

    const baseName = item.title || '';
    const resolution = classifyResolution(item.width, item.height);

    const row = {
      server_id: serverId,
      object_id: item.objectId || `url:${item.url}`,
      parent_id: item.parentId || null,
      title: item.title,
      original_title: item.originalTitle || null,
      type: item.isVideo ? 'video' : item.isAudio ? 'audio' : item.isImage ? 'image' : 'other',
      media_type: mediaType,
      url: item.url,
      duration: item.duration,
      format: item.format || null,
      video_codec: item.videoCodec || null,
      audio_codec: null,
      width: item.width,
      height: item.height,
      bitrate: item.bitrate,
      mime_type: item.mime,
      size: item.size,
      thumbnail: item.thumbnail,
      season: item.season,
      episode: item.episode,
      year: item.year,
      date: item.date,
      album: item.album,
      artist: item.artist,
      genre: item.genre,
      description: item.description,
      resolution: resolution && resolution !== 'SD' ? resolution : null,
      hdr: item.hdr ?? 0,
      audio_channels: item.audioChannels,
      subtitles: item.subtitles ? JSON.stringify(item.subtitles) : null,
      last_seen: new Date().toISOString(),
    };

    const id = mediaRepo.upsert(row);
    job.advance();

    if (item.isVideo && item.title) {
      pendingIdentify.push({ id, title: item.title, mediaItem: mediaRepo.get(id) });
    }
  };

  const handleContainer = () => {
    job.message(`Percorrendo diretórios… (${stats.containers} pastas, ${stats.items} mídias)`);
  };

  await walkContainer(server, '0', {
    onItem: handleItem,
    onContainer: handleContainer,
    cancel: job,
    stats,
    seen,
    maxItems: 100000,
  });

  job.message('Removendo mídias desaparecidas…');
  const removed = mediaRepo.markMissing(serverId, seen.size ? Array.from(seen) : []);
  job.message(`Sincronização: ${stats.items} mídias encontradas, ${removed} removidas`);

  // Identificação + metadados em segundo plano (rate-limited)
  job.message('Identificando filmes, séries e animes…');
  let identified = 0;
  let enriched = 0;

  for (const { id, title } of pendingIdentify) {
    if (job.isCancelled()) break;
    if (isJunkTitle(title)) {
      mediaRepo.setMetadataStatus(id, 'skipped');
      continue;
    }
    const row = mediaRepo.get(id);
    const identify = identifyFilename(row.manual_title || title);
    mediaRepo.updateMetadata(id, {
      normalized_title: normalizeTitle(title),
      season: identify.season ?? undefined,
      episode: identify.episode ?? undefined,
      year: identify.year ?? undefined,
      resolution: identify.resolution || undefined,
      video_codec: identify.codec || undefined,
      audio_codec: identify.audioCodec || undefined,
      hdr: identify.hdr || 0,
    });
    identified++;
    if (config.ENABLE_METADATA) {
      await fetchMetadataForMedia(metadata, row, identify, job);
      enriched++;
    }
  }

  serverRepo.setLastSync(serverId);
  log.info('sincronização concluída', { serverId, items: stats.items, identified, enriched, removed });
  return { items: stats.items, identified, enriched, removed };
}

module.exports = { scanServer, scanFolder, probeServerOnline };
