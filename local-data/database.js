/**
 * NovaPlay — Local Database
 *
 * Reuses NovaTune's better-sqlite3 storage approach, adapted for video
 * metadata: videos table (instead of tracks), playlists, playlist_videos,
 * watch_history. Pure-local, no cloud, no network.
 *
 * Loaded lazily by the IPC layer so a missing native addon doesn't crash
 * the boot — the IPC layer catches the error and falls back to an in-memory
 * shim so the UI still renders.
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { ensureDirSync } = require('../app-shell/windowManager');

let Database = null;
let db = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  title TEXT,
  filePath TEXT UNIQUE,
  duration REAL,
  width INTEGER,
  height INTEGER,
  codec TEXT,
  fps REAL,
  bitrate INTEGER,
  size INTEGER,
  dateAdded INTEGER,
  lastPlayed INTEGER,
  playCount INTEGER DEFAULT 0,
  folder TEXT,
  data TEXT
);
CREATE INDEX IF NOT EXISTS idx_videos_title      ON videos(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_videos_date_added  ON videos(dateAdded DESC);
CREATE INDEX IF NOT EXISTS idx_videos_last_played ON videos(lastPlayed DESC);
CREATE INDEX IF NOT EXISTS idx_videos_folder     ON videos(folder);

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  createdAt INTEGER,
  updatedAt INTEGER
);
CREATE INDEX IF NOT EXISTS idx_playlists_updated ON playlists(updatedAt DESC);

CREATE TABLE IF NOT EXISTS playlist_videos (
  playlistId TEXT NOT NULL,
  videoId TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  addedAt INTEGER NOT NULL,
  PRIMARY KEY (playlistId, videoId)
);
CREATE INDEX IF NOT EXISTS idx_playlist_videos_playlist ON playlist_videos(playlistId, position);
CREATE INDEX IF NOT EXISTS idx_playlist_videos_video    ON playlist_videos(videoId);

CREATE TABLE IF NOT EXISTS watch_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  videoId TEXT NOT NULL,
  watchedAt INTEGER NOT NULL,
  position REAL DEFAULT 0,
  duration REAL DEFAULT 0,
  completed INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_history_watched ON watch_history(watchedAt DESC);
CREATE INDEX IF NOT EXISTS idx_history_video  ON watch_history(videoId);

CREATE TABLE IF NOT EXISTS thumbnails (
  videoId TEXT PRIMARY KEY,
  thumbPath TEXT,
  generatedAt INTEGER,
  width INTEGER,
  height INTEGER
);
`;

function getDbPath() {
  const dataDir = process.env.NODE_ENV === 'development'
    ? path.join(__dirname, '..', 'data')
    : (app?.getPath?.('userData') || path.join(require('os').tmpdir(), 'NovaPlay'));
  ensureDirSync(dataDir);
  return path.join(dataDir, 'novaplay.db');
}

function open() {
  if (db) return db;
  try {
    Database = require('better-sqlite3');
  } catch (err) {
    console.error('[db] better-sqlite3 failed to load:', err.message);
    return null;
  }
  const dbPath = getDbPath();
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  console.log('[db] opened at', dbPath);
  return db;
}

function close() {
  try { db?.close(); } catch (_) {}
  db = null;
}

// ─── Query helpers ──────────────────────────────────────────────────
function allVideos() {
  if (!open()) return [];
  return db.prepare('SELECT * FROM videos ORDER BY dateAdded DESC').all();
}

function getVideo(id) {
  if (!open()) return null;
  return db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
}

function getVideoByPath(filePath) {
  if (!open()) return null;
  return db.prepare('SELECT * FROM videos WHERE filePath = ?').get(filePath);
}

function upsertVideo(video) {
  if (!open()) return null;
  const existingByPath = db.prepare('SELECT * FROM videos WHERE filePath = ?').get(video.filePath);
  const existingById = db.prepare('SELECT * FROM videos WHERE id = ?').get(video.id);

  const finalId = existingByPath ? existingByPath.id : video.id;
  const oldRecord = existingByPath || existingById;

  // Clean up any row that conflicts on id or filePath to guarantee unique insertion
  if (existingById && existingById.id !== finalId) {
    db.prepare('DELETE FROM videos WHERE id = ?').run(existingById.id);
  }
  if (existingByPath && existingByPath.id !== finalId) {
    db.prepare('DELETE FROM videos WHERE id = ?').run(existingByPath.id);
  }

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO videos (id, title, filePath, duration, width, height, codec, fps, bitrate, size, dateAdded, lastPlayed, playCount, folder, data)
    VALUES (@id, @title, @filePath, @duration, @width, @height, @codec, @fps, @bitrate, @size, @dateAdded, @lastPlayed, @playCount, @folder, @data)
  `);

  return stmt.run({
    id: finalId,
    title: video.title || oldRecord?.title || '',
    filePath: video.filePath,
    duration: video.duration || oldRecord?.duration || 0,
    width: video.width || oldRecord?.width || 0,
    height: video.height || oldRecord?.height || 0,
    codec: video.codec || oldRecord?.codec || '',
    fps: video.fps || oldRecord?.fps || 0,
    bitrate: video.bitrate || oldRecord?.bitrate || 0,
    size: video.size || oldRecord?.size || 0,
    dateAdded: oldRecord?.dateAdded || video.dateAdded || Date.now(),
    lastPlayed: oldRecord?.lastPlayed || video.lastPlayed || 0,
    playCount: oldRecord?.playCount || video.playCount || 0,
    folder: video.folder || oldRecord?.folder || '',
    data: JSON.stringify(video.data || (oldRecord?.data ? JSON.parse(oldRecord.data) : {}))
  });
}

function removeVideo(id) {
  if (!open()) return 0;
  return db.prepare('DELETE FROM videos WHERE id = ?').run(id).changes;
}

function recordWatch(videoId, position, duration, completed) {
  if (!open()) return null;
  db.prepare('UPDATE videos SET lastPlayed = ?, playCount = playCount + 1 WHERE id = ?')
    .run(Date.now(), videoId);
  return db.prepare(`
    INSERT INTO watch_history (videoId, watchedAt, position, duration, completed)
    VALUES (?, ?, ?, ?, ?)
  `).run(videoId, Date.now(), position, duration, completed ? 1 : 0);
}

function getWatchHistory(limit = 100) {
  if (!open()) return [];
  return db.prepare(`
    SELECT wh.*, v.title, v.filePath, v.duration
    FROM watch_history wh
    LEFT JOIN videos v ON v.id = wh.videoId
    ORDER BY wh.watchedAt DESC
    LIMIT ?
  `).all(limit);
}

function clearWatchHistory() {
  if (!open()) return 0;
  return db.prepare('DELETE FROM watch_history').run().changes;
}

// ─── Playlists ──────────────────────────────────────────────────────
function allPlaylists() {
  if (!open()) return [];
  return db.prepare('SELECT * FROM playlists ORDER BY updatedAt DESC').all();
}

function createPlaylist(name) {
  if (!open()) return null;
  const id = 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const now = Date.now();
  db.prepare('INSERT INTO playlists (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)').run(id, name, now, now);
  return { id, name, createdAt: now, updatedAt: now };
}

function deletePlaylist(id) {
  if (!open()) return 0;
  db.prepare('DELETE FROM playlist_videos WHERE playlistId = ?').run(id);
  return db.prepare('DELETE FROM playlists WHERE id = ?').run(id).changes;
}

function getPlaylistVideos(playlistId) {
  if (!open()) return [];
  return db.prepare(`
    SELECT v.*, pv.position, pv.addedAt
    FROM playlist_videos pv
    JOIN videos v ON v.id = pv.videoId
    WHERE pv.playlistId = ?
    ORDER BY pv.position ASC
  `).all(playlistId);
}

function addToPlaylist(playlistId, videoId) {
  if (!open()) return null;
  const max = db.prepare('SELECT MAX(position) AS m FROM playlist_videos WHERE playlistId = ?').get(playlistId);
  const pos = (max?.m ?? -1) + 1;
  db.prepare('INSERT OR IGNORE INTO playlist_videos (playlistId, videoId, position, addedAt) VALUES (?, ?, ?, ?)')
    .run(playlistId, videoId, pos, Date.now());
  db.prepare('UPDATE playlists SET updatedAt = ? WHERE id = ?').run(Date.now(), playlistId);
  return pos;
}

function removeFromPlaylist(playlistId, videoId) {
  if (!open()) return 0;
  const r = db.prepare('DELETE FROM playlist_videos WHERE playlistId = ? AND videoId = ?').run(playlistId, videoId);
  db.prepare('UPDATE playlists SET updatedAt = ? WHERE id = ?').run(Date.now(), playlistId);
  return r.changes;
}

// ─── Thumbnails ─────────────────────────────────────────────────────
function setThumbnail(videoId, thumbPath, w, h) {
  if (!open()) return null;
  return db.prepare(`
    INSERT INTO thumbnails (videoId, thumbPath, generatedAt, width, height)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(videoId) DO UPDATE SET
      thumbPath=excluded.thumbPath,
      generatedAt=excluded.generatedAt,
      width=excluded.width,
      height=excluded.height
  `).run(videoId, thumbPath, Date.now(), w || 0, h || 0);
}

function getThumbnail(videoId) {
  if (!open()) return null;
  return db.prepare('SELECT * FROM thumbnails WHERE videoId = ?').get(videoId);
}

module.exports = {
  open,
  close,
  allVideos,
  getVideo,
  getVideoByPath,
  upsertVideo,
  removeVideo,
  recordWatch,
  getWatchHistory,
  clearWatchHistory,
  allPlaylists,
  createPlaylist,
  deletePlaylist,
  getPlaylistVideos,
  addToPlaylist,
  removeFromPlaylist,
  setThumbnail,
  getThumbnailRow: getThumbnail
};
