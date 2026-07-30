/**
 * NovaPlay — Settings Store
 *
 * Reuses NovaTune's serialized read-modify-write queue so multiple
 * concurrent mutations never lose updates. Pure JSON file on disk.
 */

const fs = require('fs');
const path = require('path');
let app = null;
try { app = require('electron').app; } catch (_) { /* not in Electron */ }
const { ensureDirSync } = require('../app-shell/windowManager');

const DEFAULT_SETTINGS = {
  // Theme
  theme: 'dark',
  accentColor: '#1ed760',           // matches NovaTune's signature green
  backgroundMode: 'amoled',         // 'amoled' (pure black) | 'dim' (#121212)

  // Playback
  volume: 0.8,
  muted: false,
  playbackRate: 1.0,
  resumeOnOpen: true,                // resume from last position when reopening a video
  hwAccel: true,
  defaultSubtitleTrack: -1,         // -1 = off, 0 = first
  defaultAudioTrack: -1,

  // Library
  scanFolders: [],
  autoRescan: true,
  thumbnailSeekPct: 25,              // seek to 25% of duration when generating thumbnail
  sortOrder: 'dateAdded',
  sortDirection: 'desc',

  // UI
  miniPlayer: false,
  alwaysOnTop: false,
  controlsAutoHideMs: 2500,
  showTitlebarLogo: true,
  reducedMotion: false,

  // Cache
  cacheDir: '',                       // empty = default (userData/cache)
  cacheMaxMB: 500,

  // Fonts
  activeFont: 'Outfit'                // 'Outfit' | 'Figtree'
};

let SETTINGS_FILE = null;
let _queue = Promise.resolve();
let _cached = null;

function getSettingsPath() {
  const dataDir = process.env.NODE_ENV === 'development'
    ? path.join(__dirname, '..', 'data')
    : (app?.getPath?.('userData') || path.join(require('os').tmpdir(), 'NovaPlay'));
  ensureDirSync(dataDir);
  return path.join(dataDir, 'settings.json');
}

function readAll() {
  if (_cached) return _cached;
  const p = getSettingsPath();
  try {
    if (fs.existsSync(p)) {
      _cached = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(p, 'utf-8')) };
    } else {
      _cached = { ...DEFAULT_SETTINGS };
    }
  } catch (err) {
    console.warn('[settings] read failed, using defaults:', err.message);
    _cached = { ...DEFAULT_SETTINGS };
  }
  return _cached;
}

function readSync() {
  return readAll();
}

function set(key, value) {
  const run = _queue.then(() => {
    const settings = readAll();
    settings[key] = value;
    const p = getSettingsPath();
    try {
      fs.writeFileSync(p, JSON.stringify(settings, null, 2), 'utf-8');
      _cached = settings;
    } catch (err) {
      console.error('[settings] write failed:', err.message);
    }
    return settings[key];
  });
  _queue = run.catch(() => {});
  return run;
}

function setMany(updates) {
  const run = _queue.then(() => {
    const settings = readAll();
    for (const [k, v] of Object.entries(updates)) settings[k] = v;
    const p = getSettingsPath();
    try {
      fs.writeFileSync(p, JSON.stringify(settings, null, 2), 'utf-8');
      _cached = settings;
    } catch (err) {
      console.error('[settings] writeMany failed:', err.message);
    }
    return settings;
  });
  _queue = run.catch(() => {});
  return run;
}

function reset() {
  const run = _queue.then(() => {
    const p = getSettingsPath();
    try { fs.writeFileSync(p, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf-8'); } catch (_) {}
    _cached = { ...DEFAULT_SETTINGS };
    return _cached;
  });
  _queue = run.catch(() => {});
  return run;
}

module.exports = {
  DEFAULT_SETTINGS,
  readAll,
  readSync,
  set,
  setMany,
  reset
};
