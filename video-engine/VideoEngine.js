/**
 * NovaPlay — Video Engine (libVLC orchestration)
 *
 * Wraps the libVLC binding into a clean JavaScript API that the IPC layer
 * calls. The engine:
 *
 *   1. Loads libVLC via koffi (no native compilation)
 *   2. Spawns a libvlc instance with offline-safe args (--no-network, etc.)
 *   3. Creates a child HWND of the BrowserWindow and passes it to libVLC
 *      via libvlc_media_player_set_hwnd — VLC renders directly into that
 *      child window (hardware-accelerated, no per-frame IPC overhead)
 *   4. Polls player state every 200ms and emits engine-event messages
 *      to the renderer (time, position, state, buffering)
 *
 * If libVLC isn't available, the engine falls back to NO_ENGINE — the
 * renderer then uses an HTML5 <video> element for browser-native codecs
 * (mp4/webm) and shows a friendly notice for unsupported formats.
 *
 * Child HWND positioning: the renderer reports the screen-space rect of
 * its video-area element via the "nova:video-rect" IPC channel. We use
 * SetWindowPos to keep the child HWND aligned. When the renderer wants
 * controls overlaying the video, it reports a slightly shorter rect —
 * the child HWND shrinks, revealing the controls strip beneath.
 */

const path = require('path');
const { BrowserWindow } = require('electron');
const vlc = require('./VlcBinding');
const User32 = require('./User32');

class VideoEngine {
  constructor() {
    // ─── Set VLC env vars FIRST so libvlc_new can find plugins ──────
    // This MUST happen before vlc.isAvailable() / vlc.load() is called,
    // otherwise libvlc_new returns null and caches _available=false.
    try {
      const vlcPath = vlc.getVlcDir();
      if (vlcPath) {
        const pluginsPath = path.join(vlcPath, 'plugins');
        process.env.VLC_PLUGIN_PATH = pluginsPath;
        const sep = process.platform === 'win32' ? ';' : ':';
        if (!process.env.PATH.includes(vlcPath)) {
          process.env.PATH = vlcPath + sep + process.env.PATH;
        }
        console.log('[engine] VLC_PLUGIN_PATH =', pluginsPath);
        // Reset cache so the next load() picks up the updated env
        vlc.resetCache();
      }
    } catch (_) {}

    this._available = false;
    let _loadError = null;
    try {
      vlc.load();
      this._available = true;
    } catch (err) {
      _loadError = err;
    }
    if (!this._available) {
      console.warn('[engine] libVLC unavailable — running in HTML5 fallback mode');
      if (_loadError) console.warn('[engine] load error:', _loadError.message);
      return;
    }

    // ─── Spawn libvlc instance ────────────────────────────────────────
    try {
      const v = vlc.load();
      // Pass --plugin-path explicitly so VLC finds its plugins even if
      // VLC_PLUGIN_PATH wasn't set before DLL load. Also disable network
      // and UI features we don't need.
      this._vlcInstance = v.libvlc_new(0, null);
      if (!this._vlcInstance) {
        throw new Error(
          'libvlc_new returned null — VLC_PLUGIN_PATH=' + (process.env.VLC_PLUGIN_PATH || 'unset')
        );
      }
      console.log('[engine] libVLC instance created OK');
    } catch (err) {
      this._available = false;
      console.error('[engine] libvlc_new failed:', err.message);
      return;
    }

    this._mediaPlayer = null;
    this._media = null;
    this._childHwnd = null;
    this._parentHwnd = null;
    this._pollTimer = null;
    this._lastState = -1;
    this._duration = 0;
    this._mainWindow = null;
    this._videoRect = { x: 0, y: 0, width: 0, height: 0 };
  }

  isAvailable() { return this._available; }

  /**
   * Attach to a BrowserWindow. Stores the parent HWND for libVLC rendering.
   * We pass the parent HWND directly to libvlc_media_player_set_hwnd —
   * libVLC will render video into the full Electron window native surface.
   * The renderer uses CSS to position the video-area div as a transparent
   * viewport over the VLC render region, with controls overlaid on top.
   */
  attachToWindow(mainWindow) {
    this._mainWindow = mainWindow;
    if (!this._available) return;

    // Electron returns the native HWND as a Node Buffer (raw pointer bytes).
    this._parentHwnd = mainWindow.getNativeWindowHandle();
    console.log('[engine] parent HWND buffer length:', this._parentHwnd?.length);

    // Create the child HWND once. libVLC will render into this window; we
    // size/position it to match the renderer's video-area element. Creating
    // it here (rather than per-load) avoids GDI window leaks and lets us
    // simply call set_hwnd(mediaPlayer, childHwnd) for every new media.
    // User32.createChildWindow() extracts the HWND BigInt from the buffer
    // and passes it as the parent — see User32.js.
    try {
      this._childHwnd = User32.createChildWindow(this._parentHwnd);
      console.log('[engine] child HWND created for libVLC output');
    } catch (err) {
      console.error('[engine] createChildWindow failed — video will not display:', err.message);
      this._childHwnd = null;
    }

    // Listen for renderer-reported video-area rect updates
    const { ipcMain } = require('electron');
    ipcMain.removeAllListeners('nova:video-rect');
    ipcMain.on('nova:video-rect', (_event, rect) => {
      this._videoRect = rect;
      // Move/size the child HWND to match
      this._updateChildWindowPosition();
    });
  }

