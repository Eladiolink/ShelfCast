'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ENV = path.resolve(process.cwd(), '.env');

function parseEnvFile(filePath) {
  const vars = {};
  if (!fs.existsSync(filePath)) return vars;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value.length >= 2 && value[0] === '"' && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

const env = { ...parseEnvFile(DEFAULT_ENV), ...process.env };

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const ROOT = path.resolve(__dirname, '..', '..');

const config = {
  ROOT,
  HOST: env.HOST || '0.0.0.0',
  PORT: num(env.PORT, 8080),
  DATABASE_PATH: path.resolve(ROOT, env.DATABASE_PATH || './data/library.db'),
  DATA_DIR: path.resolve(ROOT, env.DATA_DIR || './data'),
  SCAN_INTERVAL: env.SCAN_INTERVAL || '30m',
  DISCOVERY_INTERVAL: env.DISCOVERY_INTERVAL || '10m',
  ENABLE_METADATA: bool(env.ENABLE_METADATA, true),
  TMDB_API_KEY: env.TMDB_API_KEY || '',
  TMDB_ENABLED: bool(env.TMDB_ENABLED, !!env.TMDB_API_KEY),
  TVMAZE_ENABLED: bool(env.TVMAZE_ENABLED, true),
  ANILIST_ENABLED: bool(env.ANILIST_ENABLED, true),
  JIKAN_ENABLED: bool(env.JIKAN_ENABLED, true),
  FFMPEG_PATH: env.FFMPEG_PATH || 'ffmpeg',
  FFPROBE_PATH: env.FFPROBE_PATH || 'ffprobe',
  ENABLE_TRANSCODE: bool(env.ENABLE_TRANSCODE, true),
  ENABLE_HW_TRANSCODE: bool(env.ENABLE_HW_TRANSCODE, true),
  HW_ACCEL: env.HW_ACCEL || 'auto',
  LOG_LEVEL: (env.LOG_LEVEL || 'info').toLowerCase(),
  STREAM_BUFFER: num(env.STREAM_BUFFER, 1024 * 1024 * 4),
  HTTP_TIMEOUT: num(env.HTTP_TIMEOUT, 30000),
  MAX_SCAN_CONCURRENCY: num(env.MAX_SCAN_CONCURRENCY, 2),
  METADATA_RATE_LIMIT_MS: num(env.METADATA_RATE_LIMIT_MS, 250),
  SOCKET_TIMEOUT: num(env.SOCKET_TIMEOUT, 0),
};

const INTERVALS = {
  '1m': 60_000,
  '5m': 300_000,
  '10m': 600_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '6h': 21_600_000,
  '12h': 43_200_000,
  '24h': 86_400_000,
};

config.SCAN_INTERVAL_MS = INTERVALS[config.SCAN_INTERVAL] || 1_800_000;
config.DISCOVERY_INTERVAL_MS = INTERVALS[config.DISCOVERY_INTERVAL] || 600_000;

config.ensureDirs = function ensureDirs() {
  const dirs = [
    config.DATA_DIR,
    path.dirname(config.DATABASE_PATH),
    path.join(config.DATA_DIR, 'posters'),
    path.join(config.DATA_DIR, 'backdrops'),
    path.join(config.DATA_DIR, 'thumbnails'),
    path.join(config.DATA_DIR, 'cache'),
    path.join(config.DATA_DIR, 'logs'),
  ];
  for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });
};

module.exports = config;
