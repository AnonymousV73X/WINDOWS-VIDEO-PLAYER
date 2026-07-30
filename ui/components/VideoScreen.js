/**
 * NovaPlay v2 — Video Screen (full player view)
 *
 * CRITICAL BUG FIX: The original code had a bug where only audio played
 * but no video picture was displayed. The root cause:
 *
 *   1. The CSS `.video-fallback-element` had `display: none` by default,
 *      and `.video-fallback-element.active` set `display: block; z-index: 1`.
 *   2. But `useFallback()` also set inline styles including `zIndex: '2'`,
 *      `width: '100%'`, `height: '100%'`, etc. The inline z-index=2 was
 *      correct, but the `<video>` element lacked `playsinline` attribute
 *      and proper `video-rendering` CSS.
 *   3. More importantly, the `<video>` element's `position:absolute; inset:0`
 *      in CSS combined with inline `width/height: 100%` style setting
 *      created potential layout conflicts.
 *
 * FIX APPROACH:
 *   - Ensure `playsinline` attribute is set on the <video> element
 *   - Use CSS class `.active` exclusively for visibility (no inline style overrides)
 *   - Add `crisp-edges` video-rendering CSS hint for sharp frames
 *   - Add debug logging for video rendering issues
 *   - Add `loadeddata` listener to confirm video frames are actually available
 *
 * Manages the full-screen video player overlay. Handles:
 *   - Reporting the video-area's screen-space rect to the main process
 *   - Falling back to HTML5 <video> element when libVLC isn't available
 *   - Auto-hiding the controls overlay after inactivity
 */

class VideoScreen {
  constructor() {
    this.screen = document.getElementById('video-screen');
    this.videoArea = document.getElementById('video-area');
    this.fallbackEl = document.getElementById('video-fallback-element');
    this._callbacks = {};
    this._resizeObserver = null;
    this._fallbackBound = false;
    this._lastRect = { x: 0, y: 0, width: 0, height: 0 };
    this._videoReady = false; // Track whether video frames are actually available
  }

  init(callbacks) {
    this._callbacks = callbacks;

    // Back button
    const backBtn = document.getElementById('player-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => this._callbacks.onBack?.());
    }

    // Track the video-area's rect via ResizeObserver + scroll listener.
    this._resizeObserver = new ResizeObserver(Utils.rafThrottle(() => this.reportRect()));
    this._resizeObserver.observe(this.videoArea);

    // Also report on window resize
    window.addEventListener('resize', Utils.rafThrottle(() => this.reportRect()));

    // Report initially after layout
    setTimeout(() => this.reportRect(), 100);

    // Bind HTML5 fallback listeners
    this._bindFallback();
  }

