'use strict';

const path = require('node:path');
const fs = require('node:fs');
const config = require('../config/config.js');
const logger = require('../config/logger.js');
const db = require('../database/db.js');
const {
  serverRepo, mediaRepo, movieRepo, seriesRepo, episodeRepo,
  genreRepo, personRepo, jobRepo, historyRepo, metadataCacheRepo, parseServices,
} = require('../database/repositories.js');
const { runDiscovery, addServerManually, fetchDeviceDescription, discoverOnce } = require('../dlna/discovery.js');
const { scanServer, scanFolder, probeServerOnline } = require('../library/scanner.js');
const { MetadataManager, matchConfidence, isLikelyAnime } = require('../metadata/manager.js');
const { identifyFilename, normalizeTitle } = require('../library/identify.js');
const { handleStream, saveProgress, isSafeUrl, getTracks, streamSubtitle } = require('../playback/stream.js');
const { getCachedImage, saveImageBuffer } = require('../cache/images.js');

const log = logger.child({ module: 'api' });

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 1 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Corpo da requisição muito grande'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function readRawBody(req, limit = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Arquivo muito grande'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function extFromMime(contentType) {
  const m = String(contentType || '').toLowerCase();
  if (m.includes('png')) return '.png';
  if (m.includes('webp')) return '.webp';
  if (m.includes('gif')) return '.gif';
  if (m.includes('avif')) return '.avif';
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
  return '.jpg';
}

function mediaToApi(m) {
  const out = { ...m };
  out.poster = null;
  out.rating = null;
  // Título de exibição: nome limpo (sem tags/qualidade). Mantém o nome original
  // em raw_title e prioriza o título dos metadados quando o item foi casado.
  out.raw_title = m.title;
  out.title = normalizeTitle(m.title) || m.title;
  const movie = movieRepo.byMediaItem(m.id);
  if (movie) {
    out.poster = movie.poster_path;
    out.backdrop = movie.backdrop_path;
    out.rating = movie.rating;
    out.overview = movie.overview;
    if (movie.title) out.title = movie.title;
  }
  const ep = episodeRepo.byMediaItem(m.id);
  if (ep) {
    const s = seriesRepo.get(ep.series_id);
    if (s) {
      out.poster = out.poster || s.poster_path;
      out.backdrop = out.backdrop || s.backdrop_path;
      out.rating = out.rating || s.rating;
      out.seriesTitle = s.title;
      out.seriesId = s.id;
      out.episodeId = ep.id;
      out.episodeTitle = ep.title;
      if (s.title) out.title = s.title;
    }
  }
  if (m.manual_title) out.title = m.manual_title;
  if (m.custom_poster) out.poster = m.custom_poster;
  if (m.custom_thumbnail) out.thumbnail = m.custom_thumbnail;
  return out;
}

function seriesToApi(s) {
  return { ...s };
}

function movieToApi(m) {
  const title = m.title || m.movie_title || normalizeTitle(m.raw_title) || m.raw_title || '';
  return { ...m, title };
}

function parseQuery(url) {
  const q = new URL(url, 'http://localhost').searchParams;
  return {
    page: Math.max(1, parseInt(q.get('page') || '1', 10)),
    perPage: Math.min(100, Math.max(1, parseInt(q.get('perPage') || '48', 10))),
    search: q.get('q') || null,
    genre: q.get('genre') || null,
    year: q.get('year') ? parseInt(q.get('year'), 10) : null,
    resolution: q.get('resolution') || null,
    codec: q.get('codec') || null,
    minDuration: q.get('minDuration') ? parseInt(q.get('minDuration'), 10) : null,
    sort: q.get('sort') || null,
    serverId: q.get('serverId') || null,
    hidden: q.get('hidden') || 'visible',
  };
}

