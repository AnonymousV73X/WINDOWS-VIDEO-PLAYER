/**
 * NovaPlay — VideoScreen (REVOLUTIONIZED v2)
 *
 * The unified video surface — no more separate VLC window.
 *
 * Key responsibilities:
 *   1. Show/hide the video screen.
 *   2. Report the .video-area rect to the main process (via nova:video-rect)
 *      so the libVLC child HWND can be SetWindowPos'd to overlay it.
 *   3. Drive the controls overlay (auto-hide on idle, show on mousemove).
 *   4. Wire up the PlayerControls component (seek, volume, transport).
 *   5. Wire up the TrackMenu (audio/subtitle/chapter selector).
 *   6. HTML5 fallback <video> element when libVLC is unavailable.
 *   7. Fullscreen handling (real OS fullscreen via nova:window-set-fullscreen).
 *
 * The .video-area div is TRANSPARENT (see main.css §10) — the libVLC child
 * HWND sits behind it in z-order, painted by libVLC's Direct3D output.
 * The child HWND is kept HWND_TOPMOST so it stays above Chromium's GPU
 * compositor surface (a sibling HWND).
 */

class VideoScreen {
  constructor() {
    this.screen = document.getElementById('video-screen');
    this.videoArea = document.getElementById('video-area');
    this.fallbackEl = document.getElementById('video-fallback-element');
    this.overlay = document.getElementById('player-controls-overlay');
    this.backBtn = document.getElementById('player-back-btn');
    this.titleEl = document.getElementById('player-video-title');

    this.playerControls = null;
    this.trackMenu = null;
    this._visible = false;
    this._useFallback = false;
    this._currentVideo = null;
    this._lastRect = null;
    this._rectTimer = null;
    this._resizeObserver = null;
    this._autoHideTimer = null;
    this._autoHideMs = 2500;
    this._callbacks = {};
    this._handlers = [];

    this._initRectReporting();
    this._initAutoHide();
    this._initBackButton();
    this._initRectRequestListener();
  }

  init(deps, callbacks = {}) {
    this.playerControls = deps.playerControls;
    this.trackMenu = deps.trackMenu;
    this._callbacks = callbacks;
  }

