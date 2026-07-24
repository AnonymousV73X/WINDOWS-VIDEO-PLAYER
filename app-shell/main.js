/**
 * NovaPlay — Main Process Entry
 *
 * Bootstraps the Electron application, manages the main window, and
 * orchestrates all main-process modules. Mirrors NovaTune's main.js
 * patterns (multi-signal show, force-quit safety net, crash logger)
 * and adds the video-engine wiring.
 *
 * Key responsibilities:
 *  - Create a frameless, dark BrowserWindow with native titlebar overlay
 *  - Register the nova-video:// protocol for serving local video files
 *  - Hand off the main HWND to the VideoEngine for libVLC embedding
 *  - Forward file:// command-line args to the renderer (file association)
 */

const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  shell,
  dialog,
  protocol,
  net
} = require('electron');

// ─── File Logger ───────────────────────────────────────────────────
// First thing initialised — captures every log line of the app lifecycle.
const { initFileLogger, closeFileLogger } = require('./fileLogger');
initFileLogger();

// ─── Crash Safety Net ───────────────────────────────────────────────
const os = require('os');
const fsSafety = require('fs');
const pathSafety = require('path');
const _crashLogPath = pathSafety.join(os.tmpdir(), 'novaplay-crash.log');
let _inFatal = false;
function _logFatal(label, err) {
  // Guard against EPIPE re-entrancy (e.g. dying single-instance writing to broken stdout)
  if (_inFatal) return;
  if (err && (err.code === 'EPIPE' || err.errno === -4047)) return;
  _inFatal = true;
  try {
    fsSafety.appendFileSync(
      _crashLogPath,
      `[${new Date().toISOString()}] ${label}: ${err && err.stack ? err.stack : err}\n`
    );
  } catch (_) {}
  try { console.error(label, err); } catch (_) {}
  _inFatal = false;
}
process.on('uncaughtException', (err) => _logFatal('uncaughtException', err));
process.on('unhandledRejection', (err) => _logFatal('unhandledRejection', err));
// Suppress EPIPE on stdout/stderr so a broken pipe on the single-instance loser
// doesn't generate an endless flood of exceptions
try { process.stdout.on('error', (e) => { if (e.code !== 'EPIPE') _logFatal('stdout error', e); }); } catch (_) {}
try { process.stderr.on('error', (e) => { if (e.code !== 'EPIPE') _logFatal('stderr error', e); }); } catch (_) {}

const path = require('path');
const fs = require('fs');
const WindowStateManager = require('./windowManager');
const registerIPCHandlers = require('./ipc');
const VideoEngine = require('../video-engine/VideoEngine');

// ─── Chromium Flags ─────────────────────────────────────────────────
// Hardware-accelerated video decoding + smooth scrolling.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'BackgroundTracing,PaintHolding');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCEncoderSupport,HardwareMediaKeyHandling');
app.commandLine.appendSwitch('disk-cache-size', '268435456');

// ─── MIME map for local video files ─────────────────────────────────
const VIDEO_MIME = {
  '.mp4':  'video/mp4',
  '.mkv':  'video/x-matroska',
  '.avi':  'video/x-msvideo',
  '.mov':  'video/quicktime',
  '.webm': 'video/webm',
  '.flv':  'video/x-flv',
  '.wmv':  'video/x-ms-wmv',
  '.m4v':  'video/x-m4v',
  '.mpg':  'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.ts':   'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.vob':  'video/dvd',
  '.ogv':  'video/ogg',
  '.3gp':  'video/3gpp'
};

// ─── Register nova-video:// protocol ────────────────────────────────
// MUST be called before app.whenReady(). Used for serving local video
// streams to the HTML5 <video> fallback engine — libVLC reads files
// directly via fs, so it doesn't use this protocol.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'nova-video',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true
    }
  }
]);

// ─── Prevent multiple instances ─────────────────────────────────────
function parseFileFromArgv(argv) {
  if (!argv || !Array.isArray(argv)) return null;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('-')) continue;
    const ext = path.extname(arg).toLowerCase();
    const videoExtensions = Object.keys(VIDEO_MIME).map(e => e.toLowerCase());
    if (videoExtensions.includes(ext)) {
      const fullPath = path.resolve(arg);
      if (fs.existsSync(fullPath)) return fullPath;
    }
  }
  return null;
}

