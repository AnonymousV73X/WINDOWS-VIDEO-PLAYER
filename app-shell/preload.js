/**
 * NovaPlay — Preload Script
 *
 * Mirrors NovaTune's preload pattern but uses contextBridge for safety
 * (contextIsolation: true). Exposes a minimal, typed surface to the
 * renderer via window.novaAPI.
 *
 * All IPC channels are namespaced under "nova:" to make auditing easy.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('novaAPI', {
  // ── Generic IPC primitives ───────────────────────────────────────
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send:   (channel, ...args) => ipcRenderer.send(channel, ...args),
  on:     (channel, callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  // ── File system dialogues (proxied through main) ─────────────────
  pickFolder: () => ipcRenderer.invoke('nova:pick-folder'),
  pickVideoFile: () => ipcRenderer.invoke('nova:pick-video-file'),

  // ── Library ──────────────────────────────────────────────────────
  scanFolder:    (folderPath) => ipcRenderer.invoke('nova:scan-folder', folderPath),
  getLibrary:    () => ipcRenderer.invoke('nova:library-get-all'),
  removeVideo:   (videoId)   => ipcRenderer.invoke('nova:library-remove', videoId),
  getWatchHistory: ()         => ipcRenderer.invoke('nova:watch-history-get'),
  clearWatchHistory: ()      => ipcRenderer.invoke('nova:watch-history-clear'),
  recordWatch:   (payload)   => ipcRenderer.invoke('nova:watch-record', payload),

  // ── Playlists ─────────────────────────────────────────────────────
  getPlaylists:        () => ipcRenderer.invoke('nova:playlists-get'),
  createPlaylist:      (name) => ipcRenderer.invoke('nova:playlist-create', name),
  deletePlaylist:      (id)   => ipcRenderer.invoke('nova:playlist-delete', id),
  getPlaylistVideos:   (id)   => ipcRenderer.invoke('nova:playlist-videos', id),
  addToPlaylist:       (playlistId, videoId) => ipcRenderer.invoke('nova:playlist-add', { playlistId, videoId }),
  removeFromPlaylist:  (playlistId, videoId) => ipcRenderer.invoke('nova:playlist-remove', { playlistId, videoId }),

  // ── Settings ──────────────────────────────────────────────────────
  getSettings:    () => ipcRenderer.invoke('nova:settings-get'),
  setSetting:     (key, value) => ipcRenderer.invoke('nova:settings-set', { key, value }),
  resetSettings:  () => ipcRenderer.invoke('nova:settings-reset'),

  // ── Video Engine (libVLC) ────────────────────────────────────────
  engineLoad:        (filePath)     => ipcRenderer.invoke('nova:engine-load', filePath),
  enginePlay:        ()              => ipcRenderer.invoke('nova:engine-play'),
  enginePause:       ()              => ipcRenderer.invoke('nova:engine-pause'),
  engineToggle:      ()              => ipcRenderer.invoke('nova:engine-toggle'),
  engineStop:        ()              => ipcRenderer.invoke('nova:engine-stop'),
  engineSeek:        (timeSec)       => ipcRenderer.invoke('nova:engine-seek', timeSec),
  engineSetVolume:   (vol)           => ipcRenderer.invoke('nova:engine-volume', vol),
  engineSetRate:     (rate)          => ipcRenderer.invoke('nova:engine-rate', rate),
  engineSetAudioTrack:  (id)         => ipcRenderer.invoke('nova:engine-audio-track', id),
  engineSetSubtitleTrack:(id)         => ipcRenderer.invoke('nova:engine-subtitle-track', id),
  engineSetChapter:  (chapter)       => ipcRenderer.invoke('nova:engine-chapter', chapter),
  engineGetState:    ()              => ipcRenderer.invoke('nova:engine-state'),
  engineGetTracks:   ()              => ipcRenderer.invoke('nova:engine-tracks'),
  engineIsAvailable: ()              => ipcRenderer.invoke('nova:engine-available'),

  // ── Video hole geometry (for HWND embedding) ────────────────────
  // Renderer reports the screen-space rect of the "video-area" element
  // so the main process can position the native child window under it.
  reportVideoRect:   (rect)          => ipcRenderer.send('nova:video-rect', rect),

  // ── Window controls (titleBarOverlay) ────────────────────────────
  windowMinimize: () => ipcRenderer.send('nova:window-minimize'),
  windowMaximize: () => ipcRenderer.send('nova:window-maximize'),
  windowClose:    () => ipcRenderer.send('nova:window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('nova:window-is-maximized'),

  // ── Event streams (one-way main → renderer) ─────────────────────
  onEngineEvent: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('nova:engine-event', handler);
    return () => ipcRenderer.removeListener('nova:engine-event', handler);
  },
  onPlayFile: (cb) => {
    const handler = (_event, filePath) => cb(filePath);
    ipcRenderer.on('player:play-file', handler);
    return () => ipcRenderer.removeListener('player:play-file', handler);
  },
  onScanProgress: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('nova:scan-progress', handler);
    return () => ipcRenderer.removeListener('nova:scan-progress', handler);
  }
});
