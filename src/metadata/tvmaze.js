'use strict';

const { MetadataProvider } = require('./provider.js');
const { fetchWithTimeout } = require('./fetch.js');

const BASE = 'https://api.tvmaze.com';

class TVMazeProvider extends MetadataProvider {
  constructor() {
    super('tvmaze');
    this.enabled = true;
  }

  async _get(path) {
    await this._throttle();
    const res = await fetchWithTimeout(BASE + path);
    if (res.status === 429) throw new Error('TVMaze rate limit');
    if (!res.ok) throw new Error(`TVMaze HTTP ${res.status}`);
    return res.json();
  }

  _mapShow(s) {
    const airdate = s.premiered || null;
    return {
      type: 'series',
      title: s.name,
      originalTitle: s.name,
      year: airdate ? parseInt(airdate.slice(0, 4), 10) : null,
      rating: s.rating && s.rating.average ? s.rating.average : null,
      overview: s.summary ? s.summary.replace(/<[^>]+>/g, '').trim() : null,
      genres: s.genres || [],
      posterUrl: s.image ? s.image.medium : null,
      posterOriginalUrl: s.image ? s.image.original : null,
      status: s.status || null,
      provider: 'tvmaze',
      providerId: String(s.id),
      seasons: s._embedded ? s._embedded.seasons.map((se) => ({ number: se.number, name: se.name, overview: null, posterUrl: null })) : null,
      schedule: s.schedule || null,
      network: s.network ? s.network.name : null,
    };
  }

  async search(query) {
    const data = await this._get(`/search/shows?q=${encodeURIComponent(query)}`);
    return data.map((r) => this._mapShow(r.show));
  }

  async getSeries(id) {
    const data = await this._get(`/shows/${id}?embed=seasons`);
    return this._mapShow(data);
  }

  async getSeason(seriesId, seasonNumber) {
    const data = await this._get(`/shows/${seriesId}/seasons`);
    const season = data.find((s) => s.number === seasonNumber);
    if (!season) return null;
    const episodes = await this._get(`/seasons/${season.id}/episodes`);
    return {
      number: season.number,
      name: season.name,
      overview: null,
      posterUrl: season.image ? season.image.medium : null,
      episodes: episodes.map((e) => ({
        number: e.number,
        title: e.name,
        overview: e.summary ? e.summary.replace(/<[^>]+>/g, '').trim() : null,
        rating: e.rating && e.rating.average ? e.rating.average : null,
        airDate: e.airdate || null,
      })),
    };
  }

  async getEpisode(seriesId, season, episode) {
    const data = await this.getSeason(seriesId, season);
    if (!data) return null;
    return data.episodes.find((e) => e.number === episode) || null;
  }

  async getMovie() { return null; }
  async getAnime(query) { return this.search(query); }
}

module.exports = { TVMazeProvider };
