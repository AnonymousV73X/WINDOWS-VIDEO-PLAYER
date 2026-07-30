/**
 * NovaPlay v2 — Player Controls (full-player overlay)
 *
 * Manages:
 *   - The glowing progress bar with hover bubble showing timestamp
 *   - Play/pause, prev, next, volume, speed, shuffle, repeat, fullscreen
 *   - Auto-hide after inactivity (configurable via settings.controlsAutoHideMs)
 *   - Track / subtitle / chapter menu trigger
 *
 * v2 CHANGES:
 *   - Volume icons now use Material Design filled SVGs (like NovaTune)
 *     instead of stroke-based Lucide icons. This matches the NovaTune
 *     aesthetic where volume icons are filled while all other icons
 *     remain stroke-based.
 *   - Play/pause icons use simple filled polygon/rect SVGs (NovaTune style)
 */

class PlayerControls {
  constructor() {
    this.overlay = document.getElementById('player-controls-overlay');
    this.progressWrap = document.getElementById('progress-bar-wrap');
    this.progressFill = document.getElementById('progress-bar-fill');
    this.progressHandle = document.getElementById('progress-bar-handle');
    this.progressBubble = document.getElementById('progress-bubble');
    this.currentTime = document.getElementById('progress-time-current');
    this.totalTime = document.getElementById('progress-time-total');
    this.playBtn = document.getElementById('player-play-btn');
    this.playIcon = document.getElementById('play-icon');
    this.volumeBtn = document.getElementById('player-volume-btn');
    this.volumeIcon = document.getElementById('volume-icon');
    this.volumeWrap = document.getElementById('volume-bar-wrap');
    this.volumeFill = document.getElementById('volume-bar-fill');
    this.volumeHandle = document.getElementById('volume-bar-handle');
    this.speedBtn = document.getElementById('player-speed-btn');
    this.shuffleBtn = document.getElementById('player-shuffle-btn');
    this.repeatBtn = document.getElementById('player-repeat-btn');
    this.fullscreenBtn = document.getElementById('player-fullscreen-btn');
    this.settingsBtn = document.getElementById('player-settings-btn');
    this.audioTracksBtn = document.getElementById('player-audio-tracks-btn');
    this.subtitleBtn = document.getElementById('player-subtitle-tracks-btn');
    this.chaptersBtn = document.getElementById('player-chapters-btn');
    this.prevBtn = document.getElementById('player-prev-btn');
    this.nextBtn = document.getElementById('player-next-btn');

    this._timeSec = 0;
    this._durationSec = 0;
    this._isDraggingProgress = false;
    this._isDraggingVolume = false;
    this._isPlaying = false;
    this._autoHideTimer = null;
    this._callbacks = {};

    // Mouse activity detection
    this._lastMouseMove = Date.now();
  }

  init(callbacks) {
    this._callbacks = callbacks;
    this._bindEvents();
  }

  _bindEvents() {
    // Play/pause
    this.playBtn?.addEventListener('click', () => this._callbacks.onPlayPause?.());
    this.prevBtn?.addEventListener('click', () => this._callbacks.onPrev?.());
    this.nextBtn?.addEventListener('click', () => this._callbacks.onNext?.());

    // Progress bar drag + hover bubble
    if (this.progressWrap) {
      this.progressWrap.addEventListener('mousedown', (e) => this._onProgressDown(e));
      this.progressWrap.addEventListener('mousemove', (e) => this._onProgressHover(e));
      this.progressWrap.addEventListener('mouseleave', () => this._onProgressLeave());
    }

    // Volume drag
    if (this.volumeWrap) {
      this.volumeWrap.addEventListener('mousedown', (e) => this._onVolumeDown(e));
    }
    this.volumeBtn?.addEventListener('click', () => this._toggleMute());

    // Speed cycle
    this.speedBtn?.addEventListener('click', () => this._cycleSpeed());

    // Shuffle / repeat
    this.shuffleBtn?.addEventListener('click', () => {
      const enabled = !this.shuffleBtn.classList.contains('active');
      this.shuffleBtn.classList.toggle('active', enabled);
      this._callbacks.onShuffle?.(enabled);
    });
    this.repeatBtn?.addEventListener('click', () => {
      const modes = ['off', 'all', 'one'];
      const cur = this.repeatBtn.dataset.mode || 'off';
      const next = modes[(modes.indexOf(cur) + 1) % 3];
      this.repeatBtn.dataset.mode = next;
      this.repeatBtn.classList.toggle('active', next !== 'off');
      this._callbacks.onRepeat?.(next);
    });

    // Fullscreen / settings
    this.fullscreenBtn?.addEventListener('click', () => this._callbacks.onFullscreen?.());
    this.settingsBtn?.addEventListener('click', () => this._callbacks.onSettings?.());

    // Track menus
    this.audioTracksBtn?.addEventListener('click', async () => {
      const tracks = await window.novaAPI.engineGetTracks();
      this._callbacks.onTracksMenu?.('audio', tracks.audio || []);
    });
    this.subtitleBtn?.addEventListener('click', async () => {
      const tracks = await window.novaAPI.engineGetTracks();
      this._callbacks.onTracksMenu?.('subtitles', tracks.subtitles || []);
    });
    this.chaptersBtn?.addEventListener('click', async () => {
      const tracks = await window.novaAPI.engineGetTracks();
      const chapters = [];
      for (let i = 0; i < tracks.chapters; i++) chapters.push({ id: i, name: `Chapter ${i+1}`, selected: i === tracks.currentChapter });
      this._callbacks.onTracksMenu?.('chapters', chapters);
    });

    // Mouse activity → show controls
    const videoScreen = document.getElementById('video-screen');
    if (videoScreen) {
      videoScreen.addEventListener('mousemove', () => this._onActivity());
      videoScreen.addEventListener('click', () => this._onActivity());
    }
  }