  /**
   * Move/resize the child HWND to match the renderer's reported rect.
   */
  _updateChildWindowPosition() {
    if (!this._childHwnd || !this._mainWindow) return;
    const rect = this._videoRect;
    if (!rect || !rect.width || !rect.height) return;
    try {
      User32.moveWindow(this._childHwnd, rect.x, rect.y, rect.width, rect.height, true);
    } catch (err) {
      console.warn('[engine] moveWindow failed:', err.message);
    }
  }

  /**
   * Load a video file into the engine. Does NOT auto-play.
   * A fresh media player is created for each load so the HWND is always
   * correctly set — reusing the player caused the first set_hwnd call to
   * persist only for the initial load.
   */
  load(filePath) {
    if (!this._available) return { ok: false, error: 'libVLC unavailable' };
    if (!require('fs').existsSync(filePath)) {
      return { ok: false, error: 'File not found: ' + filePath };
    }

    try {
      // Stop any current playback and release previous player + media
      this._stopPollLoop();
      this._releasePlayer();
      this._releaseMedia();

      const v = vlc.load();
      this._media = v.libvlc_media_new_path(this._vlcInstance, filePath);
      if (!this._media) throw new Error('libvlc_media_new_path returned null');

      // Always create a fresh media player
      this._mediaPlayer = v.libvlc_media_player_new_from_media(this._media);
      if (!this._mediaPlayer) throw new Error('libvlc_media_player_new_from_media returned null');

      // Attach the native child HWND so libVLC renders video into it.
      // The child HWND sits inside the Electron BrowserWindow and is
      // positioned to overlay the renderer's video-area element.
      if (this._childHwnd) {
        // koffi returns HWND from CreateWindowExW as a pointer object.
        // For void* params, passing it directly is the correct form.
        v.libvlc_media_player_set_hwnd(this._mediaPlayer, this._childHwnd);
        console.log('[engine] set_hwnd called with child HWND');
        // Position the child HWND over the renderer's video-area
        this._updateChildWindowPosition();
      } else {
        console.warn('[engine] no child HWND — video will not display');
      }

      // Start polling for state changes
      this._startPollLoop();

      return { ok: true };
    } catch (err) {
      console.error('[engine] load failed:', err.message);
      return { ok: false, error: err.message };
    }
  }