global.fileToPlayOnStartup = parseFileFromArgv(process.argv);

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[single-instance] Another instance has the lock — quitting.');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    console.log('[single-instance] Second instance launched — focusing existing window.');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      const filePath = parseFileFromArgv(commandLine);
      if (filePath) {
        mainWindow.webContents.send('player:play-file', filePath);
      }
    } else {
      // Zombie process — force-exit so the new instance can acquire the lock.
      app.exit(0);
    }
  });
}

// ─── Force-quit safety net ──────────────────────────────────────────
let _forceQuitTimer = null;
app.on('before-quit', (event) => {
  console.log('[quit] before-quit received — starting 3s force-exit timer.');
  if (_forceQuitTimer) return;
  _forceQuitTimer = setTimeout(() => {
    console.warn('[quit] Force-exit timer fired — process.exit(0).');
    try { closeFileLogger(); } catch (_) {}
    process.exit(0);
  }, 3000);
});

app.on('will-quit', () => {
  console.log('[quit] will-quit — flushing logger.');
  try { closeFileLogger(); } catch (_) {}
});

// ─── Globals ────────────────────────────────────────────────────────
let mainWindow = null;
let videoEngine = null;

// ─── Window Manager ─────────────────────────────────────────────────
const windowState = new WindowStateManager('main', {
  defaultWidth: 1440,
  defaultHeight: 810,
  minWidth: 720,
  minHeight: 480
});

// ─── Create Main Window ─────────────────────────────────────────────
function createMainWindow() {
  const { x, y, width, height, isMaximized } = windowState.getState();

  let initAccentColor = '#1ed760';
  try {
    const dataDir = process.env.NODE_ENV === 'development'
      ? path.join(__dirname, '..', 'data')
      : (WindowStateManager.DATA_DIR || app.getPath('userData'));
    const settingsPath = path.join(dataDir, 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (settings.accentColor) initAccentColor = settings.accentColor;
    }
  } catch (_) {}

  mainWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#000000',
    title: 'NovaPlay',
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'win32'
      ? { color: 'rgba(0, 0, 0, 0)', symbolColor: '#b3b3b3', height: 32 }
      : undefined,
    frame: process.platform === 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      additionalArguments: [`--accent-color=${initAccentColor}`]
    }
  });

  // Register IPC handlers — they need mainWindow for send-backs.
  registerIPCHandlers(mainWindow);

  // Load renderer.
  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));

  // Mirror renderer console into our log file (useful when packaged).
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] ${message} (at ${path.basename(sourceId)}:${line})`);
  });

  // ─── Multi-signal show() ──────────────────────────────────────────
  // Different GPU drivers take different paths to composite the first
  // frame; we wait for any of several signals so the window is guaranteed
  // to appear rather than ghost-process.
  let _windowShown = false;
  function _showWindow(reason) {
    if (_windowShown || !mainWindow || mainWindow.isDestroyed()) return;
    _windowShown = true;
    console.log(`[window] show() — triggered by ${reason}`);
    if (isMaximized !== false) {
      try { mainWindow.maximize(); } catch (_) {}
    }
    mainWindow.show();
  }

  mainWindow.once('ready-to-show', () => _showWindow('ready-to-show'));

  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => _showWindow('did-finish-load+500ms'), 500);
    // Initialise the video engine after the renderer is alive so we
    // can hand it the native window handle for HWND embedding.
    try {
      videoEngine = new VideoEngine();
      videoEngine.attachToWindow(mainWindow);
      global.videoEngine = videoEngine;
    } catch (err) {
      console.error('[video-engine] Failed to attach — running in fallback mode:', err.message);
      global.videoEngine = null;
    }
  });

  setTimeout(() => _showWindow('5s-hard-fallback'), 5000);

  mainWindow.on('close', () => {
    try { videoEngine?.destroy(); } catch (_) {}
    windowState.saveState(mainWindow);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// ─── Helper: decode nova-video://local/ URL to file path ───────────
function decodeNovaVideoLocalPath(url) {
  const encoded = url.slice('nova-video://local/'.length);
  let filePath = decodeURIComponent(encoded);
  filePath = filePath.replace(/\\/g, '/');
  if (/^\/[A-Za-z]:/.test(filePath)) filePath = filePath.slice(1);
  return filePath;
}

// ─── Helper: serve video file via fs.createReadStream ──────────────
// Streams local video files using Node's libuv thread pool (independent
// of Chromium's network service thread — avoids Windows net.fetch blocking).
async function serveVideoFile(request, filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = VIDEO_MIME[ext] || 'application/octet-stream';
    const stat = await fs.promises.stat(filePath);
    const fileSize = stat.size;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD',
      'Access-Control-Allow-Headers': 'Range'
    };

    const rangeHeader =
      request.headers.get('Range') || request.headers.get('range');

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
        const clampedEnd = Math.min(end, fileSize - 1);

        if (start >= fileSize) {
          return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${fileSize}` }
          });
        }

        const chunkSize = clampedEnd - start + 1;
        const nodeStream = fs.createReadStream(filePath, { start, end: clampedEnd });
        const webStream = new ReadableStream({
          start(controller) {
            nodeStream.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)));
            nodeStream.on('end', () => controller.close());
            nodeStream.on('error', (err) => controller.error(err));
          },
          cancel() { nodeStream.destroy(); }
        });

        return new Response(webStream, {
          status: 206,
          headers: {
            ...corsHeaders,
            'Content-Type': mimeType,
            'Content-Range': `bytes ${start}-${clampedEnd}/${fileSize}`,
            'Content-Length': String(chunkSize),
            'Accept-Ranges': 'bytes'
          }
        });
      }
    }

    // Full file response
    const nodeStream = fs.createReadStream(filePath);
    const webStream = new ReadableStream({
      start(controller) {
        nodeStream.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)));
        nodeStream.on('end', () => controller.close());
        nodeStream.on('error', (err) => controller.error(err));
      },
      cancel() { nodeStream.destroy(); }
    });

    return new Response(webStream, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': mimeType,
        'Content-Length': String(fileSize),
        'Accept-Ranges': 'bytes'
      }
    });
  } catch (err) {
    console.error('[nova-video:local] serveVideoFile error:', err.message);
    return new Response('Internal error', { status: 500 });
  }
}