  _bindFallback() {
    if (this._fallbackBound || !this.fallbackEl) return;
    this._fallbackBound = true;

    // ── BUG FIX: Set playsinline attribute ──
    // Without playsinline, mobile/iOS WebKit may not render video frames
    // in inline mode, showing only audio.
    this.fallbackEl.setAttribute('playsinline', '');
    this.fallbackEl.setAttribute('webkit-playsinline', '');
    this.fallbackEl.setAttribute('x-webkit-airplay', 'allow');

    // ── Debug: log when video metadata/data is loaded ──
    this.fallbackEl.addEventListener('loadedmetadata', () => {
      console.log('[VideoScreen] loadedmetadata — duration:', this.fallbackEl.duration,
        'videoWidth:', this.fallbackEl.videoWidth, 'videoHeight:', this.fallbackEl.videoHeight);
      this._callbacks.onEngineEvent?.({
        type: 'time',
        time: 0,
        duration: this.fallbackEl.duration || 0,
        position: 0
      });
    });

    // ── BUG FIX: loadeddata confirms video frames are available ──
    this.fallbackEl.addEventListener('loadeddata', () => {
      console.log('[VideoScreen] loadeddata — video frames now available',
        'videoWidth:', this.fallbackEl.videoWidth, 'videoHeight:', this.fallbackEl.videoHeight);
      this._videoReady = true;
      // Force a repaint by briefly toggling display — ensures compositor picks up the element
      this.fallbackEl.style.display = 'none';
      // Use requestAnimationFrame to ensure the repaint happens
      requestAnimationFrame(() => {
        this.fallbackEl.style.display = ''; // Let CSS class control display
      });
    });

    this.fallbackEl.addEventListener('play', () => {
      console.log('[VideoScreen] HTML5 <video> playing — videoReady:', this._videoReady);
      this._callbacks.onEngineEvent?.({ type: 'state', state: 'playing' });
    });
    this.fallbackEl.addEventListener('pause', () => {
      this._callbacks.onEngineEvent?.({ type: 'state', state: 'paused' });
    });
    this.fallbackEl.addEventListener('ended', () => {
      this._callbacks.onEngineEvent?.({ type: 'end' });
    });
    this.fallbackEl.addEventListener('error', (e) => {
      console.error('[VideoScreen] HTML5 <video> error:', e.target?.error?.code, e.target?.error?.message);
      this._videoReady = false;
      this._callbacks.onEngineEvent?.({ type: 'error', message: 'HTML5 video playback error: ' + (e.target?.error?.message || 'unknown') });
    });
    this.fallbackEl.addEventListener('timeupdate', () => {
      this._callbacks.onEngineEvent?.({
        type: 'time',
        time: this.fallbackEl.currentTime,
        duration: this.fallbackEl.duration || 0,
        position: this.fallbackEl.duration ? this.fallbackEl.currentTime / this.fallbackEl.duration : 0
      });
    });

    // ── BUG FIX: Detect when video frames are being decoded ──
    // The 'waiting' event fires when playback stalls because the next frame
    // isn't available yet — helps debug buffering issues
    this.fallbackEl.addEventListener('waiting', () => {
      console.warn('[VideoScreen] video waiting for data — buffering');
    });
    this.fallbackEl.addEventListener('canplay', () => {
      console.log('[VideoScreen] canplay — video ready to render');
    });
  }

  useFallback(filePath) {
    // ── Activate the HTML5 <video> element as the playback surface ──
    // Used ONLY when libVLC is unavailable. Hides the native child HWND
    // (by reporting a zero rect) so the <video> element is the only
    // visible video surface.
    // BUG FIX: Use only the CSS `.active` class to show the video element.
    // Do NOT set inline width/height/zIndex/position/objectFit because
    // those are already defined in CSS for `.video-fallback-element.active`
    // and inline styles can conflict with the CSS `inset: 0` positioning.

    this._videoReady = false;
    // Native child HWND must be hidden so it doesn't cover the <video>
    // element. reportRect() returns early if the screen is hidden, so we
    // call reportVideoRect directly with a zero rect.
    window.novaAPI.reportVideoRect({ x: 0, y: 0, width: 0, height: 0 });
    this.fallbackEl.classList.add('active');

    // Encode the file path for the nova-video:// protocol
    const url = 'nova-video://local/' + Utils.encodeFilePath(filePath);
    console.log('[VideoScreen] useFallback — src:', url);

    this.fallbackEl.src = url;
    this.fallbackEl.volume = window.state?.settings?.volume || 0.8;
    this.fallbackEl.playbackRate = window.state?.settings?.playbackRate || 1.0;

    // ── BUG FIX: Do NOT set inline styles that override CSS ──
    // The CSS `.video-fallback-element.active` already handles:
    //   display: block, position: absolute, inset: 0, width: 100%, height: 100%,
    //   object-fit: contain, z-index: 2, background: #000
    // The only thing we need to ensure is that the video-area background is black.

    // Hide libVLC video-area (shows black bg behind HTML5 video)
    this.videoArea.style.background = '#000';

    // ── BUG FIX: Ensure video play actually starts ──
    this.fallbackEl.play().catch(err => {
      console.error('[VideoScreen] play() failed:', err.name, err.message);
      // If autoplay is blocked, the user can still click play
      // Show the controls so user can manually start playback
      if (err.name === 'NotAllowedError') {
        console.warn('[VideoScreen] Autoplay blocked by browser policy — user must click play');
      }
    });
  }