  // ─── Auto-hide controls ──────────────────────────────────────────
  startAutoHide() {
    this._lastMouseMove = Date.now();
    this._showControls();
    this._scheduleHide();
  }

  stopAutoHide() {
    if (this._autoHideTimer) {
      clearTimeout(this._autoHideTimer);
      this._autoHideTimer = null;
    }
  }

  _onActivity() {
    this._lastMouseMove = Date.now();
    this._showControls();
    this._scheduleHide();
  }

  _scheduleHide() {
    if (this._autoHideTimer) clearTimeout(this._autoHideTimer);
    const hideMs = window.state?.settings?.controlsAutoHideMs || 2500;
    this._autoHideTimer = setTimeout(() => {
      if (this._isDraggingProgress || this._isDraggingVolume) {
        this._scheduleHide();
        return;
      }
      const trackMenu = document.getElementById('track-menu');
      if (trackMenu?.classList.contains('visible')) {
        this._scheduleHide();
        return;
      }
      this._hideControls();
    }, hideMs);
  }

  _showControls() {
    this.overlay?.classList.add('visible');
  }

  _hideControls() {
    this.overlay?.classList.remove('visible');
  }

  // ─── Time / state updates ────────────────────────────────────────
  updateTime(timeSec, durationSec) {
    this._timeSec = timeSec || 0;
    this._durationSec = durationSec || this._durationSec;
    if (this._isDraggingProgress) return;
    const pct = this._durationSec > 0 ? Math.min(100, (this._timeSec / this._durationSec) * 100) : 0;
    if (this.progressFill) this.progressFill.style.width = pct + '%';
    if (this.progressHandle) this.progressHandle.style.left = pct + '%';
    if (this.currentTime) this.currentTime.textContent = Utils.formatTime(this._timeSec);
    if (this.totalTime) this.totalTime.textContent = Utils.formatTime(this._durationSec);
  }

  updateState(stateName) {
    this._isPlaying = (stateName === 'playing');
    if (this.playIcon) {
      // NovaTune-style: simple filled polygon/rect SVGs for play/pause
      this.playIcon.innerHTML = this._isPlaying
        ? '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>'
        : '<polygon points="5,3 19,12 5,21" fill="currentColor"/>';
    }
  }

  setLoading(isLoading) {
    if (this.playBtn) {
      this.playBtn.style.opacity = isLoading ? '0.5' : '1';
    }
  }

  showError(message) {
    console.error('[player] engine error:', message);
  }

  // ─── Progress bar drag + hover ───────────────────────────────────
  _onProgressDown(e) {
    this._isDraggingProgress = true;
    this._seekFromEvent(e);
    const moveHandler = (ev) => { if (this._isDraggingProgress) this._seekFromEvent(ev); };
    const upHandler = () => {
      this._isDraggingProgress = false;
      document.removeEventListener('mousemove', moveHandler);
      document.removeEventListener('mouseup', upHandler);
    };
    document.addEventListener('mousemove', moveHandler);
    document.addEventListener('mouseup', upHandler);
  }

