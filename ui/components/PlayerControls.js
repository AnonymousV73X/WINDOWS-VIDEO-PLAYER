/**
 * NovaPlay — PlayerControls (REVOLUTIONIZED v2)
 *
 * Wires up the bottom-row controls of the video screen:
 *   - Progress bar with hover bubble, buffer fill, drag-to-seek
 *   - Volume button + slider with 3-state icon (mute/low/high)
 *   - Prev / Play-Pause / Next transport buttons
 *   - Speed pill (cycles 0.25 → 0.5 → 0.75 → 1 → 1.25 → 1.5 → 2 → 4)
 *   - Shuffle / Repeat (off → all → one) / Fullscreen
 *   - Keyboard shortcuts (Space, F, Esc, M, ↑↓, Shift+←→)
 *
 * NovaTune-style: progress fill uses var(--green) with a soft glow,
 * volume bar turns green on hover, transport buttons turn green when active.
 */

class PlayerControls {
  constructor() {
    // Progress
    this.progressBarWrap = document.getElementById('progress-bar-wrap');
    this.progressBar = document.getElementById('progress-bar');
    this.progressFill = document.getElementById('progress-fill');
    this.progressBuffer = document.getElementById('progress-buffer-fill');
    this.progressHandle = document.getElementById('progress-handle');
    this.progressBubble = document.getElementById('progress-bubble');
    this.timeCurrent = document.getElementById('time-current');
    this.timeTotal = document.getElementById('time-total');

    // Volume
    this.volumeBtn = document.getElementById('volume-btn');
    this.volumeIcon = document.getElementById('volume-icon');
    this.volumeBarWrap = document.getElementById('volume-bar-wrap');
    this.volumeFill = document.getElementById('volume-fill');
    this.volumeHandle = document.getElementById('volume-handle');

    // Transport
    this.prevBtn = document.getElementById('prev-btn');
    this.playPauseBtn = document.getElementById('play-pause-btn');
    this.playPauseIcon = document.getElementById('play-pause-icon');
    this.nextBtn = document.getElementById('next-btn');

    // Right cluster
    this.speedPill = document.getElementById('speed-pill');
    this.shuffleBtn = document.getElementById('shuffle-btn');
    this.repeatBtn = document.getElementById('repeat-btn');
    this.fullscreenBtn = document.getElementById('fullscreen-btn');

    // Top actions (audio/subtitle/chapter/settings)
    this.actionAudio = document.getElementById('action-audio-tracks');
    this.actionSubtitle = document.getElementById('action-subtitle-tracks');
    this.actionChapter = document.getElementById('action-chapters');
    this.actionSettings = document.getElementById('action-settings');

    this._videoScreen = null;
    this._callbacks = {};
    this._handlers = [];

    // State
    this._isPlaying = false;
    this._duration = 0;
    this._currentTime = 0;
    this._volume = 0.8;
    this._muted = false;
    this._rate = 1;
    this._shuffle = false;
    this._repeatMode = 'off';   // 'off' | 'all' | 'one'
    this._draggingProgress = false;
    this._draggingVolume = false;

    this._speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4];
    this._speedIdx = 3;  // default 1x

