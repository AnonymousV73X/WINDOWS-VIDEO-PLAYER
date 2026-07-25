/**
 * NovaPlay — Window State Manager
 * Reused from NovaTune (identical API + behaviour).
 * Persists and restores window position, size, and maximized state
 * across application sessions using a JSON configuration file.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
let screen = null, app = null;
try { ({ screen, app } = require('electron')); } catch (_) { /* not in Electron */ }

function _sleep(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (_) {}
}

// Windows can briefly hold a path locked (Explorer / AV / Search Indexer),
// so a mkdir immediately after can throw EPERM/EBUSY. Retry with backoff.
function ensureDirSync(dir, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch (err) {
      if (i === attempts - 1) throw err;
      _sleep(100 * (i + 1));
    }
  }
  return dir;
}

function resolveDataDir() {
  const preferred =
    process.defaultApp ||
    process.env.NODE_ENV === 'development' ||
    process.argv.includes('--dev')
      ? path.join(__dirname, '..', '..', 'data')
      : (app?.getPath?.('userData') || path.join(os.tmpdir(), 'NovaPlay'));
  try {
    return ensureDirSync(preferred);
  } catch (err) {
    console.warn('Primary data directory unavailable, falling back to temp dir:', err.message);
    const fallback = path.join(os.tmpdir(), 'NovaPlay');
    try { return ensureDirSync(fallback); }
    catch (err2) {
      console.warn('Fallback data directory also failed:', err2.message);
      return preferred;
    }
  }
}

const DATA_DIR = resolveDataDir();
const STATE_FILE = path.join(DATA_DIR, 'window-state.json');

class WindowStateManager {
  constructor(windowName, defaults = {}) {
    this.windowName = windowName;
    this.defaults = {
      defaultWidth: defaults.defaultWidth || 1280,
      defaultHeight: defaults.defaultHeight || 720,
      minWidth: defaults.minWidth || 360,
      minHeight: defaults.minHeight || 420
    };
    this.state = this._loadState();
  }

  _loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        const saved = raw[this.windowName];
        if (saved) {
          return {
            x: typeof saved.x === 'number' ? saved.x : undefined,
            y: typeof saved.y === 'number' ? saved.y : undefined,
            width: saved.width || this.defaults.defaultWidth,
            height: saved.height || this.defaults.defaultHeight,
            isMaximized: !!saved.isMaximized
          };
        }
      }
    } catch (err) {
      console.warn('Failed to load window state:', err.message);
    }
    return {
      x: undefined,
      y: undefined,
      width: this.defaults.defaultWidth,
      height: this.defaults.defaultHeight,
      isMaximized: false
    };
  }

  getState() {
    let state = { ...this.state };
    if (state.x !== undefined && state.y !== undefined && screen) {
      const displays = screen.getAllDisplays();
      const bounds = {
        x: Math.min(...displays.map(d => d.bounds.x)),
        y: Math.min(...displays.map(d => d.bounds.y)),
        width: Math.max(...displays.map(d => d.bounds.x + d.bounds.width)),
        height: Math.max(...displays.map(d => d.bounds.y + d.bounds.height))
      };
      if (
        state.x < bounds.x ||
        state.y < bounds.y ||
        state.x > bounds.x + bounds.width - 100 ||
        state.y > bounds.y + bounds.height - 100
      ) {
        state.x = undefined;
        state.y = undefined;
      }
    }
    return state;
  }

  saveState(browserWindow) {
    if (!browserWindow || browserWindow.isDestroyed()) return;
    try {
      let allStates = {};
      try {
        if (fs.existsSync(STATE_FILE)) {
          allStates = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        }
      } catch (readErr) {
        allStates = {};
      }
      const isMaximized = browserWindow.isMaximized();
      const bounds = isMaximized ? this.state : browserWindow.getBounds();
      allStates[this.windowName] = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized
      };
      fs.writeFileSync(STATE_FILE, JSON.stringify(allStates, null, 2), 'utf-8');
      this.state = { ...allStates[this.windowName] };
    } catch (err) {
      console.warn('Failed to save window state:', err.message);
    }
  }
}

module.exports = WindowStateManager;
module.exports.DATA_DIR = DATA_DIR;
module.exports.ensureDirSync = ensureDirSync;