  _seekFromEvent(e) {
    if (!this.progressWrap || !this._durationSec) return;
    const rect = this.progressWrap.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const pct = x / rect.width;
    const time = pct * this._durationSec;
    this._callbacks.onSeek?.(time);
    this.updateTime(time, this._durationSec);
  }

  _onProgressHover(e) {
    if (!this.progressBubble || !this._durationSec) return;
    const rect = this.progressWrap.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const pct = x / rect.width;
    const time = pct * this._durationSec;
    this.progressBubble.textContent = Utils.formatTime(time);
    this.progressBubble.style.left = (x / rect.width * 100) + '%';
  }

  _onProgressLeave() {
    // Bubble hides via CSS
  }

  // ─── Volume drag ──────────────────────────────────────────────────
  _onVolumeDown(e) {
    this._isDraggingVolume = true;
    this._volumeFromEvent(e);
    const moveHandler = (ev) => { if (this._isDraggingVolume) this._volumeFromEvent(ev); };
    const upHandler = () => {
      this._isDraggingVolume = false;
      document.removeEventListener('mousemove', moveHandler);
      document.removeEventListener('mouseup', upHandler);
    };
    document.addEventListener('mousemove', moveHandler);
    document.addEventListener('mouseup', upHandler);
  }

  _volumeFromEvent(e) {
    if (!this.volumeWrap) return;
    const rect = this.volumeWrap.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const vol = x / rect.width;
    this._setVolumeUI(vol);
    this._callbacks.onVolume?.(vol);
  }

  _setVolumeUI(vol) {
    const pct = Math.round(vol * 100);
    if (this.volumeFill) this.volumeFill.style.width = pct + '%';
    if (this.volumeHandle) this.volumeHandle.style.left = pct + '%';
    this._updateVolumeIcon(vol);
  }

  /**
   * v2: Volume icons use Material Design filled SVGs (NovaTune style).
   * All other icons remain stroke-based (Lucide/Feather).
   * These filled volume SVGs match NovaTune's PlayerControls.js exactly.
   */
  _updateVolumeIcon(vol) {
    if (!this.volumeIcon) return;
    // Material Design filled volume icons — NovaTune pattern
    let icon;
    if (vol <= 0) {
      // Volume muted — filled SVG with X overlay
      icon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';
    } else if (vol < 0.5) {
      // Volume medium — filled SVG (speaker + one wave)
      icon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/></svg>';
    } else {
      // Volume high — filled SVG (speaker + two waves)
      icon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
    }
    this.volumeIcon.innerHTML = icon;
  }

  _toggleMute() {
    const current = parseFloat(this.volumeFill?.style.width || '80') / 100;
    const newVol = current > 0 ? 0 : (window.state?.settings?.volume || 0.8);
    this._setVolumeUI(newVol);
    this._callbacks.onVolume?.(newVol);
  }

  adjustVolume(delta) {
    const current = parseFloat(this.volumeFill?.style.width || '80') / 100;
    const newVol = Math.max(0, Math.min(1, current + delta));
    this._setVolumeUI(newVol);
    this._callbacks.onVolume?.(newVol);
  }

  // ─── Speed cycle ──────────────────────────────────────────────────
  _cycleSpeed() {
    const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4];
    const current = parseFloat(this.speedBtn?.textContent?.replace('×','')) || 1;
    const idx = speeds.indexOf(current);
    const next = speeds[(idx + 1) % speeds.length];
    this.speedBtn.textContent = next + '×';
    this._callbacks.onRate?.(next);
  }

  render(state) {
    // Apply saved volume
    const vol = state.settings?.volume ?? 0.8;
    this._setVolumeUI(vol);

    // Apply saved speed
    const rate = state.settings?.playbackRate ?? 1;
    if (this.speedBtn) this.speedBtn.textContent = rate + '×';

    // Shuffle/repeat from settings
    if (this.shuffleBtn) this.shuffleBtn.classList.toggle('active', !!state.settings?.shuffle);
    if (this.repeatBtn) {
      const mode = state.settings?.repeatMode || 'off';
      this.repeatBtn.dataset.mode = mode;
      this.repeatBtn.classList.toggle('active', mode !== 'off');
    }
  }
}

window.PlayerControls = PlayerControls;