    this._init();
  }

  init(videoScreen, callbacks = {}) {
    this._videoScreen = videoScreen;
    this._callbacks = callbacks;
  }

  _init() {
    this._initProgress();
    this._initVolume();
    this._initTransport();
    this._initSpeed();
    this._initShuffleRepeat();
    this._initFullscreen();
    this._initActions();
    this._initKeyboard();
  }

  // ═══ Progress bar ═══════════════════════════════════════════════
  _initProgress() {
    const onMove = (e) => {
      const rect = this.progressBar.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const x = clientX - rect.left;
      const pct = Math.max(0, Math.min(1, x / rect.width));
      // Update bubble position + time
      this.progressBubble.style.left = (pct * 100) + '%';
      this.progressBubble.textContent = this._formatTime(pct * this._duration);
    };

    const onDown = (e) => {
      this._draggingProgress = true;
      this.progressBarWrap.classList.add('dragging');
      document.dispatchEvent(new CustomEvent('np:dragging-start'));
      const rect = this.progressBar.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const x = clientX - rect.left;
      const pct = Math.max(0, Math.min(1, x / rect.width));
      this._setProgressUI(pct);
      onMove(e);
    };

    const onUp = (e) => {
      if (!this._draggingProgress) return;
      this._draggingProgress = false;
      this.progressBarWrap.classList.remove('dragging');
      document.dispatchEvent(new CustomEvent('np:dragging-end'));
      // Seek to the position
      const rect = this.progressBar.getBoundingClientRect();
      const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
      const x = clientX - rect.left;
      const pct = Math.max(0, Math.min(1, x / rect.width));
      const targetTime = pct * this._duration;
      this._videoScreen?.engineSeek(targetTime);
    };

    this._addHandler(this.progressBarWrap, 'mousedown', onDown);
    this._addHandler(this.progressBarWrap, 'mousemove', onMove);
    this._addHandler(document, 'mousemove', (e) => { if (this._draggingProgress) onMove(e); });
    this._addHandler(document, 'mouseup', onUp);

    // Touch
    this._addHandler(this.progressBarWrap, 'touchstart', onDown, { passive: true });
    this._addHandler(this.progressBarWrap, 'touchmove', onMove, { passive: true });
    this._addHandler(document, 'touchend', onUp);
  }

  _setProgressUI(pct) {
    const clamped = Math.max(0, Math.min(1, pct));
    this.progressFill.style.width = (clamped * 100) + '%';
    this.progressHandle.style.left = (clamped * 100) + '%';
  }

  setTime(time, duration, position) {
    if (this._draggingProgress) return;  // don't fight the user
    this._currentTime = time;
    this._duration = duration || this._duration;
    const pct = this._duration > 0 ? (time / this._duration) : 0;
    this._setProgressUI(pct);
    this.timeCurrent.textContent = this._formatTime(time);
    this.timeTotal.textContent = this._formatTime(this._duration);
  }

  setBuffered(pct) {
    if (this.progressBuffer) {
      this.progressBuffer.style.width = (pct * 100) + '%';
    }
  }

  // ═══ Volume ═════════════════════════════════════════════════════
  _initVolume() {
    const onMove = (e) => {
      const rect = this.volumeBarWrap.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const x = clientX - rect.left;
      const pct = Math.max(0, Math.min(1, x / rect.width));
      this.setVolume(pct);
    };

    const onDown = (e) => {
      this._draggingVolume = true;
      this.volumeBarWrap.classList.add('dragging');
      document.dispatchEvent(new CustomEvent('np:dragging-start'));
      onMove(e);
    };

    const onUp = () => {
      if (!this._draggingVolume) return;
      this._draggingVolume = false;
      this.volumeBarWrap.classList.remove('dragging');
      document.dispatchEvent(new CustomEvent('np:dragging-end'));
      // Persist volume
      this._callbacks.onVolumeChange?.(this._volume);
    };

    this._addHandler(this.volumeBarWrap, 'mousedown', onDown);
    this._addHandler(document, 'mousemove', (e) => { if (this._draggingVolume) onMove(e); });
    this._addHandler(document, 'mouseup', onUp);

    this._addHandler(this.volumeBarWrap, 'touchstart', onDown, { passive: true });
    this._addHandler(this.volumeBarWrap, 'touchmove', onMove, { passive: true });
    this._addHandler(document, 'touchend', onUp);

    // Mute toggle
    this._addHandler(this.volumeBtn, 'click', () => {
      this.setMuted(!this._muted);
    });
  }

  setVolume(vol) {
    this._volume = Math.max(0, Math.min(1, vol));
    this._muted = this._volume === 0;
    this.volumeFill.style.width = (this._volume * 100) + '%';
    this.volumeHandle.style.left = (this._volume * 100) + '%';
    this._updateVolumeIcon();
    this._videoScreen?.engineSetVolume(this._volume);
    this._callbacks.onVolumeChange?.(this._volume);
  }

  setMuted(muted) {
    this._muted = !!muted;
    if (this._muted) {
      this._videoScreen?.engineSetVolume(0);
    } else {
      this._videoScreen?.engineSetVolume(this._volume);
    }
    this._updateVolumeIcon();
  }

  _updateVolumeIcon() {
    const v = this._muted ? 0 : this._volume;
    let svg;
    if (v === 0) {
      // Mute
      svg = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
             <line x1="23" y1="9" x2="17" y2="15"/>
             <line x1="17" y1="9" x2="23" y2="15"/>`;
    } else if (v < 0.5) {
      // Low volume
      svg = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
             <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>`;
    } else {
      // High volume
      svg = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
             <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>`;
    }
    this.volumeIcon.innerHTML = svg;
  }

  restoreVolume() {
    // Called when entering the video screen — apply current volume to engine
    this._videoScreen?.engineSetVolume(this._muted ? 0 : this._volume);
  }

  getVolume() { return this._volume; }
  isMuted() { return this._muted; }

  // ═══ Transport ══════════════════════════════════════════════════
  _initTransport() {
    this._addHandler(this.playPauseBtn, 'click', () => this._onPlayPause());
    this._addHandler(this.prevBtn, 'click', () => this._callbacks.onPrev?.());
    this._addHandler(this.nextBtn, 'click', () => this._callbacks.onNext?.());
  }

  async _onPlayPause() {
    await this._videoScreen?.engineToggle();
  }

  setPlaying(playing) {
    this._isPlaying = !!playing;
    if (this._isPlaying) {
      // Pause icon
      this.playPauseIcon.innerHTML = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;
    } else {
      // Play icon
      this.playPauseIcon.innerHTML = `<polygon points="5,3 19,12 5,21"/>`;
    }
    // Update now-playing bar play icon too
    const npPlayIcon = document.getElementById('np-play-icon');
    if (npPlayIcon) {
      npPlayIcon.innerHTML = this._isPlaying
        ? `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`
        : `<polygon points="5,3 19,12 5,21"/>`;
    }
  }

  isPlaying() { return this._isPlaying; }

  // ═══ Speed ══════════════════════════════════════════════════════
  _initSpeed() {
    this._addHandler(this.speedPill, 'click', () => {
      this._speedIdx = (this._speedIdx + 1) % this._speeds.length;
      const rate = this._speeds[this._speedIdx];
      this._rate = rate;
      this.speedPill.textContent = (rate === 1 ? '1' : rate) + 'x';
      this._videoScreen?.engineSetRate(rate);
      this._callbacks.onRateChange?.(rate);
    });
  }

  setRate(rate) {
    this._rate = rate;
    const idx = this._speeds.indexOf(rate);
    if (idx >= 0) this._speedIdx = idx;
    this.speedPill.textContent = (rate === 1 ? '1' : rate) + 'x';
  }

  getRate() { return this._rate; }

  // ═══ Shuffle / Repeat ═══════════════════════════════════════════
  _initShuffleRepeat() {
    this._addHandler(this.shuffleBtn, 'click', () => {
      this._shuffle = !this._shuffle;
      this.shuffleBtn.classList.toggle('active', this._shuffle);
      this._callbacks.onShuffleChange?.(this._shuffle);
    });

    this._addHandler(this.repeatBtn, 'click', () => {
      const order = ['off', 'all', 'one'];
      const idx = order.indexOf(this._repeatMode);
      this._repeatMode = order[(idx + 1) % order.length];
      this.repeatBtn.classList.toggle('active', this._repeatMode !== 'off');
      this._updateRepeatIcon();
      this._callbacks.onRepeatChange?.(this._repeatMode);
    });
  }

  _updateRepeatIcon() {
    if (this._repeatMode === 'one') {
      // Repeat-1 icon (with "1" text)
      this.repeatBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="17 1 21 5 17 9"/>
          <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
          <polyline points="7 23 3 19 7 15"/>
          <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
          <text x="12" y="15" text-anchor="middle" font-size="8" font-weight="bold" fill="currentColor" stroke="none">1</text>
        </svg>`;
    } else {
      // Repeat icon
      this.repeatBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="17 1 21 5 17 9"/>
          <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
          <polyline points="7 23 3 19 7 15"/>
          <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
        </svg>`;
    }
  }

  isShuffle() { return this._shuffle; }
  getRepeatMode() { return this._repeatMode; }

  // ═══ Fullscreen ═════════════════════════════════════════════════
  _initFullscreen() {
    this._addHandler(this.fullscreenBtn, 'click', () => {
      this._videoScreen?.toggleFullscreen();
    });
  }

  // ═══ Action buttons (top-right) ═════════════════════════════════
  _initActions() {
    this._addHandler(this.actionAudio, 'click', () => this._callbacks.onShowTrackMenu?.('audio'));
    this._addHandler(this.actionSubtitle, 'click', () => this._callbacks.onShowTrackMenu?.('subtitles'));
    this._addHandler(this.actionChapter, 'click', () => this._callbacks.onShowTrackMenu?.('chapters'));
    this._addHandler(this.actionSettings, 'click', () => this._callbacks.onShowSettings?.());
  }

  // ═══ Keyboard shortcuts ═════════════════════════════════════════
  _initKeyboard() {
    this._addHandler(document, 'keydown', (e) => {
      // Only handle when video screen is active
      if (!this._videoScreen?.isVisible()) return;
      // Don't interfere with input fields
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          this._onPlayPause();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          this._videoScreen?.toggleFullscreen();
          break;
        case 'Escape':
          // Let the app handle Esc for fullscreen exit / back nav
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          this.setMuted(!this._muted);
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.setVolume(Math.min(1, this._volume + 0.05));
          break;
        case 'ArrowDown':
          e.preventDefault();
          this.setVolume(Math.max(0, this._volume - 0.05));
          break;
        case 'ArrowLeft':
          if (e.shiftKey) {
            e.preventDefault();
            this._callbacks.onPrev?.();
          } else {
            e.preventDefault();
            this._videoScreen?.engineSeek(Math.max(0, this._currentTime - 5));
          }
          break;
        case 'ArrowRight':
          if (e.shiftKey) {
            e.preventDefault();
            this._callbacks.onNext?.();
          } else {
            e.preventDefault();
            this._videoScreen?.engineSeek(Math.min(this._duration, this._currentTime + 5));
          }
          break;
      }
    });
  }

  // ═══ Helpers ════════════════════════════════════════════════════
  _formatTime(sec) {
    if (!sec || !isFinite(sec) || sec < 0) return '0:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) {
      return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }
    return m + ':' + String(s).padStart(2, '0');
  }

  _addHandler(el, ev, fn, opts) {
    el.addEventListener(ev, fn, opts);
    this._handlers.push({ el, ev, fn });
  }

  destroy() {
    for (const { el, ev, fn } of this._handlers) {
      try { el.removeEventListener(ev, fn); } catch (_) {}
    }
    this._handlers = [];
  }
}

module.exports = PlayerControls;
