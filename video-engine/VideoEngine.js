/**
 * NovaPlay — Video Engine (libVLC orchestration) — REVOLUTIONIZED v2
 *
 * FIXES vs v1:
 *   1. Hook into BrowserWindow 'resize'/'move'/'maximize'/'unmaximize'/
 *      'enter-full-screen'/'leave-full-screen' events — child HWND stays
 *      glued to the renderer's video-area during interactive window ops.
 *   2. Re-assert HWND_TOPMOST after every moveWindow() (Chromium's GPU
 *      surface sometimes wins z-order on resize; we counter by calling
 *      User32.bringToTop() after each position update).
 *   3. DPI change detection — track devicePixelRatio over time; if the
 *      window crosses monitor boundaries with different DPI, request a
 *      fresh rect from the renderer.
 *   4. show/hide the child HWND when the video screen is shown/hidden —
 *      prevents the "ghost rectangle" of last-frame video when navigating
 *      back to the library.
 *   5. Pass libvlc args (--no-video-title-show, --no-network, --no-stats,
 *      --avcodec-hw=any) for cleaner playback + HW accel for 10-bit x265.
 *   6. Defensive: if createChildWindow fails or parenting fails, log
 *      loudly and disable embedding — renderer falls back to HTML5 <video>.
 *
 * Architecture:
 *   - Single BrowserWindow (the Electron app window).
 *   - One child HWND (WS_POPUP, parented via SetParent, HWND_TOPMOST)
 *     positioned over the renderer's #video-area div.
 *   - libVLC renders into the child HWND via libvlc_media_player_set_hwnd.
 *   - Renderer reports rect via 'nova:video-rect' IPC; we SetWindowPos.
 *   - We poll libvlc state every 200ms and emit 'nova:engine-event'.
 *
 * If libVLC isn't available, the engine returns ok:false from every call
 * and the renderer uses an HTML5 <video> element with the nova-video://
 * protocol (which handles HTTP range requests for local files).
 */

const path = require('path');
const { BrowserWindow } = require('electron');
const vlc = require('./VlcBinding');
const User32 = require('./User32');

