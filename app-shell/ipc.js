/**
 * NovaPlay — IPC Handler Registry
 *
 * Mirrors NovaTune's ipc.js architecture: a single registerIPCHandlers()
 * function wires up every nova:* channel. Pure data flow — UI logic
 * lives in the renderer.
 *
 * All handlers are async and return JSON-serialisable values. Errors
 * are caught and returned as { ok: false, error: string }.
 */

const { ipcMain, dialog, BrowserWindow, app } = require('electron');
const fs = require('fs');
const path = require('path');
const db = require('../local-data/database');
const settings = require('../local-data/settingsStore');
const { scanFolder, quickMetadata } = require('../local-data/fileScanner');
const { probeMetadata, getThumbnail } = require('../local-data/cache');

let _mainWindow = null;

function registerIPCHandlers(mainWindow) {
  _mainWindow = mainWindow;

  // ─── Window controls (titleBarOverlay) ─────────────────────────
  ipcMain.on('nova:window-minimize', () => _mainWindow?.minimize());
  ipcMain.on('nova:window-maximize', () => {
    if (!_mainWindow) return;
    if (_mainWindow.isMaximized()) _mainWindow.unmaximize();
    else _mainWindow.maximize();
  });
  ipcMain.on('nova:window-close', () => _mainWindow?.close());
  ipcMain.handle('nova:window-is-maximized', () => !!_mainWindow?.isMaximized());

  // ─── File / folder pickers ──────────────────────────────────────
  ipcMain.handle('nova:pick-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('nova:pick-video-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: [
        'mp4','mkv','avi','mov','webm','flv','wmv','m4v','mpg','mpeg','ts','m2ts','vob','ogv','3gp'
      ]}]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // ─── Library scanning ──────────────────────────────────────────
  ipcMain.handle('nova:scan-folder', async (event, folderPath) => {
    if (!folderPath || !fs.existsSync(folderPath)) {
      return { ok: false, error: 'Folder not found' };
    }

    // Guard: only send if the renderer webContents is still alive
    const safeSend = (channel, payload) => {
      try {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send(channel, payload);
        }
      } catch (_) {}
    };

    // Add to scanFolders setting
    const all = settings.readAll();
    if (!all.scanFolders.includes(folderPath)) {
      all.scanFolders.push(folderPath);
      await settings.set('scanFolders', all.scanFolders);
    }

    let cancelled = false;
    const cancelHandler = () => { cancelled = true; };
    ipcMain.on('nova:scan-cancel', cancelHandler);

    try {
      let lastProgressTime = 0;
      const filePaths = await scanFolder(folderPath, {
        onProgress: (count, current) => {
          if (cancelled) return;
          // Throttle to at most 4 updates/sec to avoid flooding IPC
          const now = Date.now();
          if (now - lastProgressTime < 250) return;
          lastProgressTime = now;
          safeSend('nova:scan-progress', { stage: 'scanning', current, count });
        },
        signal: { get cancelled() { return cancelled; } }
      });

      safeSend('nova:scan-progress', {
        stage: 'reading',
        current: 0,
        total: filePaths.length
      });

      let added = 0;
      const existing = new Map(db.allVideos().map(v => [v.filePath, v]));

      for (let i = 0; i < filePaths.length; i++) {
        if (cancelled) break;
        const filePath = filePaths[i];
        const meta = quickMetadata(filePath);
        if (!meta) continue;

        // If file already in library and duration is set and size unchanged, skip
        const old = existing.get(filePath);
        if (old && old.size === meta.size && old.duration > 0) {
          continue;
        }

        // Probe rich metadata (duration, width, height, etc.) before adding to DB
        let richMeta = null;
        try {
          richMeta = await probeMetadata(filePath);
        } catch (_) {}

        const video = {
          ...meta,
          duration: richMeta?.duration || old?.duration || 0,
          width: richMeta?.width || old?.width || 0,
          height: richMeta?.height || old?.height || 0,
          codec: richMeta?.codec || old?.codec || '',
          fps: richMeta?.fps || old?.fps || 0,
          bitrate: richMeta?.bitrate || old?.bitrate || 0,
          dateAdded: old?.dateAdded || Date.now(),
          lastPlayed: old?.lastPlayed || 0,
          playCount: old?.playCount || 0,
          data: {
            audioCodec: richMeta?.audioCodec || old?.data?.audioCodec || '',
            audioChannels: richMeta?.audioChannels || old?.data?.audioChannels || 0
          }
        };

        db.upsertVideo(video);
        added++;

        safeSend('nova:scan-progress', {
          stage: 'reading',
          current: i + 1,
          total: filePaths.length,
          percent: Math.round(((i + 1) / filePaths.length) * 100)
        });
      }

      safeSend('nova:scan-progress', {
        stage: 'complete',
        added,
        total: filePaths.length
      });

      return { ok: true, added, total: filePaths.length };
    } catch (err) {
      safeSend('nova:scan-progress', {
        stage: 'error',
        message: err.message
      });
      return { ok: false, error: err.message };
    } finally {
      ipcMain.off('nova:scan-cancel', cancelHandler);
    }
  });

  // ─── Library CRUD ──────────────────────────────────────────────
  ipcMain.handle('nova:library-get-all', () => {
    return db.allVideos();
  });

  ipcMain.handle('nova:library-remove', (event, videoId) => {
    return db.removeVideo(videoId);
  });

  ipcMain.handle('nova:watch-history-get', () => {
    return db.getWatchHistory();
  });

  ipcMain.handle('nova:watch-history-clear', () => {
    return db.clearWatchHistory();
  });

  ipcMain.handle('nova:watch-record', (event, { videoId, position, duration, completed }) => {
    return db.recordWatch(videoId, position, duration, completed);
  });

  // ─── Playlists ──────────────────────────────────────────────────
  ipcMain.handle('nova:playlists-get', () => db.allPlaylists());
  ipcMain.handle('nova:playlist-create', (event, name) => db.createPlaylist(name));
  ipcMain.handle('nova:playlist-delete', (event, id) => db.deletePlaylist(id));
  ipcMain.handle('nova:playlist-videos', (event, id) => db.getPlaylistVideos(id));
  ipcMain.handle('nova:playlist-add', (event, { playlistId, videoId }) => db.addToPlaylist(playlistId, videoId));
  ipcMain.handle('nova:playlist-remove', (event, { playlistId, videoId }) => db.removeFromPlaylist(playlistId, videoId));

  // ─── Settings ──────────────────────────────────────────────────
  ipcMain.handle('nova:settings-get', () => settings.readAll());
  ipcMain.handle('nova:settings-set', (event, { key, value }) => settings.set(key, value));
  ipcMain.handle('nova:settings-reset', () => settings.reset());

  // ─── Video Engine ───────────────────────────────────────────────
  ipcMain.handle('nova:engine-available', () => {
    const eng = global.videoEngine;
    return eng ? eng.isAvailable() : false;
  });

  ipcMain.handle('nova:engine-load', async (event, filePath) => {
    const eng = global.videoEngine;
    if (!eng) return { ok: false, error: 'Engine not initialised' };
    const r = eng.load(filePath);
    return r;
  });
  ipcMain.handle('nova:engine-play', () => {
    const eng = global.videoEngine;
    if (!eng) return { ok: false };
    return eng.play();
  });
  ipcMain.handle('nova:engine-pause', () => {
    const eng = global.videoEngine;
    if (!eng) return { ok: false };
    return eng.pause();
  });
  ipcMain.handle('nova:engine-toggle', () => {
    const eng = global.videoEngine;
    if (!eng) return { ok: false };
    return eng.toggle();
  });
  ipcMain.handle('nova:engine-stop', () => {
    const eng = global.videoEngine;
    if (!eng) return { ok: false };
    return eng.stop();
  });
  ipcMain.handle('nova:engine-seek', (event, timeSec) => {
    const eng = global.videoEngine;
    if (!eng) return { ok: false };
    return eng.seek(timeSec);
  });
  ipcMain.handle('nova:engine-volume', (event, vol) => {
    const eng = global.videoEngine;
    if (!eng) return { ok: false };
    return eng.setVolume(vol);
  });
  ipcMain.handle('nova:engine-rate', (event, rate) => {
    const eng = global.videoEngine;
    if (!eng) return { ok: false };
    return eng.setRate(rate);
  });
  ipcMain.handle('nova:engine-audio-track', (event, id) => {
    const eng = global.videoEngine;
    if (!eng) return { ok: false };
    return eng.setAudioTrack(id);
  });
  ipcMain.handle('nova:engine-subtitle-track', (event, id) => {
    const eng = global.videoEngine;
    if (!eng) return { ok: false };
    return eng.setSubtitleTrack(id);
  });
  ipcMain.handle('nova:engine-chapter', (event, chapter) => {
    const eng = global.videoEngine;
    if (!eng) return { ok: false };
    return eng.setChapter(chapter);
  });
  ipcMain.handle('nova:engine-state', () => {
    const eng = global.videoEngine;
    if (!eng) return { available: false };
    return eng.getFullState();
  });
  ipcMain.handle('nova:engine-tracks', () => {
    const eng = global.videoEngine;
    if (!eng) return { audio: [], subtitles: [], chapters: 0, currentChapter: 0 };
    return eng.getTracks();
  });

  // ─── Generate thumbnail on-demand (called by the renderer when a
  // video card scrolls into view and has no cached thumbnail) ───────
  ipcMain.handle('nova:thumbnail-gen', async (event, { filePath, videoId }) => {
    const thumbPath = await getThumbnail(filePath);
    if (thumbPath) {
      // DB row will already be set by cache.js — return the URL the
      // renderer can use directly
      return { ok: true, url: 'nova-video://thumb/' + encodeURIComponent(filePath) };
    }
    return { ok: false };
  });

  console.log('[ipc] all handlers registered');
}

module.exports = registerIPCHandlers;
module.exports.getMainWindow = () => _mainWindow;
