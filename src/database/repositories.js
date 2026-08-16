'use strict';

const { prepare } = require('./db.js');

const serverRepo = {
  upsert(s) {
    prepare(`
      INSERT INTO servers (uuid, name, manufacturer, model, ip, port, description_url, control_url, event_sub_url, services, icon_url, status, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(uuid) DO UPDATE SET
        name = excluded.name,
        manufacturer = excluded.manufacturer,
        model = excluded.model,
        ip = excluded.ip,
        port = excluded.port,
        description_url = excluded.description_url,
        control_url = excluded.control_url,
        event_sub_url = excluded.event_sub_url,
        services = excluded.services,
        icon_url = excluded.icon_url,
        status = excluded.status,
        last_seen = excluded.last_seen
    `).run(
      s.uuid, s.name, s.manufacturer, s.model, s.ip, s.port,
      s.description_url, s.control_url, s.event_sub_url, s.services,
      s.icon_url, s.status, new Date().toISOString()
    );
    const row = prepare('SELECT * FROM servers WHERE uuid = ?').get(s.uuid);
    return row;
  },

  list(enabledOnly = false) {
    const q = enabledOnly ? 'SELECT * FROM servers WHERE enabled = 1' : 'SELECT * FROM servers';
    return prepare(q).all().map(decorate);
  },

  get(id) {
    const row = prepare('SELECT * FROM servers WHERE id = ?').get(id);
    return row ? decorate(row) : null;
  },

  setStatus(id, status, error = null) {
    prepare('UPDATE servers SET status = ?, error = ?, last_seen = ? WHERE id = ?')
      .run(status, error, new Date().toISOString(), id);
  },

  setLastSync(id, at = new Date().toISOString()) {
    prepare('UPDATE servers SET last_sync_at = ? WHERE id = ?').run(at, id);
  },

  setEnabled(id, enabled) {
    prepare('UPDATE servers SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  },

  setPaused(id, paused) {
    prepare('UPDATE servers SET paused = ? WHERE id = ?').run(paused ? 1 : 0, id);
  },

  remove(id) {
    prepare('DELETE FROM servers WHERE id = ?').run(id);
  },

  count() {
    return prepare('SELECT COUNT(*) AS c FROM servers').get().c;
  },
};

function decorate(s) {
  return { ...s, enabled: !!s.enabled, paused: !!s.paused };
}

function parseServices(s) {
  if (!s || !s.services) return {};
  try { return JSON.parse(s.services); } catch { return {}; }
}

const mediaRepo = {
  upsert(m) {
    const p = {
      server_id: m.server_id ?? null,
      object_id: m.object_id ?? null,
      parent_id: m.parent_id ?? null,
      title: m.title ?? 'Sem título',
      original_title: m.original_title ?? null,
      type: m.type ?? 'other',
      media_type: m.media_type ?? null,
      url: m.url ?? null,
      duration: m.duration ?? null,
      format: m.format ?? null,
      video_codec: m.video_codec ?? null,
      audio_codec: m.audio_codec ?? null,
      width: m.width ?? null,
      height: m.height ?? null,
      bitrate: m.bitrate ?? null,
      mime_type: m.mime_type ?? null,
      size: m.size ?? null,
      thumbnail: m.thumbnail ?? null,
      season: m.season ?? null,
      episode: m.episode ?? null,
      year: m.year ?? null,
      date: m.date ?? null,
      album: m.album ?? null,
      artist: m.artist ?? null,
      genre: m.genre ?? null,
      description: m.description ?? null,
      resolution: m.resolution ?? null,
      hdr: m.hdr ?? 0,
      audio_channels: m.audio_channels ?? null,
      subtitles: m.subtitles ?? null,
      last_seen: m.last_seen ?? new Date().toISOString(),
    };
    prepare(`
      INSERT INTO media_items (
        server_id, object_id, parent_id, title, original_title, type, media_type,
        url, duration, format, video_codec, audio_codec, width, height, bitrate,
        mime_type, size, thumbnail, season, episode, year, date, album, artist,
        genre, description, resolution, hdr, audio_channels, subtitles, last_seen
      ) VALUES (
        @server_id, @object_id, @parent_id, @title, @original_title, @type, @media_type,
        @url, @duration, @format, @video_codec, @audio_codec, @width, @height, @bitrate,
        @mime_type, @size, @thumbnail, @season, @episode, @year, @date, @album, @artist,
        @genre, @description, @resolution, @hdr, @audio_channels, @subtitles, @last_seen
      )
      ON CONFLICT(server_id, object_id) DO UPDATE SET
        title = excluded.title,
        original_title = excluded.original_title,
        parent_id = excluded.parent_id,
        type = excluded.type,
        media_type = excluded.media_type,
        url = excluded.url,
        duration = excluded.duration,
        format = excluded.format,
        video_codec = excluded.video_codec,
        audio_codec = excluded.audio_codec,
        width = excluded.width,
        height = excluded.height,
        bitrate = excluded.bitrate,
        mime_type = excluded.mime_type,
        size = excluded.size,
        thumbnail = excluded.thumbnail,
        season = excluded.season,
        episode = excluded.episode,
        year = excluded.year,
        date = excluded.date,
        album = excluded.album,
        artist = excluded.artist,
        genre = excluded.genre,
        description = excluded.description,
        resolution = excluded.resolution,
        hdr = excluded.hdr,
        audio_channels = excluded.audio_channels,
        subtitles = excluded.subtitles,
        last_seen = excluded.last_seen
    `).run(p);
    const id = prepare('SELECT id FROM media_items WHERE server_id = ? AND object_id = ?')
      .get(m.server_id, m.object_id).id;
    return id;
  },

  get(id) {
    return prepare('SELECT * FROM media_items WHERE id = ?').get(id);
  },

  getByIds(ids) {
    if (!ids.length) return [];
    const marks = ids.map(() => '?').join(',');
    return prepare(`SELECT * FROM media_items WHERE id IN (${marks})`).all(...ids);
  },

  list({ serverId, type, mediaType, search, genre, year, resolution, codec, minDuration, sort, page = 1, perPage = 48, only = null, hidden = 'visible' }) {
    const where = [];
    const params = {};
    if (hidden === 'all') { /* inclui tudo */ }
    else if (hidden === 'only') where.push('mi.hidden = 1');
    else where.push('mi.hidden = 0');
    if (serverId) { where.push('mi.server_id = @serverId'); params.serverId = serverId; }
    if (type) { where.push('mi.type = @type'); params.type = type; }
    if (mediaType) { where.push('mi.media_type = @mediaType'); params.mediaType = mediaType; }
    if (year) { where.push('mi.year = @year'); params.year = year; }
    if (minDuration) { where.push('mi.duration IS NOT NULL AND mi.duration >= @minDuration'); params.minDuration = minDuration; }
    if (resolution) {
      if (resolution === '4K') where.push('mi.resolution IN ("4K", "2160p")');
      else if (resolution === '1080p') where.push('mi.resolution = "1080p"');
      else if (resolution === '720p') where.push('mi.resolution = "720p"');
      else if (resolution === 'SD') where.push('mi.resolution IN ("SD", "480p", "576p")');
    }
    if (codec) { where.push('mi.video_codec = @codec'); params.codec = codec; }
    if (genre) {
      where.push('EXISTS (SELECT 1 FROM media_genres mg JOIN genres g ON g.id = mg.genre_id WHERE mg.media_item_id = mi.id AND g.name = @genre)');
      params.genre = genre;
    }
    if (search) {
      where.push(`(
        mi.title LIKE @q OR mi.original_title LIKE @q OR mi.description LIKE @q
        OR mi.artist LIKE @q OR EXISTS (
          SELECT 1 FROM media_people mp JOIN people p ON p.id = mp.person_id
          WHERE mp.media_item_id = mi.id AND p.name LIKE @q
        )
      )`);
      params.q = `%${search}%`;
    }
    if (only === 'movies') { where.push('EXISTS (SELECT 1 FROM movies mv WHERE mv.media_item_id = mi.id)'); }
    if (only === 'series') { where.push('EXISTS (SELECT 1 FROM episodes ep WHERE ep.media_item_id = mi.id)'); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sortMap = {
      recent: 'mi.created_at DESC',
      title: 'mi.title COLLATE NOCASE ASC',
      year: 'mi.year DESC',
      rating: 'mi.id ASC',
      added: 'mi.last_seen DESC',
    };
    const orderSql = sortMap[sort] || sortMap.recent;
    const offset = (page - 1) * perPage;
    const total = prepare(`SELECT COUNT(*) AS c FROM media_items mi ${whereSql}`).get(params).c;
    const rows = prepare(`
      SELECT mi.* FROM media_items mi ${whereSql}
      ORDER BY ${orderSql} LIMIT @perPage OFFSET @offset
    `).all({ ...params, perPage, offset });
    return { total, page, perPage, items: rows };
  },

  distinctCol(col) {
    return prepare(`SELECT DISTINCT ${col} AS v FROM media_items WHERE ${col} IS NOT NULL AND ${col} != '' AND hidden = 0 ORDER BY v`).all().map(r => r.v);
  },

  markMissing(serverId, seenObjectIds) {
    const seen = new Set(seenObjectIds);
    const rows = prepare('SELECT id, object_id FROM media_items WHERE server_id = ?').all(serverId);
    const now = new Date().toISOString();
    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    let removed = 0;
    for (const row of rows) {
      if (!seen.has(row.object_id)) {
        const info = prepare('SELECT last_seen FROM media_items WHERE id = ?').get(row.id);
        if (info.last_seen < cutoff) {
          prepare('DELETE FROM media_items WHERE id = ?').run(row.id);
          removed++;
        } else {
          prepare('UPDATE media_items SET type = ? WHERE id = ?').run('missing', row.id);
        }
      }
    }
    return removed;
  },

  clearMissing(serverId) {
    prepare('DELETE FROM media_items WHERE server_id = ? AND type = ?').run(serverId, 'missing');
  },

  countsByType() {
    return prepare(`
      SELECT type, COUNT(*) AS c FROM media_items WHERE type != 'missing' AND hidden = 0 GROUP BY type
    `).all();
  },

  totalCount(serverId = null) {
    if (serverId) return prepare("SELECT COUNT(*) AS c FROM media_items WHERE server_id = ? AND type != 'missing' AND hidden = 0").get(serverId).c;
    return prepare("SELECT COUNT(*) AS c FROM media_items WHERE type != 'missing' AND hidden = 0").get().c;
  },

  recent(limit = 20, minDuration = null) {
    const titleKey = `COALESCE(NULLIF(mi.manual_title, ''), NULLIF(mi.normalized_title, ''), mi.title)`;
    const where = [`mi.type != 'missing'`, `mi.hidden = 0`];
    const params = {};
    if (minDuration) { where.push('mi.duration IS NOT NULL AND mi.duration >= @minDuration'); params.minDuration = minDuration; }
    return prepare(`
      SELECT x.*, mv.poster_path, mv.rating, mv.title AS movie_title
      FROM (
        SELECT mi.*, ROW_NUMBER() OVER (
          PARTITION BY ${titleKey}
          ORDER BY mi.created_at DESC, mi.id ASC
        ) AS rn
        FROM media_items mi
        WHERE ${where.join(' AND ')}
      ) x
      LEFT JOIN movies mv ON mv.media_item_id = x.id
      WHERE x.rn = 1
      ORDER BY x.created_at DESC LIMIT @limit
    `).all({ ...params, limit });
  },

  continueWatching(limit = 20, minDuration = null) {
    const where = [`ph.finished = 0`, `mi.hidden = 0`];
    const params = {};
    if (minDuration) { where.push('mi.duration IS NOT NULL AND mi.duration >= @minDuration'); params.minDuration = minDuration; }
    return prepare(`
      SELECT mi.*, ph.position, ph.duration AS total_duration, ph.finished,
             mv.poster_path, mv.rating
      FROM playback_history ph
      JOIN media_items mi ON mi.id = ph.media_item_id
      LEFT JOIN movies mv ON mv.media_item_id = mi.id
      WHERE ${where.join(' AND ')}
      ORDER BY ph.updated_at DESC LIMIT @limit
    `).all({ ...params, limit });
  },

  updateMetadata(id, patch) {
    const fields = [];
    const params = { id };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      fields.push(`${k} = @${k}`);
      params[k] = v;
    }
    if (!fields.length) return;
    prepare(`UPDATE media_items SET ${fields.join(', ')} WHERE id = @id`).run(params);
  },

  setMetadataStatus(id, status) {
    prepare('UPDATE media_items SET metadata_status = ? WHERE id = ?').run(status, id);
  },

  setManualTitle(id, title) {
    prepare('UPDATE media_items SET manual_title = ? WHERE id = ?').run(title, id);
  },

  clearManualTitle(id) {
    prepare('UPDATE media_items SET manual_title = NULL WHERE id = ?').run(id);
  },

  setManualTitleByGroup(groupKey, title) {
    prepare(`UPDATE media_items SET manual_title = ? WHERE COALESCE(NULLIF(normalized_title, ''), title) = ?`)
      .run(title, groupKey);
  },

  clearManualTitleByGroup(groupKey) {
    prepare(`UPDATE media_items SET manual_title = NULL WHERE COALESCE(NULLIF(normalized_title, ''), title) = ?`)
      .run(groupKey);
  },

  setCustomPosterByGroup(groupKey, relativePath) {
    prepare(`UPDATE media_items SET custom_poster = ? WHERE COALESCE(NULLIF(normalized_title, ''), title) = ?`)
      .run(relativePath, groupKey);
  },

  clearCustomPosterByGroup(groupKey) {
    prepare(`UPDATE media_items SET custom_poster = NULL WHERE COALESCE(NULLIF(normalized_title, ''), title) = ?`)
      .run(groupKey);
  },

  setHidden(id, hidden) {
    prepare('UPDATE media_items SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id);
  },

  videosForServer(serverId) {
    return prepare(`SELECT * FROM media_items WHERE server_id = ? AND type = 'video' AND media_type = 'video'`).all(serverId);
  },

  /**
   * Lista filmes da biblioteca (itens de vídeo que não são episódios),
   * com metadados de filme como enriquecimento quando disponíveis.
   */
  listMovies({ search, genre, year, resolution, codec, minDuration, sort = 'title', page = 1, perPage = 48, hidden = 'visible' }) {
    const where = [`mi.type = 'video'`, `mi.episode IS NULL`];
    if (hidden === 'all') { /* inclui tudo */ }
    else if (hidden === 'only') where.push('mi.hidden = 1');
    else where.push('mi.hidden = 0');
    const params = {};
    if (search) { where.push('(mi.title LIKE @q OR mi.normalized_title LIKE @q OR mi.description LIKE @q)'); params.q = `%${search}%`; }
    if (year) { where.push('COALESCE(mv.year, mi.year) = @year'); params.year = year; }
    if (minDuration) { where.push('mi.duration IS NOT NULL AND mi.duration >= @minDuration'); params.minDuration = minDuration; }
    if (resolution) {
      if (resolution === '4K') where.push('mi.resolution IN ("4K", "2160p")');
      else if (resolution === '1080p') where.push('mi.resolution = "1080p"');
      else if (resolution === '720p') where.push('mi.resolution = "720p"');
      else if (resolution === 'SD') where.push('mi.resolution IN ("SD", "480p", "576p")');
    }
    if (codec) { where.push('mi.video_codec = @codec'); params.codec = codec; }
    if (genre) {
      where.push('EXISTS (SELECT 1 FROM media_genres mg JOIN genres g ON g.id = mg.genre_id WHERE mg.media_item_id = mi.id AND g.name = @genre)');
      params.genre = genre;
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    // Deduplica por título normalizado: várias cópias do mesmo filme em
    // servidores diferentes viram um único card (mantém metadados casados).
    const titleKey = `COALESCE(NULLIF(mi.manual_title, ''), NULLIF(mi.normalized_title, ''), mi.title)`;
    const orderSql = sort === 'year' ? 'g.year DESC, g.title COLLATE NOCASE ASC'
      : 'g.title COLLATE NOCASE ASC';
    const total = prepare(`
      SELECT COUNT(*) AS c FROM (
        SELECT ${titleKey} AS k
        FROM media_items mi
        LEFT JOIN movies mv ON mv.media_item_id = mi.id
        ${whereSql}
        GROUP BY ${titleKey}
      )
    `).get(params).c;
    const offset = (page - 1) * perPage;
    const items = prepare(`
      SELECT g.min_id AS id, g.title, g.year, g.rating, g.overview, g.backdrop_path,
             g.poster, g.server_name, g.metadata_status, g.source_count,
             mi.resolution, mi.format, mi.video_codec, mi.size, mi.duration, mi.server_id
      FROM (
        SELECT ${titleKey} AS group_key,
               COALESCE(MAX(mi.manual_title), MIN(mv.title), ${titleKey}) AS title,
               COALESCE(MIN(mv.year), MIN(mi.year)) AS year,
               MAX(mv.rating) AS rating,
               MAX(mv.overview) AS overview,
               MAX(mv.backdrop_path) AS backdrop_path,
               COALESCE(MAX(mi.custom_poster), MAX(mv.poster_path)) AS poster,
               MAX(s.name) AS server_name,
               MIN(mi.metadata_status) AS metadata_status,
               MIN(mi.id) AS min_id,
               COUNT(*) AS source_count
        FROM media_items mi
        LEFT JOIN movies mv ON mv.media_item_id = mi.id
        LEFT JOIN servers s ON s.id = mi.server_id
        ${whereSql}
        GROUP BY ${titleKey}
      ) g
      LEFT JOIN media_items mi ON mi.id = g.min_id
      ORDER BY ${orderSql} LIMIT @perPage OFFSET @offset
    `).all({ ...params, perPage, offset });
    return { total, page, perPage, items };
  },

  /**
   * Agrupa episódios em séries (usando o título normalizado), mesclando
   * metadados de série quando a série foi casada com um provedor.
   */
  listSeriesGroups({ search, genre, year, minDuration, sort = 'title', page = 1, perPage = 48, hidden = 'visible' }) {
    const where = [`mi.episode IS NOT NULL`, `mi.type = 'video'`];
    if (hidden === 'all') { /* inclui tudo */ }
    else if (hidden === 'only') where.push('mi.hidden = 1');
    else where.push('mi.hidden = 0');
    const params = {};
    if (search) { where.push('(mi.title LIKE @q OR mi.normalized_title LIKE @q)'); params.q = `%${search}%`; }
    if (minDuration) { where.push('mi.duration IS NOT NULL AND mi.duration >= @minDuration'); params.minDuration = minDuration; }
    if (genre) {
      where.push('EXISTS (SELECT 1 FROM episodes ep2 JOIN series se2 ON se2.id = ep2.series_id JOIN media_genres mg ON mg.media_item_id = se2.media_item_id JOIN genres g ON g.id = mg.genre_id WHERE ep2.media_item_id = mi.id AND g.name = @genre)');
      params.genre = genre;
    }
    if (year) { where.push('se.year = @year'); params.year = year; }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    // Chave de agrupamento consistente (título normalizado), para que episódios
    // casados e não-casados da mesma série fiquem no mesmo grupo.
    const groupKey = `COALESCE(NULLIF(mi.manual_title, ''), NULLIF(mi.normalized_title, ''), mi.title)`;
    const titleExpr = `COALESCE(MAX(mi.manual_title), MAX(se.title), ${groupKey})`;
    const orderSql = sort === 'recent' ? 'MAX(mi.created_at) DESC' : `${titleExpr} COLLATE NOCASE ASC`;
    const total = prepare(`
      SELECT COUNT(*) AS c FROM (
        SELECT ${groupKey} AS g
        FROM media_items mi
        LEFT JOIN episodes ep ON ep.media_item_id = mi.id
        LEFT JOIN series se ON se.id = ep.series_id
        ${whereSql}
        GROUP BY ${groupKey}
      )
    `).get(params).c;
    const offset = (page - 1) * perPage;
    const rows = prepare(`
      SELECT ${groupKey} AS group_key,
             ${titleExpr} AS series_title,
             COALESCE(MAX(mi.custom_poster), MAX(se.poster_path), NULLIF(MIN(mi.thumbnail), '')) AS poster,
             MAX(se.rating) AS rating, MAX(se.overview) AS overview,
             MAX(se.year) AS year, MAX(se.backdrop_path) AS backdrop_path,
             MAX(se.id) AS series_id,
             MIN(mi.id) AS media_id, COUNT(*) AS episode_count,
             COUNT(DISTINCT mi.season) AS season_count
      FROM media_items mi
      LEFT JOIN episodes ep ON ep.media_item_id = mi.id
      LEFT JOIN series se ON se.id = ep.series_id
      ${whereSql}
      GROUP BY ${groupKey}
      ORDER BY ${orderSql} LIMIT @perPage OFFSET @offset
    `).all({ ...params, perPage, offset });
    return { total, page, perPage, items: rows.map((r) => ({ ...r, title: r.series_title })) };
  },

  listAnime() {
    return prepare(`SELECT * FROM media_items WHERE media_type = 'anime' AND type = 'video' AND hidden = 0`).all();
  },

  /**
   * Lista todos os episódios de uma série (por título normalizado), deduplicados
   * por (temporada, episódio) e enriquecidos com os metadados de episódio/série
   * quando casados. Usado na página de detalhes para mostrar a lista de episódios.
   */
  seriesEpisodes(normalizedTitle) {
    if (!normalizedTitle) return [];
    const rows = prepare(`
      SELECT mi.id AS media_id, mi.title AS raw_title, mi.season, mi.episode, mi.duration,
             mi.server_id, mi.metadata_status,
             ep.id AS episode_id, ep.title AS episode_title, ep.overview, ep.air_date,
             se.id AS series_id, se.title AS series_title, se.poster_path, se.backdrop_path,
             se.year AS series_year, se.rating AS series_rating, se.overview AS series_overview,
             se.original_title
      FROM media_items mi
      LEFT JOIN episodes ep ON ep.media_item_id = mi.id
      LEFT JOIN series se ON se.id = ep.series_id
      WHERE mi.normalized_title = ? AND mi.episode IS NOT NULL AND mi.type = 'video'
      ORDER BY COALESCE(mi.season, 0) ASC, mi.episode ASC
    `).all(normalizedTitle);

    const seen = new Map();
    for (const r of rows) {
      const k = `${r.season ?? 0}|${r.episode}`;
      const cur = seen.get(k);
      if (!cur || (!cur.episode_id && r.episode_id)) seen.set(k, r);
    }
    return [...seen.values()].sort((a, b) => ((a.season ?? 0) - (b.season ?? 0)) || (a.episode - b.episode));
  },
};

const movieRepo = {
  upsert(m) {
    prepare(`
      INSERT INTO movies (media_item_id, title, year, rating, overview, tagline, runtime, poster_path, backdrop_path, release_date, metadata_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(media_item_id) DO UPDATE SET
        title = excluded.title, year = excluded.year, rating = excluded.rating,
        overview = excluded.overview, tagline = excluded.tagline, runtime = excluded.runtime,
        poster_path = excluded.poster_path, backdrop_path = excluded.backdrop_path,
        release_date = excluded.release_date, metadata_source = excluded.metadata_source
    `).run(m.media_item_id, m.title, m.year ?? null, m.rating ?? null, m.overview ?? null, m.tagline ?? null, m.runtime ?? null, m.poster_path ?? null, m.backdrop_path ?? null, m.release_date ?? null, m.metadata_source ?? null);
  },

  byMediaItem(mediaItemId) {
    return prepare('SELECT * FROM movies WHERE media_item_id = ?').get(mediaItemId);
  },

  list({ genre, year, sort, page = 1, perPage = 48 }) {
    const where = [];
    const params = {};
    if (genre) { where.push('EXISTS (SELECT 1 FROM media_genres mg JOIN genres g ON g.id = mg.genre_id WHERE mg.media_item_id = mv.media_item_id AND g.name = @genre)'); params.genre = genre; }
    if (year) { where.push('mv.year = @year'); params.year = year; }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderSql = sort === 'title' ? 'mv.title COLLATE NOCASE ASC' : sort === 'year' ? 'mv.year DESC, mv.title ASC' : 'mv.media_item_id DESC';
    const total = prepare(`SELECT COUNT(*) AS c FROM movies mv ${whereSql}`).get(params).c;
    const offset = (page - 1) * perPage;
    const items = prepare(`
      SELECT mv.*, mi.server_id, mi.resolution, mi.format, mi.video_codec,
             (SELECT COUNT(*) FROM media_items x WHERE x.id = mv.media_item_id) AS sources
      FROM movies mv
      LEFT JOIN media_items mi ON mi.id = mv.media_item_id
      ${whereSql}
      ORDER BY ${orderSql} LIMIT @perPage OFFSET @offset
    `).all({ ...params, perPage, offset });
    return { total, page, perPage, items };
  },
};

const seriesRepo = {
  upsert(s) {
    const { lastInsertRowid } = prepare(`
      INSERT INTO series (title, original_title, year, rating, overview, poster_path, backdrop_path, status, metadata_source, metadata_ref, media_item_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(title, year) DO UPDATE SET
        rating = excluded.rating, overview = excluded.overview,
        poster_path = excluded.poster_path, backdrop_path = excluded.backdrop_path,
        status = excluded.status, metadata_source = excluded.metadata_source,
        metadata_ref = excluded.metadata_ref, media_item_id = excluded.media_item_id
    `).run(s.title, s.original_title ?? null, s.year ?? null, s.rating ?? null, s.overview ?? null, s.poster_path ?? null, s.backdrop_path ?? null, s.status ?? null, s.metadata_source ?? null, s.metadata_ref ?? null, s.media_item_id ?? null);
    const row = prepare('SELECT * FROM series WHERE title = ? AND year = ?').get(s.title, s.year);
    return row.id;
  },

  list({ genre, year, sort, page = 1, perPage = 48 }) {
    const where = [];
    const params = {};
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderSql = sort === 'title' ? 's.title COLLATE NOCASE ASC' : sort === 'year' ? 's.year DESC, s.title ASC' : 's.id DESC';
    const total = prepare(`SELECT COUNT(*) AS c FROM series s ${whereSql}`).get(params).c;
    const offset = (page - 1) * perPage;
    const items = prepare(`
      SELECT s.*, (SELECT COUNT(*) FROM episodes e WHERE e.series_id = s.id) AS episode_count,
             (SELECT COUNT(DISTINCT season_id) FROM episodes e WHERE e.series_id = s.id) AS season_count
      FROM series s ${whereSql}
      ORDER BY ${orderSql} LIMIT @perPage OFFSET @offset
    `).all({ ...params, perPage, offset });
    return { total, page, perPage, items };
  },

  get(id) {
    return prepare('SELECT * FROM series WHERE id = ?').get(id);
  },

  findOrCreateByTitle(title, year) {
    const row = prepare('SELECT * FROM series WHERE title = ?').get(title);
    if (row) return row.id;
    return this.upsert({ title, original_title: title, year, metadata_source: null, metadata_ref: null, media_item_id: null });
  },

  updateRef(id, patch) {
    const fields = [];
    const params = { id };
    for (const [k, v] of Object.entries(patch)) {
      fields.push(`${k} = @${k}`);
      params[k] = v;
    }
    if (!fields.length) return;
    prepare(`UPDATE series SET ${fields.join(', ')} WHERE id = @id`).run(params);
  },
};

const seasonRepo = {
  upsert({ series_id, season_number, title, overview, poster_path }) {
    prepare(`
      INSERT INTO seasons (series_id, season_number, title, overview, poster_path)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(series_id, season_number) DO UPDATE SET
        title = COALESCE(excluded.title, seasons.title),
        overview = COALESCE(excluded.overview, seasons.overview),
        poster_path = COALESCE(excluded.poster_path, seasons.poster_path)
    `).run(series_id, season_number, title, overview, poster_path);
    return prepare('SELECT * FROM seasons WHERE series_id = ? AND season_number = ?').get(series_id, season_number).id;
  },

  forSeries(seriesId) {
    return prepare('SELECT * FROM seasons WHERE series_id = ? ORDER BY season_number').all(seriesId);
  },
};

const episodeRepo = {
  upsert(e) {
    prepare(`
      INSERT INTO episodes (series_id, season_id, episode_number, title, overview, rating, air_date, media_item_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(series_id, episode_number, season_id) DO UPDATE SET
        title = COALESCE(excluded.title, episodes.title),
        overview = COALESCE(excluded.overview, episodes.overview),
        rating = COALESCE(excluded.rating, episodes.rating),
        air_date = COALESCE(excluded.air_date, episodes.air_date),
        media_item_id = COALESCE(excluded.media_item_id, episodes.media_item_id)
    `).run(e.series_id, e.season_id ?? null, e.episode_number, e.title ?? null, e.overview ?? null, e.rating ?? null, e.air_date ?? null, e.media_item_id ?? null);
  },

  forSeason(seasonId) {
    return prepare('SELECT * FROM episodes WHERE season_id = ? ORDER BY episode_number').all(seasonId);
  },

  byMediaItem(mediaItemId) {
    return prepare('SELECT * FROM episodes WHERE media_item_id = ?').get(mediaItemId);
  },

  nextEpisode(seriesId, seasonId, episodeNumber) {
    return prepare('SELECT * FROM episodes WHERE series_id = ? AND (season_id > ? OR (season_id = ? AND episode_number > ?)) ORDER BY season_id, episode_number LIMIT 1')
      .get(seriesId, seasonId, seasonId, episodeNumber);
  },
};

const genreRepo = {
  ensureNames(names) {
    const ids = [];
    for (const name of names) {
      prepare('INSERT INTO genres (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(name);
      ids.push(prepare('SELECT id FROM genres WHERE name = ?').get(name).id);
    }
    return ids;
  },
  setForMedia(mediaItemId, names) {
    prepare('DELETE FROM media_genres WHERE media_item_id = ?').run(mediaItemId);
    const ids = this.ensureNames(names);
    for (const gid of ids) {
      prepare('INSERT OR IGNORE INTO media_genres (media_item_id, genre_id) VALUES (?, ?)').run(mediaItemId, gid);
    }
  },
  all() {
    return prepare('SELECT name FROM genres ORDER BY name').all().map(r => r.name);
  },
};

const personRepo = {
  ensure(name) {
    prepare('INSERT INTO people (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(name);
    return prepare('SELECT id FROM people WHERE name = ?').get(name).id;
  },
  setForMedia(mediaItemId, people, role) {
    prepare('DELETE FROM media_people WHERE media_item_id = ? AND role = ?').run(mediaItemId, role);
    for (const name of people) {
      const pid = this.ensure(name);
      prepare('INSERT OR IGNORE INTO media_people (media_item_id, person_id, role) VALUES (?, ?, ?)').run(mediaItemId, pid, role);
    }
  },
  forMedia(mediaItemId) {
    return prepare(`
      SELECT p.name, mp.role FROM media_people mp JOIN people p ON p.id = mp.person_id
      WHERE mp.media_item_id = ? ORDER BY mp.role, p.name
    `).all(mediaItemId);
  },
};

const metadataCacheRepo = {
  get(key) {
    return prepare('SELECT * FROM metadata_cache WHERE key = ?').get(key);
  },
  set(key, type, data) {
    prepare(`
      INSERT INTO metadata_cache (key, type, data, fetched_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET data = excluded.data, fetched_at = datetime('now')
    `).run(key, type, JSON.stringify(data));
  },
  clearByTitle(title) {
    const t = `%${String(title || '').toLowerCase()}%`;
    prepare('DELETE FROM metadata_cache WHERE lower(key) LIKE ?').run(t);
  },
};

const jobRepo = {
  create({ type, server_id, total = 0 }) {
    const { lastInsertRowid } = prepare(`
      INSERT INTO scan_jobs (type, server_id, status, total) VALUES (?, ?, 'running', ?)
    `).run(type, server_id ?? null, total);
    return lastInsertRowid;
  },
  progress(id, current, total) {
    const pct = total > 0 ? Math.floor((current / total) * 100) : 0;
    prepare('UPDATE scan_jobs SET current = ?, total = ?, progress = ? WHERE id = ?').run(current, total, pct, id);
  },
  message(id, message) {
    prepare('UPDATE scan_jobs SET message = ? WHERE id = ?').run(message, id);
  },
  finish(id, status, error = null) {
    prepare('UPDATE scan_jobs SET status = ?, error = ?, finished_at = datetime(\'now\') WHERE id = ?').run(status, error, id);
  },
  get(id) {
    return prepare('SELECT * FROM scan_jobs WHERE id = ?').get(id);
  },
  list(limit = 50) {
    return prepare('SELECT * FROM scan_jobs ORDER BY id DESC LIMIT ?').all(limit);
  },
};

const historyRepo = {
  save({ media_item_id, position, duration, finished }) {
    prepare(`
      INSERT INTO playback_history (media_item_id, position, duration, finished, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(media_item_id) DO UPDATE SET
        position = excluded.position, duration = excluded.duration,
        finished = excluded.finished, updated_at = datetime('now')
    `).run(media_item_id, position, duration, finished ? 1 : 0);
  },
  get(mediaItemId) {
    return prepare('SELECT * FROM playback_history WHERE media_item_id = ?').get(mediaItemId);
  },
  list(limit = 50) {
    return prepare('SELECT * FROM playback_history ORDER BY updated_at DESC LIMIT ?').all(limit);
  },
};

const stateRepo = {
  get(key) {
    const r = prepare('SELECT value FROM sync_state WHERE key = ?').get(key);
    return r ? r.value : null;
  },
  set(key, value) {
    prepare('INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  },
};

module.exports = {
  serverRepo,
  mediaRepo,
  movieRepo,
  seriesRepo,
  seasonRepo,
  episodeRepo,
  genreRepo,
  personRepo,
  metadataCacheRepo,
  jobRepo,
  historyRepo,
  stateRepo,
  parseServices,
};
