'use strict';

const config = require('../config/config.js');
const logger = require('../config/logger.js');
const { TMDBProvider } = require('./tmdb.js');
const { TVMazeProvider } = require('./tvmaze.js');
const { AniListProvider } = require('./anilist.js');
const { JikanProvider } = require('./jikan.js');
const { getCachedImage } = require('../cache/images.js');
const { identifyFilename, cleanTag } = require('../library/identify.js');
const {
  movieRepo, seriesRepo, seasonRepo, episodeRepo, genreRepo, personRepo,
  metadataCacheRepo, mediaRepo,
} = require('../database/repositories.js');

const log = logger.child({ module: 'metadata.manager' });

const ANIME_HINTS = /\b(anime|ova|ona)\b/i;

const ANIME_TITLES = new Set([
  'one piece', 'naruto', 'naruto shippuden', 'boruto', 'dragon ball', 'dragon ball z',
  'dragon ball super', 'bleach', 'attack on titan', 'shingeki no kyojin', 'demon slayer',
  'kimetsu no yaiba', 'jujutsu kaisen', 'my hero academia', 'boku no hero academia',
  'fullmetal alchemist', 'death note', 'tokyo ghoul', 'sword art online', 'hunter x hunter',
  'fairy tail', 'black clover', 'one punch man', 'mob psycho 100', 'steins gate', 'vinland saga',
  'chainsaw man', 'spy x family', 'yu yu hakusho', 'digimon', 'pokemon',
  'sailor moon', 'inuyasha', 'detective conan', 'case closed', 'hajime no ippo', 'haikyuu',
  'berserk', 'cowboy bebop', 'evangelion', 'neon genesis evangelion',
  'death parade', 'parasyte', 'tokyo revengers', 'devil may cry', 'super cubo', 'supercub',
  're zero', 're:zero', 'konosuba', 'overlord', 'goblin slayer', 'reincarnated as a slime',
  'that time i got reincarnated as a slime', 'mushoku tensei', 'jobless reincarnation',
  'frieren', 'solo leveling', 'jujutsu', 'tokyo ghoul', 'naruto', 'boruto', 'bleach',
  'code geass', 'gurren lagann', 'k-on', 'kill la kill', 'bocchi the rock', 'spy family',
]);

function isLikelyAnime(title) {
  const t = cleanTag(title);
  if (ANIME_HINTS.test(t)) return true;
  for (const known of ANIME_TITLES) {
    if (t === known) return true;
    if (t.startsWith(known + ' ') || t.startsWith(known + ':')) return true;
    if (t.includes(' ' + known + ' ') || t.includes(' ' + known + ':')) return true;
  }
  return false;
}

/**
 * Títulos alternativos conhecidos (pt-BR → original/inglês) para facilitar o
 * casamento de filmes famosos quando a busca pelo título localizado falha.
 * Chave = título normalizado (sem acentos, minúsculo).
 */
const TITLE_ALIASES = {
  'as memorias de marnie': 'When Marnie Was There',
  'o castelo no ceu': 'Castle in the Sky',
  'sussurros do coracao': 'Whisper of the Heart',
  'lupin iii o castelo de cagliostro': 'Lupin III The Castle of Cagliostro',
  'lupin iii o ouro da babilonia': 'Lupin III The Gold of Babylon',
  'o menino e a garca': 'The Boy and the Heron',
  'o mundo dos pequeninos': 'The Secret World of Arrietty',
  'o reino dos gatos': 'The Cat Returns',
  'vidas ao vento': 'The Wind Rises',
  'o servico de entregas da kiki': "Kiki's Delivery Service",
  'princesa mononoke': 'Princess Mononoke',
  'porco rosso': 'Porco Rosso',
  'da colina kokuriko': 'From Up on Poppy Hill',
  'o conto da princesa kaguya': 'The Tale of the Princess Kaguya',
  'mary e a flor da feiticeira': "Mary and The Witch's Flower",
  'meu amigo totoro': 'My Neighbor Totoro',
  'a viagem de chihiro': 'Spirited Away',
  'o castelo animado': "Howl's Moving Castle",
  'ponyo': 'Ponyo',
};

function aliasFor(title) {
  return TITLE_ALIASES[normalize(title)] || null;
}

function normalize(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function levenshtein(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]) + 1;
    }
  }
  return dp[a.length][b.length];
}

function similarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) {
    // Contenção: se um título é prefixo/sufixo alinhado por palavra do outro
    // (ex: "Ponyo" vs "Ponyo - Uma Amizade que Veio do Mar"), é um bom casamento.
    const short = na.length <= nb.length ? na : nb;
    const long = na.length <= nb.length ? nb : na;
    const idx = long.indexOf(short);
    const aligned = idx === 0 || /[\s\-:.,;()[\]_/]/.test(long[idx - 1]);
    if (aligned) return 0.85 + 0.1 * (short.length / long.length);
    return Math.min(short.length, long.length) / Math.max(short.length, long.length) * 0.95;
  }
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return Math.max(0, 1 - dist / maxLen);
}

const ARTICLES = /^(the|a|an|o|os|as|la|los|las|el|les|le|il|lo|un|una|uno|der|die|das)\s+/i;

function stripArticles(s) {
  return String(s || '').replace(ARTICLES, '').trim();
}

/**
 * Título alternativo mais curto (antes de ":" / " - "), útil para buscas
 * quando o título completo inclui subtítulo que atrapalha o casamento.
 */
function altTitle(title) {
  const base = stripArticles(title).split(/\s*[:-]\s*/, 1)[0].trim();
  if (!base) return null;
  const clean = stripArticles(title);
  return base !== clean ? base : null;
}

function titleVariants(candidate) {
  const seen = new Set();
  const out = [];
  for (const t of [candidate.title, candidate.originalTitle, ...(candidate.altTitles || [])]) {
    const s = String(t || '').trim();
    if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s); }
  }
  return out;
}

/**
 * Máxima similaridade entre o título do arquivo e qualquer variação de título
 * do candidato (título, título original e títulos alternativos), considerando
 * também a remoção de artigos iniciais.
 */
function bestTitleSimilarity(query, candidate) {
  const variants = titleVariants(candidate);
  if (!variants.length) return 0;
  let best = 0;
  for (const v of variants) {
    best = Math.max(best, similarity(query, v));
    best = Math.max(best, similarity(stripArticles(query), stripArticles(v)));
  }
  return best;
}

