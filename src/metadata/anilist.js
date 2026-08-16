'use strict';

const { MetadataProvider } = require('./provider.js');
const { fetchWithTimeout } = require('./fetch.js');

const BASE = 'https://graphql.anilist.co';

const SEARCH_QUERY = `
query ($q: String, $type: MediaType) {
  Page(perPage: 8) {
    media(search: $q, type: $type, isAdult: false) {
      id
      idMal
      title { romaji english native }
      startDate { year }
      averageScore
      description
      genres
      episodes
      seasonYear
      coverImage { extraLarge large medium }
      bannerImage
      format
      status
    }
  }
}`;

const SEASON_QUERY = `
query ($id: Int) {
  Media(id: $id) {
    title { romaji english native }
    mediaListEntry { progress }
  }
}`;

class AniListProvider extends MetadataProvider {
  constructor() {
    super('anilist');
    this.enabled = true;
  }

  async _post(query, variables) {
    await this._throttle();
    const res = await fetchWithTimeout(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'MediaLibrary/1.0' },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) throw new Error('AniList rate limit');
    if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
    const data = await res.json();
    if (data.errors) throw new Error('AniList: ' + (data.errors[0] || {}).message);
    return data.data;
  }

  _map(media) {
    const t = media.title || {};
    return {
      type: 'anime',
      title: t.english || t.romaji || t.native,
      originalTitle: t.romaji || t.english || t.native,
      year: (media.seasonYear || media.startDate?.year) || null,
      rating: media.averageScore ? media.averageScore / 10 : null,
      overview: media.description ? media.description.replace(/<[^>]+>/g, '').trim() : null,
      genres: media.genres || [],
      episodes: media.episodes || null,
      status: media.status || null,
      posterUrl: media.coverImage ? media.coverImage.large : null,
      posterOriginalUrl: media.coverImage ? media.coverImage.extraLarge : null,
      backdropUrl: media.bannerImage || null,
      format: media.format || null,
      provider: 'anilist',
      providerId: String(media.id),
      externalIds: { mal: media.idMal || null },
    };
  }

  async search(query, type = 'ANIME') {
    const data = await this._post(SEARCH_QUERY, { q: query, type });
    return (data.Page.media || []).map((m) => this._map(m));
  }

  async getAnime(query) {
    const results = await this.search(query);
    return results[0] || null;
  }

  async getAnimeById(id) {
    const data = await this._post(`
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id idMal
          title { romaji english native }
          startDate { year }
          averageScore description genres episodes seasonYear
          coverImage { extraLarge large medium } bannerImage format status
        }
      }`, { id });
    return data.Media ? this._map(data.Media) : null;
  }

  async getMovie() { return null; }
  async getSeries() { return null; }
  async getEpisode() { return null; }
}

module.exports = { AniListProvider };
