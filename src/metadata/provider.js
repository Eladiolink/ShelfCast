'use strict';

const config = require('../config/config.js');
const logger = require('../config/logger.js');

const log = logger.child({ module: 'metadata' });

class MetadataProvider {
  constructor(name) {
    this.name = name;
    this.enabled = true;
    this.rateLimitMs = config.METADATA_RATE_LIMIT_MS;
    this._lastRequest = 0;
  }

  async _throttle() {
    const now = Date.now();
    const wait = this.rateLimitMs - (now - this._lastRequest);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this._lastRequest = Date.now();
  }

  async search(query) { throw new Error('not implemented'); }
  async getMovie(id) { throw new Error('not implemented'); }
  async getSeries(id) { throw new Error('not implemented'); }
  async getEpisode(seriesId, season, episode) { throw new Error('not implemented'); }
  async getAnime(query) { throw new Error('not implemented'); }
}

module.exports = { MetadataProvider, log };
