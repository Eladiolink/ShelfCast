'use strict';

const { MetadataProvider } = require('./provider.js');
const { fetchWithTimeout } = require('./fetch.js');

const BASE = 'https://api.jikan.moe/v4';

class JikanProvider extends MetadataProvider {
  constructor() {
    super('jikan');
    this.enabled = true;
    this.rateLimitMs = 1500; // Jikan tem limite estrito (~3 req/s)
  }

  async _get(path) {
    await this._throttle();
    const res = await fetchWithTimeout(BASE + path);
    if (res.status === 429) throw new Error('Jikan rate limit');
    if (!res.ok) throw new Error(`Jikan HTTP ${res.status}`);
    return res.json();
  }

  _map(a) {
    const t = a.titles || [];
    const findTitle = (kind) => (t.find((x) => x.type === kind) || {}).title || a.title;
    return {
      type: 'anime',
      title: findTitle('English') || a.title_english || a.title,
      originalTitle: a.title_japanese || a.title,
      year: a.year || (a.aired && a.aired.from ? parseInt(a.aired.from.slice(0, 4), 10) : null),
      rating: a.score || null,
      overview: a.synopsis ? a.synopsis.replace(/<[^>]+>/g, '').trim() : null,
      genres: (a.genres || []).map((g) => g.name),
      episodes: a.episodes || null,
      status: a.status || null,
      posterUrl: a.images?.jpg?.large_image_url || null,
      posterOriginalUrl: a.images?.jpg?.large_image_url || null,
      backdropUrl: null,
      format: a.type || null,
      provider: 'jikan',
      providerId: String(a.mal_id),
      externalIds: { mal: a.mal_id },
    };
  }

  async search(query, type = 'anime') {
    const data = await this._get(`/${type}?q=${encodeURIComponent(query)}&limit=8&sfw=true`);
    return (data.data || []).map((a) => this._map(a));
  }

  async getAnime(query) {
    const results = await this.search(query);
    return results[0] || null;
  }

  async getAnimeById(id) {
    const data = await this._get(`/anime/${id}/full`);
    return data.data ? this._map(data.data) : null;
  }

  async getMovie() { return null; }
  async getSeries() { return null; }
  async getEpisode() { return null; }
}

module.exports = { JikanProvider };