// ─── App Lifecycle ──────────────────────────────────────────────────
app.whenReady().then(() => {
  try { Menu.setApplicationMenu(null); } catch (err) {
    _logFatal('Menu.setApplicationMenu failed', err);
  }

  try {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.novaplay.player');
    }
  } catch (err) {
    _logFatal('setAppUserModelId failed', err);
  }

  // ── nova-video:// protocol handler ──────────────────────────────
  try {
    protocol.handle('nova-video', async (request) => {
      const url = request.url;
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Range'
      };

      // nova-video://local/<encoded-path>
      if (url.startsWith('nova-video://local/')) {
        const filePath = decodeNovaVideoLocalPath(url);
        if (!fs.existsSync(filePath)) {
          return new Response('Not found', { status: 404, headers: { ...corsHeaders, 'Content-Type': 'text/plain' } });
        }
        return serveVideoFile(request, filePath);
      }

      // nova-video://thumb/<encoded-path>  → generated thumbnail PNG (cache-backed)
      if (url.startsWith('nova-video://thumb/')) {
        const encoded = url.slice('nova-video://thumb/'.length).split('?')[0];
        const filePath = decodeURIComponent(encoded).replace(/\\/g, '/');
        const normalized = /^\/[A-Za-z]:/.test(filePath) ? filePath.slice(1) : filePath;
        try {
          const { getThumbnail } = require('../local-data/cache');
          const thumbPath = await getThumbnail(normalized);
          if (!thumbPath) {
            return new Response('No thumbnail', { status: 404, headers: { ...corsHeaders, 'Content-Type': 'text/plain' } });
          }
          const buf = fs.readFileSync(thumbPath);
          return new Response(buf, {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'image/jpeg',
              'Cache-Control': 'public, max-age=31536000, immutable'
            }
          });
        } catch (err) {
          console.error('[nova-video:thumb] error:', err.message);
          return new Response('Thumbnail error', { status: 500, headers: { ...corsHeaders, 'Content-Type': 'text/plain' } });
        }
      }

      return new Response('Not found', { status: 404 });
    });
  } catch (err) {
    _logFatal('protocol.handle nova-video failed', err);
  }

  createMainWindow();

  // Forward startup file (file association)
  if (global.fileToPlayOnStartup && mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('player:play-file', global.fileToPlayOnStartup);
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
