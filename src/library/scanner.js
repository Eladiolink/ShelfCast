'use strict';

const config = require('../config/config.js');
const logger = require('../config/logger.js');
const { serverRepo, mediaRepo, stateRepo } = require('../database/repositories.js');
const { walkContainer, classifyResolution } = require('../dlna/contentdirectory.js');
const { identifyFilename, detectHdr, isJunkTitle, normalizeTitle } = require('../library/identify.js');
const { MetadataManager } = require('../metadata/manager.js');

const log = logger.child({ module: 'scanner' });

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
  await metadata.enrich(mediaItem, identify);
  stateRepo.set(key, '1');
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
    const identify = identifyFilename(title);
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
      const m = mediaRepo.get(id);
      await fetchMetadataForMedia(metadata, m, identify, job);
      enriched++;
    }
  }

  serverRepo.setLastSync(serverId);
  log.info('sincronização concluída', { serverId, items: stats.items, identified, enriched, removed });
  return { items: stats.items, identified, enriched, removed };
}

module.exports = { scanServer, probeServerOnline };
