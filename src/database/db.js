'use strict';

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config/config.js');
const logger = require('../config/logger.js');

const log = logger.child({ module: 'db' });
let db = null;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'dlna',
  path TEXT,
  manufacturer TEXT,
  model TEXT,
  ip TEXT,
  port INTEGER,
  description_url TEXT,
  control_url TEXT,
  event_sub_url TEXT,
  services TEXT,
  icon_url TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  enabled INTEGER NOT NULL DEFAULT 1,
  paused INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  last_seen TEXT,
  last_sync_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS media_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  object_id TEXT NOT NULL,
  parent_id TEXT,
  title TEXT NOT NULL,
  original_title TEXT,
  type TEXT NOT NULL,
  media_type TEXT,
  url TEXT,
  duration REAL,
  format TEXT,
  video_codec TEXT,
  audio_codec TEXT,
  width INTEGER,
  height INTEGER,
  bitrate INTEGER,
  mime_type TEXT,
  size INTEGER,
  thumbnail TEXT,
  season INTEGER,
  episode INTEGER,
  year INTEGER,
  date TEXT,
  album TEXT,
  artist TEXT,
  genre TEXT,
  description TEXT,
  resolution TEXT,
  hdr INTEGER DEFAULT 0,
  audio_channels INTEGER,
  subtitles TEXT,
  metadata_status TEXT NOT NULL DEFAULT 'none',
  hidden INTEGER NOT NULL DEFAULT 0,
  local_path TEXT,
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(server_id, object_id)
);

CREATE INDEX IF NOT EXISTS idx_media_title ON media_items(title);
CREATE INDEX IF NOT EXISTS idx_media_server ON media_items(server_id);
CREATE INDEX IF NOT EXISTS idx_media_type ON media_items(type);
CREATE INDEX IF NOT EXISTS idx_media_season ON media_items(season);
CREATE INDEX IF NOT EXISTS idx_media_episode ON media_items(episode);
CREATE INDEX IF NOT EXISTS idx_media_year ON media_items(year);
CREATE INDEX IF NOT EXISTS idx_media_media_type ON media_items(media_type);

-- Título normalizado (nome limpo de tags/qualidade) usado para agrupar séries
-- e listar filmes. Adicionada por migração para bancos antigos.

CREATE TABLE IF NOT EXISTS metadata_cache (
  key TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cache_type ON metadata_cache(type, fetched_at);

CREATE TABLE IF NOT EXISTS genres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS media_genres (
  media_item_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  PRIMARY KEY (media_item_id, genre_id)
);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS media_people (
  media_item_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'actor',
  PRIMARY KEY (media_item_id, person_id, role)
);

CREATE TABLE IF NOT EXISTS movies (
  media_item_id INTEGER PRIMARY KEY REFERENCES media_items(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  year INTEGER,
  rating REAL,
  overview TEXT,
  tagline TEXT,
  runtime INTEGER,
  poster_path TEXT,
  backdrop_path TEXT,
  release_date TEXT,
  metadata_source TEXT
);
CREATE INDEX IF NOT EXISTS idx_movies_title ON movies(title);
CREATE INDEX IF NOT EXISTS idx_movies_year ON movies(year);

CREATE TABLE IF NOT EXISTS series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  original_title TEXT,
  year INTEGER,
  rating REAL,
  overview TEXT,
  poster_path TEXT,
  backdrop_path TEXT,
  status TEXT,
  metadata_source TEXT,
  metadata_ref TEXT,
  media_item_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_series_title ON series(title);
CREATE UNIQUE INDEX IF NOT EXISTS idx_series_title_year ON series(title, year);

CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  title TEXT,
  overview TEXT,
  poster_path TEXT,
  UNIQUE(series_id, season_number)
);

CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  season_id INTEGER REFERENCES seasons(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL,
  title TEXT,
  overview TEXT,
  rating REAL,
  air_date TEXT,
  media_item_id INTEGER REFERENCES media_items(id) ON DELETE SET NULL,
  UNIQUE(series_id, episode_number, season_id)
);

CREATE INDEX IF NOT EXISTS idx_episodes_series ON episodes(series_id);
CREATE INDEX IF NOT EXISTS idx_episodes_media ON episodes(media_item_id);

CREATE TABLE IF NOT EXISTS scan_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  server_id INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  progress INTEGER NOT NULL DEFAULT 0,
  current INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON scan_jobs(status);

CREATE TABLE IF NOT EXISTS playback_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_item_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  position REAL NOT NULL DEFAULT 0,
  duration REAL NOT NULL DEFAULT 0,
  finished INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(media_item_id)
);
CREATE INDEX IF NOT EXISTS idx_history_updated ON playback_history(updated_at);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

const MIGRATIONS = [
  ['normalized_title', 'ALTER TABLE media_items ADD COLUMN normalized_title TEXT'],
  ['hidden', 'ALTER TABLE media_items ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0'],
  ['manual_title', 'ALTER TABLE media_items ADD COLUMN manual_title TEXT'],
  ['custom_poster', 'ALTER TABLE media_items ADD COLUMN custom_poster TEXT'],
  ['custom_thumbnail', 'ALTER TABLE media_items ADD COLUMN custom_thumbnail TEXT'],
  ['server_type', "ALTER TABLE servers ADD COLUMN type TEXT NOT NULL DEFAULT 'dlna'"],
  ['server_path', 'ALTER TABLE servers ADD COLUMN path TEXT'],
  ['media_local_path', 'ALTER TABLE media_items ADD COLUMN local_path TEXT'],
];

function migrate() {
  const existing = db.prepare('PRAGMA table_info(media_items)').all().map((r) => r.name);
  for (const [col, sql] of MIGRATIONS) {
    if (!existing.includes(col)) {
      try {
        db.exec(sql);
        log.info('migração aplicada', { column: col });
      } catch (err) {
        log.warn('falha na migração', { column: col, err: err.message });
      }
    }
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_media_norm ON media_items(normalized_title)`);
}

function open() {
  config.ensureDirs();
  db = new DatabaseSync(config.DATABASE_PATH);
  db.exec(SCHEMA);
  migrate();
  log.info('database opened', { path: config.DATABASE_PATH });
  return db;
}

function get() {
  if (!db) open();
  return db;
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

function prepare(sql) {
  return get().prepare(sql);
}

module.exports = { open, get, close, prepare, SCHEMA };