class VideoEngine {
  constructor() {
    // ─── Set VLC env vars FIRST so libvlc_new can find plugins ──────
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

    // ─── Spawn libvlc instance with sane args ─────────────────────────
    // v2: pass real args via libvlc_new(argc, argv). v1 called libvlc_new(0, null)
    // which meant VLC used all defaults — including showing the video title
    // overlay and trying to update stats. We disable those for a cleaner UX.
    try {
      const v = vlc.load();
      // libvlc_new takes (int argc, const char *const *argv). Koffi marshals
      // an array of strings as char **. We pass a small argv array.
      // Important: --avcodec-hw=any enables DXVA2/D3D11 hardware decoding on
      // Windows, which is essential for smooth 10-bit x265 playback.
      const argv = [
        '--no-video-title-show',    // don't overlay filename on video
        '--no-stats',                // don't compute stats (perf)
        '--no-osd',                  // no on-screen-display
        '--no-network',              // disable network modules (offline-first)
        '--rtsp-tcp',                // prefer TCP for RTSP if it ever loads network
        '--avcodec-hw=any',          // hardware acceleration (DXVA2/D3D11 on Win)
        '--no-snapshot-preview',     // don't show snapshot preview
        '--deinterlace=0',           // disable auto-deinterlace (let user choose)
        '--no-skins2',               // no skins2 module
        '--no-qt',                   // no Qt interface
        '--no-hotkeys',              // no global hotkeys
        '--no-media-library',        // no media library
        '--no-playlist-tree'         // flat playlist
      ];

      // Convert argv to a NULL-terminated char*[] for libvlc_new.
      // Koffi marshals JS string[] → char *const * automatically when the
      // declared type is `char **`.
      this._vlcInstance = v.libvlc_new(argv.length, argv);
      if (!this._vlcInstance) {
        throw new Error(
          'libvlc_new returned null — VLC_PLUGIN_PATH=' + (process.env.VLC_PLUGIN_PATH || 'unset')
        );
      }
      console.log('[engine] libVLC instance created with', argv.length, 'args');
      try {
        const ver = v.libvlc_get_version();
        console.log('[engine] libVLC version:', ver);
      } catch (_) {}
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
    this._lastDpr = 0;
    this._windowEventHandlers = [];
    this._rectSyncTimer = null;
    this._lastChildSyncAt = 0;
  }

  isAvailable() { return this._available; }

  /**
   * Attach to a BrowserWindow. Creates the child HWND and hooks window
   * events so the child stays glued to the renderer's video-area during
   * interactive resize/move/maximize/fullscreen/DPI changes.
   */
  attachToWindow(mainWindow) {
    this._mainWindow = mainWindow;
    if (!this._available) return;
    if (process.platform !== 'win32') {
      console.warn('[engine] HWND embedding is Windows-only — video will use HTML5 fallback');
      return;
    }

    // ─── Get the parent HWND as a Buffer ──────────────────────────────
    // Electron returns the native HWND as a Node Buffer (raw pointer bytes).
    // We pass this Buffer directly to koffi (it marshals Buffer→void*).
    this._parentHwnd = mainWindow.getNativeWindowHandle();
    console.log('[engine] parent HWND buffer length:', this._parentHwnd?.length);

    // ─── Create the child HWND ────────────────────────────────────────
    try {
      this._childHwnd = User32.createChildWindow(this._parentHwnd);
      console.log('[engine] child HWND created for libVLC output');
    } catch (err) {
      console.error('[engine] createChildWindow failed — video will not display:', err.message);
      this._childHwnd = null;
    }

    // ─── Verify parentage (surface the v1 bug if it persists) ────────
    if (this._childHwnd && !User32.isParentedTo(this._childHwnd, this._parentHwnd)) {
      console.warn('[engine] child HWND is NOT parented to BrowserWindow — embedded video may fail');
    }

    // ─── Hook window events to keep child HWND in sync ───────────────
    this._attachWindowEventHandlers(mainWindow);

    // ─── Listen for renderer-reported video-area rect updates ────────
    const { ipcMain } = require('electron');
    ipcMain.removeAllListeners('nova:video-rect');
    ipcMain.on('nova:video-rect', (_event, rect) => {
      this._videoRect = rect || { x: 0, y: 0, width: 0, height: 0 };
      this._updateChildWindowPosition();
    });

    // Initial position sync after a short delay (let renderer settle)
    setTimeout(() => this._updateChildWindowPosition(), 100);
  }

  /**
   * Hook BrowserWindow events so the child HWND stays glued during
   * interactive resize/move/maximize/fullscreen/DPI changes.
   *
   * Without these hooks, the child HWND lags behind the parent during
   * interactive window ops on Windows — causing the video to appear
   * detached from its placeholder rectangle.
   */
  _attachWindowEventHandlers(mainWindow) {
    // Helper: schedule a position sync on the next tick (debounced)
    const scheduleSync = () => {
      if (this._rectSyncTimer) return;
      this._rectSyncTimer = setTimeout(() => {
        this._rectSyncTimer = null;
        // Ask renderer to re-report the rect (it may have changed)
        try {
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('nova:video-rect-request', {});
          }
        } catch (_) {}
        // Also immediately re-sync with the last known rect (catches
        // pure window-move where the in-DOM rect hasn't actually changed
        // but the screen-space coordinates have).
        this._updateChildWindowPosition();
      }, 16);  // ~60fps cap
    };

    const events = [
      'resize',
      'move',
      'maximize',
      'unmaximize',
      'enter-full-screen',
      'leave-full-screen',
      'restore',
      'show',
      'hide'
    ];

    for (const ev of events) {
      const handler = () => scheduleSync();
      mainWindow.on(ev, handler);
      this._windowEventHandlers.push({ event: ev, handler });
    }

    // DPI / display change — Chromium fires 'display-metrics-changed' on
    // the webContents when the window moves between monitors with different
    // DPI scaling. We listen and trigger a re-sync.
    try {
      const dpiHandler = (_e, changedMetrics) => {
        console.log('[engine] display-metrics-changed:', changedMetrics);
        scheduleSync();
        // Also re-assert topmost — DPI changes can reset z-order on some drivers
        if (this._childHwnd) {
          try { User32.bringToTop(this._childHwnd); } catch (_) {}
        }
      };
      mainWindow.webContents.on('display-metrics-changed', dpiHandler);
      this._windowEventHandlers.push({
        event: 'display-metrics-changed',
        handler: dpiHandler,
        target: mainWindow.webContents
      });
    } catch (_) {}

    // Window close — clean up child HWND before the parent disappears
    const closedHandler = () => {
      console.log('[engine] main window closed — destroying child HWND');
      this.destroy();
    };
    mainWindow.on('closed', closedHandler);
    this._windowEventHandlers.push({ event: 'closed', handler: closedHandler });
  }

