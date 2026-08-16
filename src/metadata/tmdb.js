'use strict';

const { MetadataProvider } = require('./provider.js');
const { fetchWithTimeout } = require('./fetch.js');

const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w500';
const BACKDROP_IMG = 'https://image.tmdb.org/t/p/w1280';
const ORIGINAL_IMG = 'https://image.tmdb.org/t/p/original';

class TMDBProvider extends MetadataProvider {
  constructor(apiKey) {
    super('tmdb');
    this.apiKey = apiKey;
    this.enabled = !!apiKey;
  }

  async _get(path, params = {}) {
    if (!this.enabled) throw new Error('TMDB não configurado');
    await this._throttle();
    const url = new URL(BASE + path);
    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('language', 'pt-BR');
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
    const res = await fetchWithTimeout(url.toString());
    if (res.status === 429) throw new Error('TMDB rate limit');
    if (res.status === 401) throw new Error('TMDB API key inválida');
    if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
    return res.json();
  }

  _mapMovie(m, type = 'movie') {
    return {
      type,
      title: m.title || m.original_title,
      originalTitle: m.original_title,
      year: m.release_date ? parseInt(m.release_date.slice(0, 4), 10) : null,
      rating: m.vote_average || null,
      overview: m.overview || null,
      tagline: m.tagline || null,
      runtime: m.runtime || null,
      releaseDate: m.release_date || null,
      genres: (m.genres || []).map((g) => g.name),
      posterUrl: m.poster_path ? IMG + m.poster_path : null,
      posterOriginalUrl: m.poster_path ? ORIGINAL_IMG + m.poster_path : null,
      backdropUrl: m.backdrop_path ? BACKDROP_IMG + m.backdrop_path : null,
      credits: m.credits,
      externalIds: m.external_ids,
      provider: 'tmdb',
      providerId: String(m.id),
    };
  }

  _mapSeries(s) {
    return {
      type: 'series',
      title: s.name || s.original_name,
      originalTitle: s.original_name,
      year: s.first_air_date ? parseInt(s.first_air_date.slice(0, 4), 10) : null,
      rating: s.vote_average || null,
      overview: s.overview || null,
      genres: (s.genres || []).map((g) => g.name),
      posterUrl: s.poster_path ? IMG + s.poster_path : null,
      posterOriginalUrl: s.poster_path ? ORIGINAL_IMG + s.poster_path : null,
      backdropUrl: s.backdrop_path ? BACKDROP_IMG + s.backdrop_path : null,
      status: s.status || null,
      seasons: s.seasons ? s.seasons.map((se) => ({ number: se.season_number, name: se.name, overview: se.overview, posterUrl: se.poster_path ? IMG + se.poster_path : null })) : null,
      provider: 'tmdb',
      providerId: String(s.id),
    };
  }

  async search(query, type = 'movie') {
    const data = await this._get(`/search/${type}`, { query, include_adult: 'false' });
    return data.results || [];
  }

  async getMovie(id) {
    const data = await this._get(`/movie/${id}`, { append_to_response: 'credits,external_ids' });
    return this._mapMovie(data);
  }

  async getSeries(id) {
    const data = await this._get(`/tv/${id}`, { append_to_response: 'credits,external_ids' });
    return this._mapSeries(data);
  }

  async getSeason(seriesId, seasonNumber) {
    const data = await this._get(`/tv/${seriesId}/season/${seasonNumber}`);
    return {
      number: data.season_number,
      name: data.name,
      overview: data.overview,
      posterUrl: data.poster_path ? IMG + data.poster_path : null,
      episodes: data.episodes.map((e) => ({
        number: e.episode_number,
        title: e.name,
        overview: e.overview,
        rating: e.vote_average || null,
        airDate: e.air_date || null,
        stillUrl: e.still_path ? IMG + e.still_path : null,
      })),
    };
  }

  async getEpisode(seriesId, season, episode) {
    const seasonData = await this.getSeason(seriesId, season);
    return seasonData.episodes.find((e) => e.number === episode) || null;
  }

  async getAnime(query) {
    // TMDB não é ideal para animes; usa pesquisa de tv/movie e o AniList quando disponível
    const tv = await this.search(query, 'tv').catch(() => []);
    return tv.slice(0, 5);
  }
}

module.exports = { TMDBProvider, IMG, BACKDROP_IMG, ORIGINAL_IMG };