  // ─── Show / Hide ────────────────────────────────────────────────
  show(video) {
    this._currentVideo = video;
    this._visible = true;
    this.screen.classList.add('active');
    this.titleEl.textContent = video.title || 'Untitled';

    // Tell the engine to show the child HWND
    window.novaAPI.send('nova:engine-set-video-visible', true);

    // Report rect after layout settles
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.reportRect());
    });

    // Show controls initially
    this._showControls();

    document.body.classList.add('video-active');
  }

  hide() {
    this._visible = false;
    this.screen.classList.remove('active');

    // Hide the child HWND so it doesn't show stale frames
    window.novaAPI.send('nova:engine-set-video-visible', false);

    // Report zero rect so the child HWND gets hidden
    this._reportRectRaw({ x: 0, y: 0, width: 0, height: 0 });

    document.body.classList.remove('video-active');
  }

  isVisible() { return this._visible; }

  // ─── Engine availability ────────────────────────────────────────
  async checkEngine() {
    try {
      const available = await window.novaAPI.invoke('nova:engine-available');
      this._useFallback = !available;
      if (this._useFallback) {
        this.fallbackEl.classList.add('active');
        console.warn('[video-screen] libVLC unavailable — using HTML5 fallback');
      } else {
        this.fallbackEl.classList.remove('active');
        console.log('[video-screen] libVLC available — using native HWND embedding');
      }
      return available;
    } catch (err) {
      console.error('[video-screen] engine check failed:', err);
      this._useFallback = true;
      this.fallbackEl.classList.add('active');
      return false;
    }
  }

  // ─── Load a video ───────────────────────────────────────────────
  async load(video) {
    const engineAvailable = await this.checkEngine();

    if (engineAvailable) {
      const r = await window.novaAPI.invoke('nova:engine-load', video.filePath);
      if (!r || !r.ok) {
        console.error('[video-screen] engine-load failed, falling back:', r);
        this._useFallback = true;
        this.fallbackEl.classList.add('active');
        this._loadFallback(video.filePath);
      }
    } else {
      this._loadFallback(video.filePath);
    }

    // Restore volume from settings
    if (this.playerControls) {
      this.playerControls.restoreVolume();
    }
  }

  _loadFallback(filePath) {
    // HTML5 <video> fallback via nova-video:// protocol
    const url = 'nova-video://local/' + encodeURIComponent(filePath);
    this.fallbackEl.src = url;
    this.fallbackEl.load();
    this.fallbackEl.play().catch(err => {
      console.warn('[video-screen] fallback autoplay blocked:', err.message);
    });
  }

  // ─── Rect reporting — send .video-area rect to main process ─────
  _initRectReporting() {
    // ResizeObserver fires when the .video-area changes size (layout, sidebar resize, etc.)
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this.reportRect());
      this._resizeObserver.observe(this.videoArea);
    }

    // Window resize + scroll
    this._addHandler(window, 'resize', () => this.reportRect());

    // Periodic rect sync (60fps cap) — catches cases where ResizeObserver
    // doesn't fire (e.g. CSS transitions on the video-area's parent).
    this._rectTimer = setInterval(() => this.reportRect(), 100);

    // Initial report after a short delay
    setTimeout(() => this.reportRect(), 200);
  }

  _initRectRequestListener() {
    // Main process asks us to re-report the rect after window events
    window.novaAPI.on('nova:video-rect-request', () => {
      this.reportRect();
    });
  }

  reportRect() {
    if (!this._visible || !this.videoArea || this.screen.classList.contains('active') === false) {
      this._reportRectRaw({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }

    const rect = this.videoArea.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Convert CSS pixels → physical pixels (libVLC child HWND uses physical coords)
    const newRect = {
      x: Math.round(rect.left * dpr),
      y: Math.round(rect.top * dpr),
      width: Math.round(rect.width * dpr),
      height: Math.round(rect.height * dpr)
    };

    // Skip if unchanged
    if (this._rectEquals(newRect, this._lastRect)) return;
    this._lastRect = newRect;
    this._reportRectRaw(newRect);
  }

  _reportRectRaw(rect) {
    window.novaAPI.send('nova:video-rect', rect);
  }

  _rectEquals(a, b) {
    if (!a || !b) return false;
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  }

  // ─── Controls overlay auto-hide ─────────────────────────────────
  _initAutoHide() {
    this._addHandler(this.screen, 'mousemove', () => this._showControls());
    this._addHandler(this.screen, 'mousedown', () => this._showControls());
    this._addHandler(this.screen, 'touchstart', () => this._showControls(), { passive: true });

    // Pause auto-hide when hovering controls
    this._addHandler(this.overlay, 'mouseenter', () => this._pauseAutoHide());
    this._addHandler(this.overlay, 'mouseleave', () => this._showControls());

    // Disable auto-hide when dragging progress/volume
    document.addEventListener('np:dragging-start', () => this._pauseAutoHide());
    document.addEventListener('np:dragging-end', () => this._showControls());
  }

  _showControls() {
    if (!this._visible) return;
    this.overlay.classList.add('visible');
    this._resetAutoHide();
  }

  _pauseAutoHide() {
    if (this._autoHideTimer) {
      clearTimeout(this._autoHideTimer);
      this._autoHideTimer = null;
    }
  }

  _resetAutoHide() {
    this._pauseAutoHide();
    this._autoHideTimer = setTimeout(() => {
      // Only auto-hide if not dragging and track menu closed
      if (this.trackMenu && this.trackMenu.isVisible()) return;
      this.overlay.classList.remove('visible');
    }, this._autoHideMs);
  }

  setAutoHideMs(ms) {
    this._autoHideMs = Math.max(500, Math.min(10000, ms));
    this._resetAutoHide();
  }

  // ─── Back button ────────────────────────────────────────────────
  _initBackButton() {
    this._addHandler(this.backBtn, 'click', () => {
      this._callbacks.onBack?.();
    });
  }

  // ─── Fullscreen ─────────────────────────────────────────────────
  async toggleFullscreen() {
    const isFs = await window.novaAPI.invoke('nova:window-is-fullscreen');
    window.novaAPI.send('nova:window-set-fullscreen', !isFs);
    // Hide caption buttons when fullscreen
    await window.novaAPI.invoke('nova:window-set-overlay-chrome', !isFs);
    // Re-report rect after fullscreen transition
    setTimeout(() => this.reportRect(), 300);
  }

  // ─── Engine event subscription ──────────────────────────────────
  subscribeEngineEvents(onTime, onState, onEnd, onError) {
    return window.novaAPI.on('nova:engine-event', (event) => {
      if (!event) return;
      switch (event.type) {
        case 'time':
          onTime?.(event);
          break;
        case 'state':
          onState?.(event);
          break;
        case 'end':
          onEnd?.(event);
          break;
        case 'error':
          onError?.(event);
          break;
      }
    });
  }

  // ─── HTML5 fallback event subscription ──────────────────────────
  subscribeFallbackEvents(onTime, onState, onEnd, onError) {
    if (!this.fallbackEl) return () => {};
    const handlers = [
      { ev: 'timeupdate', fn: () => onTime?.({ time: this.fallbackEl.currentTime, duration: this.fallbackEl.duration, position: this.fallbackEl.currentTime / (this.fallbackEl.duration || 1) }) },
      { ev: 'play', fn: () => onState?.({ state: 'playing' }) },
      { ev: 'pause', fn: () => onState?.({ state: 'paused' }) },
      { ev: 'ended', fn: () => onEnd?.({}) },
      { ev: 'error', fn: () => onError?.({ message: 'HTML5 video error' }) }
    ];
    for (const { ev, fn } of handlers) {
      this.fallbackEl.addEventListener(ev, fn);
      this._handlers.push({ el: this.fallbackEl, ev, fn });
    }
    return () => {
      for (const { el, ev, fn } of handlers) {
        el.removeEventListener(ev, fn);
      }
    };
  }

  // ─── Engine control proxies ─────────────────────────────────────
  async enginePlay() {
    if (this._useFallback) {
      try { await this.fallbackEl.play(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    }
    return window.novaAPI.invoke('nova:engine-play');
  }

  async enginePause() {
    if (this._useFallback) {
      this.fallbackEl.pause();
      return { ok: true };
    }
    return window.novaAPI.invoke('nova:engine-pause');
  }

  async engineToggle() {
    if (this._useFallback) {
      if (this.fallbackEl.paused) return this.enginePlay();
      return this.enginePause();
    }
    return window.novaAPI.invoke('nova:engine-toggle');
  }

  async engineSeek(timeSec) {
    if (this._useFallback) {
      this.fallbackEl.currentTime = timeSec;
      return { ok: true };
    }
    return window.novaAPI.invoke('nova:engine-seek', timeSec);
  }

  async engineSetVolume(vol) {
    if (this._useFallback) {
      this.fallbackEl.volume = vol;
      return { ok: true };
    }
    return window.novaAPI.invoke('nova:engine-volume', vol);
  }

  async engineSetRate(rate) {
    if (this._useFallback) {
      this.fallbackEl.playbackRate = rate;
      return { ok: true };
    }
    return window.novaAPI.invoke('nova:engine-rate', rate);
  }

  async engineSetAudioTrack(id) {
    if (this._useFallback) return { ok: false, error: 'Not supported in fallback' };
    return window.novaAPI.invoke('nova:engine-audio-track', id);
  }

  async engineSetSubtitleTrack(id) {
    if (this._useFallback) {
      // Toggle native <track> elements if any
      return { ok: true };
    }
    return window.novaAPI.invoke('nova:engine-subtitle-track', id);
  }

  async engineSetChapter(ch) {
    if (this._useFallback) return { ok: false, error: 'Not supported in fallback' };
    return window.novaAPI.invoke('nova:engine-chapter', ch);
  }

  async engineGetTracks() {
    if (this._useFallback) return { audio: [], subtitles: [], chapters: 0, currentChapter: 0 };
    return window.novaAPI.invoke('nova:engine-tracks');
  }

  // ─── Cleanup ────────────────────────────────────────────────────
  _addHandler(el, ev, fn, opts) {
    el.addEventListener(ev, fn, opts);
    this._handlers.push({ el, ev, fn });
  }

  destroy() {
    for (const { el, ev, fn } of this._handlers) {
      try { el.removeEventListener(ev, fn); } catch (_) {}
    }
    this._handlers = [];
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._rectTimer) {
      clearInterval(this._rectTimer);
      this._rectTimer = null;
    }
    if (this._autoHideTimer) {
      clearTimeout(this._autoHideTimer);
      this._autoHideTimer = null;
    }
  }
}

module.exports = VideoScreen;