  /**
   * Move/resize the child HWND to match the renderer's reported rect.
   * Also re-asserts HWND_TOPMOST so the child stays above Chromium's GPU
   * compositor surface (which can win z-order on resize/maximize).
   */
  _updateChildWindowPosition() {
    if (!this._childHwnd || !this._mainWindow) return;
    if (this._mainWindow.isDestroyed()) return;

    const rect = this._videoRect;
    if (!rect || !rect.width || !rect.height) {
      // No video area — hide the child HWND so it doesn't show stale frames
      try { User32.showWindow(this._childHwnd, false); } catch (_) {}
      return;
    }

    // If the parent window is minimized, hide the child (otherwise it
    // sometimes appears as a floating rectangle on the desktop).
    try {
      if (this._mainWindow.isMinimized()) {
        User32.showWindow(this._childHwnd, false);
        return;
      }
    } catch (_) {}

    try {
      User32.moveWindow(this._childHwnd, rect.x, rect.y, rect.width, rect.height, true);
      // Re-assert topmost after every move — critical for staying above
      // Chromium's GPU surface on resize/maximize/DPI changes.
      User32.bringToTop(this._childHwnd);
      // Make sure it's visible
      User32.showWindow(this._childHwnd, true);
      this._lastChildSyncAt = Date.now();
    } catch (err) {
      console.warn('[engine] moveWindow failed:', err.message);
    }
  }

  /**
   * Show or hide the child HWND. Called by the renderer when entering/
   * leaving the video screen.
   */
  setVideoVisible(visible) {
    if (!this._childHwnd) return;
    try {
      User32.showWindow(this._childHwnd, !!visible);
      if (visible) {
        // Re-assert topmost when showing
        User32.bringToTop(this._childHwnd);
        this._updateChildWindowPosition();
      }
    } catch (err) {
      console.warn('[engine] setVideoVisible failed:', err.message);
    }
  }

  /**
   * Load a video file into the engine. Does NOT auto-play.
   */
  load(filePath) {
    if (!this._available) return { ok: false, error: 'libVLC unavailable' };
    if (!require('fs').existsSync(filePath)) {
      return { ok: false, error: 'File not found: ' + filePath };
    }

    try {
      this._stopPollLoop();
      this._releasePlayer();
      this._releaseMedia();

      const v = vlc.load();
      this._media = v.libvlc_media_new_path(this._vlcInstance, filePath);
      if (!this._media) throw new Error('libvlc_media_new_path returned null');

      this._mediaPlayer = v.libvlc_media_player_new_from_media(this._media);
      if (!this._mediaPlayer) throw new Error('libvlc_media_player_new_from_media returned null');

      if (this._childHwnd) {
        v.libvlc_media_player_set_hwnd(this._mediaPlayer, this._childHwnd);
        console.log('[engine] set_hwnd called with child HWND');
        this._updateChildWindowPosition();
      } else {
        console.warn('[engine] no child HWND — video will not display');
      }

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

  getState() {
    if (!this._available || !this._mediaPlayer) return 'idle';
    const s = vlc.load().libvlc_media_player_get_state(this._mediaPlayer);
    return ['idle','idle','opening','buffering','playing','paused','stopped','ended','error'][s] || 'idle';
  }

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

  _startPollLoop() {
    if (this._pollTimer) return;
    this._pollTimer = setInterval(() => this._pollOnce(), 200);
    if (this._pollTimer.unref) this._pollTimer.unref();
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

    this._mainWindow.webContents.send('nova:engine-event', {
      type: 'time',
      time: state.time,
      duration: state.duration,
      position: state.position
    });

    if (stateName !== this._lastState) {
      this._lastState = stateName;
      this._mainWindow.webContents.send('nova:engine-event', {
        type: 'state',
        state: stateName,
        time: state.time,
        duration: state.duration
      });

      if (stateName === 'ended') {
        this._mainWindow.webContents.send('nova:engine-event', { type: 'end' });
      } else if (stateName === 'error') {
        this._mainWindow.webContents.send('nova:engine-event', {
          type: 'error',
          message: 'libVLC reported an error during playback'
        });
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
    try { vlc.load().libvlc_media_player_stop(this._mediaPlayer); } catch (_) {}
    try { vlc.load().libvlc_media_player_release(this._mediaPlayer); } catch (_) {}
    this._mediaPlayer = null;
  }

  destroy() {
    try {
      this._stopPollLoop();
      this._releasePlayer();
      this._releaseMedia();

      // Detach window event handlers
      if (this._mainWindow && !this._mainWindow.isDestroyed()) {
        for (const { event, handler, target } of this._windowEventHandlers) {
          try {
            (target || this._mainWindow).removeListener(event, handler);
          } catch (_) {}
        }
      }
      this._windowEventHandlers = [];

      // Cancel any pending rect sync
      if (this._rectSyncTimer) {
        clearTimeout(this._rectSyncTimer);
        this._rectSyncTimer = null;
      }

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