function dedupeCandidates(list) {
  const seen = new Set();
  const out = [];
  for (const c of list || []) {
    if (!c) continue;
    const key = `${c.provider || ''}:${c.providerId || c.title || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function tokensOverlap(query, titles) {
  const words = new Set(String(query).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  if (!words.size) return false;
  for (const t of titles) {
    const tw = String(t).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    if (tw.some((w) => words.has(w))) return true;
  }
  return false;
}

/**
 * Confiança para o fallback de filmes sem API key (AniList/Jikan).
 * Títulos traduzidos não casam por similaridade de string, então usa
 * formato MOVIE, ano, sobreposição de tokens com títulos romaji/inglês
 * e, como último recurso, a quantidade de termos do título (evita que
 * consultas curtas/sem sentido casem com filmes errados).
 */
function fallbackScore(identify, candidate) {
  if (!candidate || !candidate.posterUrl) return 0;
  if (String(candidate.format || '').toLowerCase() !== 'movie') return 0;
  if (identify.year && candidate.year && Math.abs(identify.year - candidate.year) > 1) return 0;

  if (identify.year && candidate.year && Math.abs(identify.year - candidate.year) <= 1) return 0.7;
  if (tokensOverlap(identify.title, [candidate.title, candidate.originalTitle])) return 0.7;

  const words = String(identify.title).toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (words.length >= 3) return 0.55;
  return 0;
}

/**
 * Calcula a confiança de uma correspondência entre a mídia identificada e um candidato.
 * Retorna 0.0 - 1.0.
 */
function matchConfidence({ title, year, type, isAnime }, candidate) {
  if (!candidate || !candidate.title) return 0;
  let score = 0;

  const sim = bestTitleSimilarity(title, candidate);
  if (sim >= 0.9) score += 0.75;
  else if (sim >= 0.75) score += 0.6;
  else if (sim >= 0.55) score += 0.35;
  else if (sim >= 0.3) score += 0.15;
  else return 0;

  if (year && candidate.year) {
    if (year === candidate.year) score += 0.2;
    else if (Math.abs(year - candidate.year) <= 1) score += 0.1;
    else score -= 0.25;
  } else if (year && !candidate.year) {
    score += 0.05;
  }

  if (type && candidate.type) {
    if (type === candidate.type) score += 0.05;
  }

  if (isAnime && candidate.type === 'anime') score += 0.1;
  if (isAnime && candidate.type === 'series' && sim >= 0.85) score += 0.05;

  return Math.min(1, Math.max(0, score));
}

class MetadataManager {
  constructor() {
    this.providers = [];
    this.cache = metadataCacheRepo;
    this.initProviders();
  }

  initProviders() {
    const list = [];
    if (config.TMDB_ENABLED && config.TMDB_API_KEY) {
      list.push(new TMDBProvider(config.TMDB_API_KEY));
    } else if (config.TMDB_API_KEY) {
      log.warn('TMDB_API_KEY definida mas TMDB_ENABLED=false');
    }
    if (config.TVMAZE_ENABLED) list.push(new TVMazeProvider());
    if (config.ANILIST_ENABLED) list.push(new AniListProvider());
    if (config.JIKAN_ENABLED) list.push(new JikanProvider());
    this.providers = list;
    log.info('provedores de metadados inicializados', { providers: this.providers.map((p) => p.name) });
  }

  get enabled() {
    return config.ENABLE_METADATA && this.providers.length > 0;
  }

  _cacheKey(kind, ...parts) {
    return `${kind}:${parts.join('|')}`.toLowerCase();
  }

  async _cached(kind, parts, fetcher, ttlMs = 30 * 24 * 3600 * 1000) {
    const key = this._cacheKey(kind, ...parts);
    const cached = this.cache.get(key);
    if (cached) {
      const age = Date.now() - new Date(cached.fetched_at).getTime();
      if (age < ttlMs) {
        try { return JSON.parse(cached.data); } catch { /* refetch */ }
      }
    }
    const result = await fetcher();
    if (result) this.cache.set(key, kind, result);
    return result;
  }

  async _searchMovie(title, year) {
    const tmdb = this.providers.find((p) => p.name === 'tmdb');
    if (!tmdb) return null;
    return this._cached('search-movie', [title, year], async () => {
      const results = await tmdb.search(title, 'movie');
      const mapped = [];
      for (const r of results) {
        let full = r;
        try { full = await tmdb.getMovie(r.id); } catch { /* partial */ }
        mapped.push(full);
      }
      return mapped;
    });
  }

  /**
   * Fallback sem API key para filmes: AniList e Jikan (MyAnimeList).
   * Cobre filmes de anime, que também têm pôsteres nesses provedores.
   * Tenta várias formas do título (original, sem artigo, sem subtítulo).
   */
  async _searchMovieFallback(title, year) {
    const queries = new Set([title, stripArticles(title)]);
    const alt = altTitle(title);
    if (alt) queries.add(alt);
    const alias = aliasFor(title);
    if (alias) queries.add(alias);

    const sources = [];
    const ani = this.providers.find((p) => p.name === 'anilist');
    const jikan = this.providers.find((p) => p.name === 'jikan');
    for (const q of queries) {
      if (ani) {
        try {
          sources.push(await this._cached('search-movie-anilist', [q, year], () => ani.search(q, 'ANIME')));
        } catch (err) {
          log.debug('anilist indisponível para filme', { err: err.message });
        }
      }
      if (jikan) {
        try {
          sources.push(await this._cached('search-movie-jikan', [q, year], () => jikan.search(q, 'anime')));
        } catch (err) {
          log.debug('jikan indisponível para filme', { err: err.message });
        }
      }
    }
    return dedupeCandidates(sources.flat());
  }

  async _searchSeries(title, year, isAnime) {
    const sources = [];
    if (isAnime) {
      const ani = this.providers.find((p) => p.name === 'anilist');
      if (ani) {
        try {
          sources.push(await this._cached('search-anime', [title, year], () => ani.search(title, 'ANIME')));
        } catch (err) {
          log.debug('anilist indisponível, usando jikan', { err: err.message });
        }
      }
      const jikan = this.providers.find((p) => p.name === 'jikan');
      if (jikan) {
        try {
          sources.push(await this._cached('search-jikan', [title, year], () => jikan.search(title, 'anime')));
        } catch (err) {
          log.debug('jikan indisponível', { err: err.message });
        }
      }
    }
    const tmdb = this.providers.find((p) => p.name === 'tmdb');
    if (tmdb) {
      sources.push(await this._cached('search-tv', [title, year], async () => {
        const results = await tmdb.search(title, 'tv');
        const mapped = [];
        for (const r of results) {
          try { mapped.push(await tmdb.getSeries(r.id)); } catch { /* skip */ }
        }
        return mapped;
      }));
    }
    const tv = this.providers.find((p) => p.name === 'tvmaze');
    if (tv && !isAnime) {
      sources.push(await this._cached('search-tvmaze', [title, year], () => tv.search(title)));
    }
    return sources.flat();
  }

  async fetchMovie(mediaItem, identify) {
    const cacheKey = this._cacheKey('movie', identify.title, identify.year);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      try {
        const data = JSON.parse(cached.data);
        await this._applyMovie(mediaItem.id, data);
        return data;
      } catch { /* refetch */ }
    }

    const candidates = (await this._searchMovie(identify.title, identify.year)) || [];
    const alt = altTitle(identify.title);
    if (alt) {
      const more = (await this._searchMovie(alt, identify.year)) || [];
      candidates.push(...more);
    }
    const scored = dedupeCandidates(candidates)
      .map((c) => ({ c, score: matchConfidence({ title: identify.title, year: identify.year, type: 'movie' }, c) }))
      .sort((a, b) => b.score - a.score);
    // Prefere sempre o TMDB (título no idioma configurado) quando ele tem um
    // casamento decente; o fallback (AniList/Jikan, títulos em inglês) só entra
    // quando o TMDB não encontrou nada razoável.
    let best = scored[0] || null;
    if (!best || best.score < 0.6) {
      const fb = (await this._searchMovieFallback(identify.title, identify.year)) || [];
      const fbScored = fb
        .map((c) => ({ c, score: fallbackScore(identify, c) }))
        .sort((a, b) => b.score - a.score);
      const fbBest = fbScored[0];
      if (fbBest && fbBest.score >= 0.5 && (!best || fbBest.score > best.score)) {
        best = fbBest;
      }
    }

    if (best && (best.score >= 0.6 || best.c.provider !== 'tmdb')) {
      // Só guarda em cache o resultado do TMDB (título no idioma configurado);
      // fallbacks (AniList/Jikan) aplicam títulos em inglês e não devem
      // "envenenar" o cache, para permitir re-casamento quando o TMDB voltar.
      if (best.c.provider === 'tmdb') this.cache.set(cacheKey, 'movie', best.c);
      await this._applyMovie(mediaItem.id, best.c);
      return best.c;
    }
    mediaRepo.setMetadataStatus(mediaItem.id, 'unmatched');
    return null;
  }

  async fetchSeries(mediaItem, identify) {
    const isAnime = isLikelyAnime(identify.title);
    const cacheKey = this._cacheKey('series', identify.title, identify.year);
    const cached = this.cache.get(cacheKey);
    let data = null;
    if (cached) {
      try {
        data = JSON.parse(cached.data);
      } catch { data = null; }
    }
    if (!data) {
      const candidates = (await this._searchSeries(identify.title, identify.year, isAnime)) || [];
      const scored = candidates
        .map((c) => ({ c, score: matchConfidence({ title: identify.title, year: identify.year, type: 'series', isAnime }, c) }))
        .sort((a, b) => b.score - a.score);
      const best = scored[0];
      if (best && best.score >= 0.55) {
        data = best.c;
        this.cache.set(cacheKey, 'series', data);
      }
    }
    if (data) {
      await this._applySeries(mediaItem, identify, data, isAnime);
      return data;
    }
    mediaRepo.setMetadataStatus(mediaItem.id, 'unmatched');
    return null;
  }

  async _applyMovie(mediaItemId, m) {
    const poster = (m.posterUrl ? await getCachedImage('posters', m.posterUrl) : null)
      || (m.posterOriginalUrl ? await getCachedImage('posters', m.posterOriginalUrl) : null);
    const backdrop = m.backdropUrl ? await getCachedImage('backdrops', m.backdropUrl) : null;

    movieRepo.upsert({
      media_item_id: mediaItemId,
      title: m.title,
      year: m.year,
      rating: m.rating,
      overview: m.overview,
      tagline: m.tagline,
      runtime: m.runtime,
      poster_path: poster || backdrop,
      backdrop_path: backdrop,
      release_date: m.releaseDate,
      metadata_source: m.provider,
    });
    if (m.genres) genreRepo.setForMedia(mediaItemId, m.genres);
    if (m.credits) {
      const cast = (m.credits.cast || []).slice(0, 12).map((c) => c.name);
      const crew = (m.credits.crew || []).filter((c) => c.job === 'Director').map((c) => c.name);
      if (cast.length) personRepo.setForMedia(mediaItemId, cast, 'actor');
      if (crew.length) personRepo.setForMedia(mediaItemId, crew, 'director');
    }
    mediaRepo.updateMetadata(mediaItemId, { genre: (m.genres || []).slice(0, 4).join(', ') });
    mediaRepo.setMetadataStatus(mediaItemId, 'matched');
    log.info('metadados de filme aplicados', { id: mediaItemId, title: m.title, score: m.rating });
  }

  async _applySeries(mediaItem, identify, s, isAnime) {
    const poster = (s.posterUrl ? await getCachedImage('posters', s.posterUrl) : null)
      || (s.posterOriginalUrl ? await getCachedImage('posters', s.posterOriginalUrl) : null);
    const backdrop = s.backdropUrl ? await getCachedImage('backdrops', s.backdropUrl) : null;

    const seriesId = seriesRepo.upsert({
      title: s.title,
      original_title: s.originalTitle || s.title,
      year: s.year,
      rating: s.rating,
      overview: s.overview,
      poster_path: poster || backdrop,
      backdrop_path: backdrop,
      status: s.status,
      metadata_source: s.provider,
      metadata_ref: s.providerId,
      media_item_id: mediaItem.id,
    });

    mediaRepo.updateMetadata(mediaItem.id, { genre: (s.genres || []).slice(0, 4).join(', '), media_type: isAnime ? 'anime' : 'series' });
    if (s.genres) genreRepo.setForMedia(mediaItem.id, s.genres);
    mediaRepo.setMetadataStatus(mediaItem.id, 'matched');

    // Cria o registro do episódio atual
    await this._linkEpisode(mediaItem, identify, seriesId, s);

    log.info('metadados de série aplicados', { id: mediaItem.id, title: s.title, seriesId, isAnime });
    return seriesId;
  }

  async _linkEpisode(mediaItem, identify, seriesId, seriesMeta) {
    const seasonNumber = identify.season ?? 1;
    let seasonId = null;
    const existingSeason = seasonRepo.forSeries(seriesId).find((x) => x.season_number === seasonNumber);
    if (existingSeason) seasonId = existingSeason.id;

    let episodeTitle = null;
    let episodeOverview = null;
    let episodeRating = null;
    let airDate = null;
    try {
      if (seriesMeta.provider === 'tmdb') {
        const tmdb = this.providers.find((p) => p.name === 'tmdb');
        const seasonData = await this._cached(`tmdb-season:${seriesMeta.providerId}:${seasonNumber}`, [], () => tmdb.getSeason(seriesMeta.providerId, seasonNumber));
        if (seasonData) {
          const seasonInfo = seriesMeta.seasons && seriesMeta.seasons.find((x) => x.number === seasonNumber);
          seasonId = seasonRepo.upsert({ series_id: seriesId, season_number: seasonNumber, title: seasonInfo ? seasonInfo.name : null, overview: seasonData.overview || null, poster_path: seasonData.posterUrl ? await getCachedImage('posters', seasonData.posterUrl) : null });
          const ep = seasonData.episodes.find((e) => e.number === identify.episode);
          if (ep) { episodeTitle = ep.title; episodeOverview = ep.overview; episodeRating = ep.rating; airDate = ep.airDate; }
        }
      } else if (seriesMeta.provider === 'tvmaze') {
        const tv = this.providers.find((p) => p.name === 'tvmaze');
        const seasonData = await this._cached(`tvmaze-season:${seriesMeta.providerId}:${seasonNumber}`, [], () => tv.getSeason(seriesMeta.providerId, seasonNumber));
        if (seasonData) {
          seasonId = seasonRepo.upsert({ series_id: seriesId, season_number: seasonNumber, title: null, overview: null, poster_path: null });
          const ep = seasonData.episodes.find((e) => e.number === identify.episode);
          if (ep) { episodeTitle = ep.title; episodeOverview = ep.overview; episodeRating = ep.rating; airDate = ep.airDate; }
        }
      } else {
        seasonId = seasonRepo.upsert({ series_id: seriesId, season_number: seasonNumber, title: null, overview: null, poster_path: null });
      }
    } catch (err) {
      log.debug('falha ao buscar episódio', { err: err.message });
      seasonId = seasonRepo.upsert({ series_id: seriesId, season_number: seasonNumber, title: null, overview: null, poster_path: null });
    }

    episodeRepo.upsert({
      series_id: seriesId,
      season_id: seasonId,
      episode_number: identify.episode,
      title: episodeTitle,
      overview: episodeOverview,
      rating: episodeRating,
      air_date: airDate,
      media_item_id: mediaItem.id,
    });
  }

  async enrich(mediaItem, identify) {
    if (!this.enabled) return null;
    try {
      if (identify.type === 'movie') {
        return await this.fetchMovie(mediaItem, identify);
      }
      return await this.fetchSeries(mediaItem, identify);
    } catch (err) {
      log.warn('falha no enriquecimento de metadados', { id: mediaItem.id, title: identify.title, err: err.message });
      return null;
    }
  }
}

module.exports = { MetadataManager, matchConfidence, similarity, isLikelyAnime, normalize, fallbackScore };