async function handleApi(req, res, { jobs, metadata, app }) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const method = req.method;

  // ---- Dashboard / Home ----
  if (p === '/api/dashboard' && method === 'GET') {
    const minDuration = 300;
    const continueWatching = mediaRepo.continueWatching(24, minDuration).map((m) => {
      const api = mediaToApi(m);
      api.progress = m.duration > 0 ? Math.min(100, (m.position / m.duration) * 100) : 0;
      api.position = m.position;
      return api;
    });
    const recentlyAdded = mediaRepo.recent(5, minDuration).map(mediaToApi);
    const movies = mediaRepo.listMovies({ page: 1, perPage: 12, sort: 'title', minDuration }).items.map(movieToApi);
    const series = mediaRepo.listSeriesGroups({ page: 1, perPage: 12, sort: 'title', minDuration }).items;
    const animeMovies = mediaRepo.listMovies({ perPage: 100000, page: 1, minDuration }).items.map(movieToApi).filter((m) => isLikelyAnime(m.title)).slice(0, 8);
    const animeSeries = mediaRepo.listSeriesGroups({ perPage: 100000, page: 1, minDuration }).items.filter((s) => isLikelyAnime(s.title)).slice(0, 8);
    const anime = [...animeMovies, ...animeSeries].slice(0, 12);
    return json(res, 200, {
      continueWatching,
      recentlyAdded,
      movies,
      series,
      anime,
      animeCount: anime.length,
      stats: stats(),
    });
  }

  // ---- Servidores ----
  if (p === '/api/servers' && method === 'GET') {
    const servers = serverRepo.list().map((s) => decorateServer(s));
    return json(res, 200, servers);
  }

  if (p === '/api/servers/discover' && method === 'POST') {
    try {
      const added = await runDiscovery();
      return json(res, 200, { added, servers: serverRepo.list().map(decorateServer) });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // Adicionar servidor manualmente por IP (para quando o SSDP não funciona)
  if (p === '/api/servers/manual' && method === 'POST') {
    const body = await readBody(req);
    const host = String(body.host || '').trim().replace(/^https?:\/\//, '').split('/')[0];
    const port = body.port ? parseInt(body.port, 10) : null;
    if (!host) return json(res, 400, { error: 'Informe o IP ou hostname do servidor' });
    try {
      const saved = await addServerManually(host, port);
      return json(res, 200, { server: decorateServer(saved) });
    } catch (err) {
      return json(res, 404, { error: err.message });
    }
  }

  // Adicionar uma pasta local do computador como fonte de mídia
  if (p === '/api/servers/local' && method === 'POST') {
    const body = await readBody(req);
    const folderPath = String(body.path || '').trim();
    if (!folderPath) return json(res, 400, { error: 'Informe o caminho da pasta' });
    let resolved;
    try {
      resolved = path.resolve(folderPath);
    } catch {
      return json(res, 400, { error: 'Caminho inválido' });
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return json(res, 400, { error: 'Pasta não existe ou não é um diretório' });
    }
    const existing = serverRepo.findByPath(resolved);
    if (existing) return json(res, 200, { server: decorateServer(existing), duplicate: true });
    try {
      const saved = serverRepo.createLocal(path.basename(resolved) || 'Pasta local', resolved);
      const job = jobs.create({ type: 'library-scan', serverId: saved.id });
      job.run((j) => scanFolder(saved.id, { job: j }));
      return json(res, 200, { server: decorateServer(saved), jobId: job.id });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // Diagnóstico: mostra quais dispositivos responderam ao SSDP
  if (p === '/api/servers/ssdp-debug' && method === 'POST') {
    try {
      const entries = await discoverOnce({ timeoutMs: 6000 });
      return json(res, 200, { count: entries.length, entries: entries.slice(0, 100) });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  const serverMatch = /^\/api\/servers\/(\d+)(?:\/([a-z]+))?$/.exec(p);
  if (serverMatch) {
    const [, sid, action] = serverMatch;
    const server = serverRepo.get(sid);
    if (!server) return json(res, 404, { error: 'Servidor não encontrado' });
    const id = parseInt(sid, 10);

    if (!action && method === 'GET') {
      const count = mediaRepo.totalCount(id);
      const s = decorateServer(server);
      s.media_count = count;
      const history = db.prepare('SELECT COUNT(*) AS c FROM playback_history ph JOIN media_items mi ON mi.id = ph.media_item_id WHERE mi.server_id = ?').get(id).c;
      s.playback_count = history;
      return json(res, 200, s);
    }
    if (action === 'scan' && method === 'POST') {
      const job = jobs.create({ type: 'library-scan', serverId: id });
      job.run((j) => (server.type === 'local' ? scanFolder(id, { job: j }) : scanServer(id, { job: j })));
      return json(res, 202, { jobId: job.id });
    }
    if (action === 'rescan' && method === 'POST') {
      const job = jobs.create({ type: 'library-rescan', serverId: id });
      job.run((j) => (server.type === 'local' ? scanFolder(id, { job: j }) : scanServer(id, { job: j })));
      return json(res, 202, { jobId: job.id });
    }
    if (!action && method === 'DELETE') {
      serverRepo.remove(id);
      return json(res, 200, { ok: true });
    }
    if (action === 'pause' && method === 'POST') {
      serverRepo.setPaused(id, !server.paused);
      return json(res, 200, { ok: true, paused: !server.paused });
    }
    if (action === 'enable' && method === 'POST') {
      serverRepo.setEnabled(id, !server.enabled);
      return json(res, 200, { ok: true });
    }
    if (action === 'check' && method === 'POST') {
      let online = false;
      let err = null;
      if (server.type === 'local') {
        online = !!(server.path && fs.existsSync(server.path) && fs.statSync(server.path).isDirectory());
        err = online ? null : 'Pasta não encontrada';
      } else {
        online = await probeServerOnline(server);
        err = online ? null : 'Sem resposta do ContentDirectory';
      }
      serverRepo.setStatus(id, online ? 'online' : 'offline', err);
      return json(res, 200, { online, server: decorateServer(serverRepo.get(id)) });
    }
    return json(res, 404, { error: 'Rota não encontrada' });
  }

  // ---- Mídias ----
  if (p === '/api/media' && method === 'GET') {
    const q = parseQuery(req.url);
    const result = mediaRepo.list({ ...q, search: q.search, type: null, hidden: q.hidden });
    return json(res, 200, { ...result, items: result.items.map(mediaToApi) });
  }

  if (p === '/api/movies' && method === 'GET') {
    const q = parseQuery(req.url);
    const result = mediaRepo.listMovies({ search: q.search, genre: q.genre, year: q.year, resolution: q.resolution, codec: q.codec, minDuration: q.minDuration, sort: q.sort, page: q.page, perPage: q.perPage, hidden: q.hidden });
    result.items = result.items.map(movieToApi);
    return json(res, 200, result);
  }

  if (p === '/api/series' && method === 'GET') {
    const q = parseQuery(req.url);
    const result = mediaRepo.listSeriesGroups({ search: q.search, genre: q.genre, year: q.year, minDuration: q.minDuration, sort: q.sort, page: q.page, perPage: q.perPage, hidden: q.hidden });
    return json(res, 200, result);
  }

  if (p === '/api/anime' && method === 'GET') {
    const q = parseQuery(req.url);
    const animeIds = new Set(mediaRepo.listAnime().map((m) => m.id));
    const movies = mediaRepo.listMovies({ perPage: 100000, page: 1, minDuration: q.minDuration }).items
      .map(movieToApi)
      .filter((m) => animeIds.has(m.id) || isLikelyAnime(m.title));
    const series = mediaRepo.listSeriesGroups({ perPage: 100000, page: 1, minDuration: q.minDuration }).items
      .filter((s) => animeIds.has(s.media_id) || isLikelyAnime(s.title));
    const combined = [
      ...movies.map((m) => ({ ...m, kind: 'movie' })),
      ...series.map((s) => ({ ...s, kind: 'series' })),
    ];
    const total = combined.length;
    const start = (q.page - 1) * q.perPage;
    return json(res, 200, { total, page: q.page, perPage: q.perPage, items: combined.slice(start, start + q.perPage) });
  }

  const mediaMatch = /^\/api\/media\/(\d+)(?:\/(stream|thumbnail|progress|sources|tracks|subtitle|hide|title|metadata|image))?$/.exec(p);
  if (mediaMatch) {
    const [, mid, sub] = mediaMatch;
    const id = parseInt(mid, 10);

    if (!sub && method === 'GET') {
      const m = mediaRepo.get(id);
      if (!m) return json(res, 404, { error: 'Mídia não encontrada' });
      const api = mediaToApi(m);
      const server = serverRepo.get(m.server_id);
      api.server = server ? { id: server.id, name: server.name, ip: server.ip } : null;
      api.history = historyRepo.get(id) || null;
      api.people = personRepo.forMedia(id);
      api.genres = db.prepare(`
        SELECT g.name FROM media_genres mg JOIN genres g ON g.id = mg.genre_id WHERE mg.media_item_id = ?
      `).all(id).map((r) => r.name);
      const movie = movieRepo.byMediaItem(id);
      if (movie) api.movie = movie;

      // Lista de episódios: construída a partir de todas as mídias da série
      // (por título normalizado), não apenas dos episódios já casados.
      if (m.episode != null || m.season != null) {
        const eps = mediaRepo.seriesEpisodes(m.normalized_title || m.title);
        if (eps.length) {
          const linked = eps.find((e) => e.series_id);
          const seasons = [];
          const bySeason = new Map();
          for (const e of eps) {
            const sn = e.season ?? 1;
            if (!bySeason.has(sn)) bySeason.set(sn, []);
            bySeason.get(sn).push(e);
          }
          for (const [sn, list] of bySeason) {
            seasons.push({
              season_number: sn,
              title: null,
              episodes: list.map((e) => ({
                id: e.media_id,
                episode_number: e.episode,
                title: e.episode_title ?? null,
                overview: e.overview,
                air_date: e.air_date,
                media: mediaToApi(mediaRepo.get(e.media_id)),
              })),
            });
          }
          api.season = seasons;
          if (linked) {
            api.series = {
              id: linked.series_id,
              title: linked.series_title,
              original_title: linked.original_title,
              poster_path: linked.poster_path,
              backdrop_path: linked.backdrop_path,
              year: linked.series_year,
              rating: linked.series_rating,
              overview: linked.series_overview,
            };
          }
          const current = eps.find((e) => e.media_id === id)
            || eps.find((e) => (e.season ?? 1) === (m.season ?? 1) && e.episode === m.episode);
          if (current) {
            api.episode = {
              id: current.media_id,
              episode_number: current.episode,
              season_number: current.season ?? 1,
              season_id: current.season ?? 1,
              title: current.episode_title ?? null,
            };
          }
        }
      }
      return json(res, 200, api);
    }

    if (sub === 'stream' && method === 'GET') {
      const range = req.headers.range;
      const tp = url.searchParams.get('transcode');
      let transcode = null;
      if (tp === '1' || tp === 'true' || tp === 'remux') transcode = 'remux';
      else if (tp === '2' || tp === 'full') transcode = 'full';
      const audioParam = url.searchParams.get('audio');
      const audio = audioParam != null && /^\d+$/.test(audioParam) ? parseInt(audioParam, 10) : null;
      const startParam = url.searchParams.get('start');
      const start = startParam != null && /^\d+(\.\d+)?$/.test(startParam) ? parseFloat(startParam) : null;
      try {
        const result = await handleStream(req, res, { id, transcode, range, audio, start });
        if (result) return json(res, result.status, { error: result.body });
        return null;
      } catch (err) {
        if (!res.headersSent) return json(res, 500, { error: err.message });
        return null;
      }
    }

    if (sub === 'tracks' && method === 'GET') {
      const m = mediaRepo.get(id);
      if (!m) return json(res, 404, { error: 'Mídia não encontrada' });
      try {
        const tracks = await getTracks(m);
        return json(res, 200, tracks);
      } catch (err) {
        return json(res, 200, { audio: [], subtitles: [], error: err.message });
      }
    }

    if (sub === 'subtitle' && method === 'GET') {
      const m = mediaRepo.get(id);
      if (!m) return json(res, 404, { error: 'Mídia não encontrada' });
      const streamParam = url.searchParams.get('stream');
      const extParam = url.searchParams.get('ext');
      let streamIndex = null;
      let externalUri = null;
      if (extParam != null) {
        const idx = parseInt(extParam, 10);
        let subs = [];
        try { subs = JSON.parse(m.subtitles || '[]'); } catch { subs = []; }
        if (subs[idx]) externalUri = subs[idx].uri;
        if (!externalUri) return json(res, 404, { error: 'Legenda externa não encontrada' });
      } else if (streamParam != null) {
        streamIndex = parseInt(streamParam, 10);
        if (!Number.isFinite(streamIndex)) return json(res, 400, { error: 'Stream inválida' });
      } else {
        return json(res, 400, { error: 'Parâmetro stream ou ext obrigatório' });
      }
      try {
        await streamSubtitle({ res, media: m, streamIndex, externalUri });
        return null;
      } catch (err) {
        if (!res.headersSent) return json(res, 500, { error: err.message });
        return null;
      }
    }

    if (sub === 'thumbnail' && method === 'GET') {
      const m = mediaRepo.get(id);
      if (!m) return json(res, 404, { error: 'Mídia não encontrada' });
      const { localPath } = require('../cache/images.js');
      let thumb = m.custom_thumbnail || m.custom_poster || null;
      if (!thumb) {
        const movie = movieRepo.byMediaItem(id);
        if (movie && movie.poster_path) thumb = movie.poster_path;
        else {
          const ep = episodeRepo.byMediaItem(id);
          if (ep) {
            const s = seriesRepo.get(ep.series_id);
            if (s && s.poster_path) thumb = s.poster_path;
          }
        }
        if (!thumb) thumb = m.thumbnail;
      }
      if (thumb && thumb.startsWith('http')) {
        const { getCachedImage } = require('../cache/images.js');
        const local = await getCachedImage('thumbnails', thumb);
        if (local) thumb = local;
      }
      if (thumb && (thumb.startsWith('posters/') || thumb.startsWith('backdrops/') || thumb.startsWith('thumbnails/'))) {
        const p = localPath(thumb);
        res.statusCode = 200;
        res.setHeader('Content-Type', thumb.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
        return res.end(require('node:fs').readFileSync(p));
      }
      return json(res, 404, { error: 'Thumbnail indisponível' });
    }

    if (sub === 'progress' && method === 'POST') {
      const body = await readBody(req);
      saveProgress({ mediaItemId: id, position: body.position, duration: body.duration, finished: body.finished });
      return json(res, 200, { ok: true });
    }

    if (sub === 'hide' && method === 'POST') {
      const m = mediaRepo.get(id);
      if (!m) return json(res, 404, { error: 'Mídia não encontrada' });
      const body = await readBody(req);
      const hidden = !!body.hidden;
      mediaRepo.setHidden(id, hidden);
      return json(res, 200, { ok: true, hidden });
    }

    if (sub === 'title' && method === 'POST') {
      const m = mediaRepo.get(id);
      if (!m) return json(res, 404, { error: 'Mídia não encontrada' });
      const body = await readBody(req);
      const title = String(body.title || '').trim();
      const groupKey = m.normalized_title || m.title;
      if (title) {
        mediaRepo.setManualTitleByGroup(groupKey, title);
        return json(res, 200, { ok: true, title });
      }
      mediaRepo.clearManualTitleByGroup(groupKey);
      return json(res, 200, { ok: true, title: null });
    }

    if (sub === 'image') {
      const m = mediaRepo.get(id);
      if (!m) return json(res, 404, { error: 'Mídia não encontrada' });
      const groupKey = m.normalized_title || m.title;
      const target = (url.searchParams.get('target') || 'poster') === 'thumbnail' ? 'thumbnail' : 'poster';
      const setCustom = (rel) => target === 'thumbnail'
        ? mediaRepo.setCustomThumbnailByGroup(groupKey, rel)
        : mediaRepo.setCustomPosterByGroup(groupKey, rel);
      const clearCustom = () => target === 'thumbnail'
        ? mediaRepo.clearCustomThumbnailByGroup(groupKey)
        : mediaRepo.clearCustomPosterByGroup(groupKey);

      if (method === 'DELETE') {
        clearCustom();
        return json(res, 200, { ok: true, [target]: null });
      }

      if (method === 'POST') {
        const ct = (req.headers['content-type'] || '').toLowerCase();
        try {
          let rel = null;
          if (ct.includes('application/json')) {
            const body = await readBody(req);
            const url = String(body.url || '').trim();
            const local = String(body.path || '').trim();
            if (url) {
              rel = await getCachedImage('posters', url);
              if (!rel) return json(res, 400, { error: 'Não foi possível baixar a imagem da URL' });
            } else if (local && /^(posters|backdrops|thumbnails)\/[\w.-]+$/.test(local)) {
              rel = local;
            } else {
              clearCustom();
              return json(res, 200, { ok: true, [target]: null });
            }
          } else if (ct.startsWith('image/') || ct.startsWith('application/octet-stream')) {
            const buf = await readRawBody(req);
            if (!buf.length) return json(res, 400, { error: 'Nenhuma imagem enviada' });
            rel = saveImageBuffer('posters', buf, extFromMime(ct));
          } else {
            return json(res, 400, { error: 'Envie uma URL (JSON) ou uma imagem (upload)' });
          }
          setCustom(rel);
          return json(res, 200, { ok: true, [target]: rel });
        } catch (err) {
          return json(res, 500, { error: err.message });
        }
      }

      return json(res, 405, { error: 'Método não suportado' });
    }

    if (sub === 'metadata' && method === 'POST') {
      const m = mediaRepo.get(id);
      if (!m) return json(res, 404, { error: 'Mídia não encontrada' });
      try {
        const identify = identifyFilename(m.manual_title || m.title);
        metadataCacheRepo.clearByTitle(identify.title);
        const metadata = new MetadataManager();
        if (!metadata.enabled) return json(res, 200, { ok: false, error: 'Metadados desativados nas configurações' });
        await metadata.enrich(mediaRepo.get(id), identify);
        return json(res, 200, { ok: true, media: mediaToApi(mediaRepo.get(id)) });
      } catch (err) {
        return json(res, 500, { error: err.message });
      }
    }

    if (sub === 'sources' && method === 'GET') {
      const rows = db.prepare(`
        SELECT mi.id, mi.server_id, s.name AS server_name, mi.resolution, mi.format, mi.video_codec, mi.url, mi.size
        FROM media_items mi JOIN servers s ON s.id = mi.server_id
        WHERE mi.id = ?
      `).get(id);
      return json(res, 200, { sources: [rows] });
    }
  }

  // ---- Busca ----
  if (p === '/api/search' && method === 'GET') {
    const q = url.searchParams.get('q') || '';
    if (!q.trim()) return json(res, 200, { items: [] });
    const result = mediaRepo.list({ search: q.trim(), page: 1, perPage: 30 });
    const movies = mediaRepo.listMovies({ search: q.trim(), page: 1, perPage: 10 }).items.map(movieToApi);
    const series = mediaRepo.listSeriesGroups({ search: q.trim(), page: 1, perPage: 10 }).items;
    return json(res, 200, { items: result.items.map(mediaToApi), movies, series });
  }

  // ---- Filtros ----
  if (p === '/api/filters' && method === 'GET') {
    return json(res, 200, {
      years: mediaRepo.distinctCol('year').sort((a, b) => b - a),
      resolutions: mediaRepo.distinctCol('resolution'),
      codecs: mediaRepo.distinctCol('video_codec'),
      genres: genreRepo.all(),
      types: ['movie', 'series', 'anime'],
    });
  }

  // ---- Jobs ----
  if (p === '/api/jobs' && method === 'GET') {
    return json(res, 200, jobs.list());
  }
  const jobMatch = /^\/api\/jobs\/(\d+)(?:\/(cancel))?$/.exec(p);
  if (jobMatch) {
    const [, jid, sub] = jobMatch;
    if (!sub && method === 'GET') {
      return json(res, 200, jobRepo.get(jid) || { error: 'Job não encontrado' });
    }
    if (sub === 'cancel' && method === 'POST') {
      const ok = jobs.cancel(parseInt(jid, 10));
      return json(res, 200, { ok });
    }
  }

  // ---- Histórico ----
  if (p === '/api/history' && method === 'GET') {
    const rows = historyRepo.list(100).map((h) => {
      const m = mediaRepo.get(h.media_item_id);
      return m ? { ...h, media: mediaToApi(m) } : null;
    }).filter(Boolean);
    return json(res, 200, rows);
  }

  // ---- Configurações ----
  if (p === '/api/settings' && method === 'GET') {
    return json(res, 200, {
      host: config.HOST,
      port: config.PORT,
      scanInterval: config.SCAN_INTERVAL,
      enableMetadata: config.ENABLE_METADATA,
      tmdbEnabled: config.TMDB_ENABLED,
      tmdbConfigured: !!config.TMDB_API_KEY,
      tvMazeEnabled: config.TVMAZE_ENABLED,
      anilistEnabled: config.ANILIST_ENABLED,
      enableTranscode: config.ENABLE_TRANSCODE,
      ffmpegPath: config.FFMPEG_PATH,
      logLevel: config.LOG_LEVEL,
      dataDir: config.DATA_DIR,
    });
  }

  if (p === '/api/settings' && method === 'PUT') {
    return json(res, 501, { error: 'Alterar configurações em tempo real não suportado; edite o .env' });
  }

  if (p === '/api/settings/test-transcode' && method === 'POST') {
    try {
      const { execFileSync } = require('node:child_process');
      const out = execFileSync(config.FFMPEG_PATH, ['-version'], { timeout: 5000 }).toString().split('\n')[0];
      return json(res, 200, { ok: true, version: out });
    } catch (err) {
      return json(res, 200, { ok: false, error: err.message });
    }
  }

  if (p === '/api/metadata/scan' && method === 'POST') {
    const job = jobs.create({ type: 'metadata-fetch', total: mediaRepo.totalCount() });
    job.run(async (j) => {
      const metadata = new MetadataManager();
      const rows = mediaRepo.list({ perPage: 100000 }).items;
      j.setTotal(rows.length);
      for (const m of rows) {
        if (j.isCancelled()) break;
        const identify = identifyFilename(m.title);
        await metadata.enrich(mediaRepo.get(m.id), identify);
        j.advance();
      }
    });
    return json(res, 202, { jobId: job.id });
  }

  if (p === '/api/system/info' && method === 'GET') {
    const statsData = stats();
    return json(res, 200, { ...statsData, version: require('../../package.json').version });
  }

  if (p === '/api/system/logs' && method === 'GET') {
    const fs = require('node:fs');
    const logDir = path.join(config.DATA_DIR, 'logs');
    try {
      const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log')).sort().slice(-2);
      const lines = [];
      for (const f of files) {
        const content = fs.readFileSync(path.join(logDir, f), 'utf8');
        lines.push(...content.split(/\r?\n/).filter(Boolean));
      }
      const tail = lines.slice(-200);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.end(tail.join('\n'));
    } catch {
      return json(res, 200, { error: 'Logs indisponíveis' });
    }
  }

  return json(res, 404, { error: 'Rota não encontrada' });
}

function decorateServer(s) {
  const services = parseServices(s);
  return {
    ...s,
    online: s.status === 'online',
    isLocal: s.type === 'local',
    services: Object.values(services || {}),
  };
}

function stats() {
  const total = mediaRepo.totalCount();
  const counts = {};
  for (const { type, c } of mediaRepo.countsByType()) counts[type] = c;
  const anime = db.prepare(`SELECT COUNT(*) AS c FROM media_items WHERE media_type = 'anime' AND type != 'missing'`).get().c;
  return {
    total,
    videos: counts.video || 0,
    movies: db.prepare('SELECT COUNT(*) AS c FROM movies').get().c,
    series: db.prepare('SELECT COUNT(*) AS c FROM series').get().c,
    episodes: db.prepare('SELECT COUNT(*) AS c FROM episodes').get().c,
    anime,
    servers: serverRepo.count(),
  };
}

module.exports = { handleApi, json };