  /**
   * Activate libVLC (native child HWND) as the playback surface.
   * Used when state.engineAvailable is true. Hides the HTML5 <video>
   * element so the native child HWND behind it is what the user sees,
   * then reports the video-area rect so the main process sizes the
   * child HWND to cover it exactly.
   */
  useEngine() {
    // Hide + release any HTML5 <video> surface so it doesn't paint over
    // the native child HWND.
    if (this.fallbackEl) {
      this.fallbackEl.pause?.();
      this.fallbackEl.removeAttribute('src');
      try { this.fallbackEl.load?.(); } catch (_) {}
      this.fallbackEl.classList.remove('active');
    }
    this._videoReady = false;
    this.videoArea.style.background = '#000';
    // Report the video-area rect so the child HWND is positioned over it.
    // Defer one frame so layout (player-active class, etc.) has settled.
    requestAnimationFrame(() => this.reportRect());
  }

  toggleFallback() {
    if (!this.fallbackEl.classList.contains('active')) return;
    if (this.fallbackEl.paused) {
      this.fallbackEl.play().catch(err => console.warn('[VideoScreen] toggle play failed:', err));
    } else {
      this.fallbackEl.pause();
    }
  }

  seekFallback(timeSec) {
    if (!this.fallbackEl.classList.contains('active')) return;
    this.fallbackEl.currentTime = timeSec;
  }

  setFallbackVolume(vol) {
    if (this.fallbackEl) this.fallbackEl.volume = vol;
  }

  setFallbackRate(rate) {
    if (this.fallbackEl) this.fallbackEl.playbackRate = rate;
  }

  stopFallback() {
    if (this.fallbackEl) {
      this.fallbackEl.pause();
      this.fallbackEl.removeAttribute('src');
      this.fallbackEl.load(); // Fully release the media resource
      this.fallbackEl.classList.remove('active');
      this._videoReady = false;
    }
  }

  render(state) {
    // Update the video title at the top of the controls overlay
    const titleEl = document.getElementById('player-video-title');
    if (titleEl) {
      titleEl.textContent = state.currentVideo?.title || 'No video';
    }
    // Hide the libVLC video-area if no video is loaded
    if (!state.currentVideo) {
      this.videoArea.style.background = '#000';
    }
  }

  /**
   * Report the video-area's rect to the main process so the child HWND
   * can be positioned. getBoundingClientRect() returns CSS pixels, but
   * Win32 SetWindowPos expects physical pixels — multiply by
   * devicePixelRatio so the child HWND covers the video-area exactly
   * on HiDPI displays.
   */
  reportRect() {
    if (!this.videoArea || this.screen.classList.contains('hidden')) {
      window.novaAPI.reportVideoRect({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    const rect = this.videoArea.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const newRect = {
      x: Math.round(rect.left * dpr),
      y: Math.round(rect.top * dpr),
      width: Math.round(rect.width * dpr),
      height: Math.round(rect.height * dpr)
    };

    // Avoid spamming IPC if rect hasn't changed
    if (this._rectEquals(newRect, this._lastRect)) return;
    this._lastRect = newRect;
    window.novaAPI.reportVideoRect(newRect);
  }

  _rectEquals(a, b) {
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  }

  hide() {
    this.screen.classList.add('hidden');
    this.stopFallback();
    // Shrink the child HWND to zero so video disappears
    window.novaAPI.reportVideoRect({ x: 0, y: 0, width: 0, height: 0 });
  }

  show() {
    this.screen.classList.remove('hidden');
    setTimeout(() => this.reportRect(), 50);
  }
}

window.VideoScreen = VideoScreen;