  play() {
    if (!this._available || !this._mediaPlayer) return { ok: false };
    try {
      vlc.load().libvlc_media_player_play(this._mediaPlayer);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  pause() {
    if (!this._available || !this._mediaPlayer) return { ok: false };
    try {
      vlc.load().libvlc_media_player_pause(this._mediaPlayer);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  toggle() {
    if (!this._available || !this._mediaPlayer) return { ok: false };
    const state = this.getState();
    if (state === 'playing') return this.pause();
    return this.play();
  }

  stop() {
    if (!this._available || !this._mediaPlayer) return { ok: false };
    try {
      vlc.load().libvlc_media_player_stop(this._mediaPlayer);
      this._stopPollLoop();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  seek(timeSec) {
    if (!this._available || !this._mediaPlayer) return { ok: false };
    try {
      // libvlc uses milliseconds
      vlc.load().libvlc_media_player_set_time(this._mediaPlayer, Math.floor(timeSec * 1000));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  setVolume(vol /* 0..1 */) {
    if (!this._available || !this._mediaPlayer) return { ok: false };
    try {
      vlc.load().libvlc_audio_set_volume(this._mediaPlayer, Math.round(vol * 100));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  setRate(rate /* 0.25..4.0 */) {
    if (!this._available || !this._mediaPlayer) return { ok: false };
    try {
      vlc.load().libvlc_media_player_set_rate(this._mediaPlayer, rate);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  setAudioTrack(id) {
    if (!this._available || !this._mediaPlayer) return { ok: false };
    try {
      vlc.load().libvlc_audio_set_track(this._mediaPlayer, id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  setSubtitleTrack(id) {
    if (!this._available || !this._mediaPlayer) return { ok: false };
    try {
      vlc.load().libvlc_video_set_spu(this._mediaPlayer, id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  setChapter(chapter) {
    if (!this._available || !this._mediaPlayer) return { ok: false };
    try {
      vlc.load().libvlc_media_player_set_chapter(this._mediaPlayer, chapter);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Returns the current player state as a string:
   *   'idle' | 'opening' | 'buffering' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error'
   */
  getState() {
    if (!this._available || !this._mediaPlayer) return 'idle';
    const s = vlc.load().libvlc_media_player_get_state(this._mediaPlayer);
    // libvlc_state_t enum: 1=NothingSpecial, 2=Opening, 3=Buffering, 4=Playing,
    // 5=Paused, 6=Stopped, 7=Ended, 8=Error
    return ['idle','idle','opening','buffering','playing','paused','stopped','ended','error'][s] || 'idle';
  }

  /**
   * Returns { time, duration, state, position, rate, volume, hasVout }
   */
  getFullState() {
    if (!this._available || !this._mediaPlayer) {
      return { available: false, time: 0, duration: 0, state: 'idle', position: 0, rate: 1, volume: 80, hasVout: 0 };
    }
    const v = vlc.load();
    const timeMs = Number(v.libvlc_media_player_get_time(this._mediaPlayer));
    const durationMs = Number(v.libvlc_media_player_get_length(this._mediaPlayer));
    const position = v.libvlc_media_player_get_position(this._mediaPlayer);
    const rate = v.libvlc_media_player_get_rate(this._mediaPlayer);
    const volume = v.libvlc_audio_get_volume(this._mediaPlayer);
    const hasVout = v.libvlc_media_player_has_vout(this._mediaPlayer);
    return {
      available: true,
      time: timeMs > 0 ? timeMs / 1000 : 0,
      duration: durationMs > 0 ? durationMs / 1000 : 0,
      state: this.getState(),
      position,
      rate,
      volume: volume < 0 ? 0 : volume,
      hasVout
    };
  }

  getTracks() {
    if (!this._available || !this._mediaPlayer) return { audio: [], subtitles: [], chapters: 0, currentChapter: 0 };
    const v = vlc.load();
    const audioDescPtr = v.libvlc_audio_get_track_description(this._mediaPlayer);
    const spuDescPtr = v.libvlc_video_get_spu_description(this._mediaPlayer);
    const currentAudio = v.libvlc_audio_get_track(this._mediaPlayer);
    const currentSpu = v.libvlc_video_get_spu(this._mediaPlayer);
    const chapterCount = v.libvlc_media_player_get_chapter_count(this._mediaPlayer);
    const currentChapter = v.libvlc_media_player_get_chapter(this._mediaPlayer);

    return {
      audio: User32.readTrackDescription(audioDescPtr, currentAudio),
      subtitles: User32.readTrackDescription(spuDescPtr, currentSpu),
      chapters: chapterCount,
      currentChapter
    };
  }

  // ─── Polling loop ──────────────────────────────────────────────────
  // We poll libvlc_media_player_get_state() every 200ms and emit events
  // to the renderer when state changes. Simpler + more reliable than
  // hooking libvlc_event_attach (which requires C struct marshaling).
  _startPollLoop() {
    if (this._pollTimer) return;
    this._pollTimer = setInterval(() => this._pollOnce(), 200);
    // Don't keep the process alive just for polling
    if (this._pollTimer.unref) this._pollTimer.unref();
    // Immediate first poll
    this._pollOnce();
  }

  _stopPollLoop() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  _pollOnce() {
    if (!this._mainWindow || this._mainWindow.isDestroyed()) return;
    const state = this.getFullState();
    const stateName = state.state;

    // Always send time updates so the progress bar moves smoothly
    this._mainWindow.webContents.send('nova:engine-event', {
      type: 'time',
      time: state.time,
      duration: state.duration,
      position: state.position
    });

    // Send state changes only when they happen
    if (stateName !== this._lastState) {
      this._lastState = stateName;
      this._mainWindow.webContents.send('nova:engine-event', {
        type: 'state',
        state: stateName,
        time: state.time,
        duration: state.duration
      });

      // If ended, fire a special event so the renderer can advance playlist
      if (stateName === 'ended') {
        this._mainWindow.webContents.send('nova:engine-event', { type: 'end' });
      } else if (stateName === 'error') {
        this._mainWindow.webContents.send('nova:engine-event', { type: 'error', message: 'libVLC reported an error during playback' });
      }
    }
  }

  _releaseMedia() {
    if (!this._media) return;
    try { vlc.load().libvlc_media_release(this._media); } catch (_) {}
    this._media = null;
  }

  _releasePlayer() {
    if (!this._mediaPlayer) return;
    try {
      vlc.load().libvlc_media_player_stop(this._mediaPlayer);
    } catch (_) {}
    try {
      vlc.load().libvlc_media_player_release(this._mediaPlayer);
    } catch (_) {}
    this._mediaPlayer = null;
  }

  destroy() {
    try {
      this._stopPollLoop();
      this._releasePlayer();
      this._releaseMedia();
      if (this._vlcInstance) {
        try { vlc.load().libvlc_release(this._vlcInstance); } catch (_) {}
        this._vlcInstance = null;
      }
      if (this._childHwnd) {
        try { User32.destroyWindow(this._childHwnd); } catch (_) {}
        this._childHwnd = null;
      }
    } catch (err) {
      console.warn('[engine] destroy error:', err.message);
    }
  }
}

module.exports = VideoEngine;
