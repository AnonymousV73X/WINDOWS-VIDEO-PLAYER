/**
 * NovaPlay — NowPlayingBar (NovaTune-style mini player at bottom)
 *
 * Shows when a video is loaded and the user is browsing the library.
 * Compact: thumbnail + title + meta + transport + progress + expand button.
 * Clicking expand returns to the full video screen.
 */

class NowPlayingBar {
  constructor() {
    this.bar = document.getElementById('now-playing-bar');
    this.thumb = document.getElementById('np-thumb');
    this.title = document.getElementById('np-title');
    this.meta = document.getElementById('np-meta');
    this.playBtn = document.getElementById('np-play-btn');
    this.playIcon = document.getElementById('np-play-icon');
    this.prevBtn = document.getElementById('np-prev-btn');
    this.nextBtn = document.getElementById('np-next-btn');
    this.shuffleBtn = document.getElementById('np-shuffle-btn');
    this.repeatBtn = document.getElementById('np-repeat-btn');
    this.expandBtn = document.getElementById('np-expand-btn');
    this.timeCurrent = document.getElementById('np-time-current');
    this.timeTotal = document.getElementById('np-time-total');
    this.progressBar = document.getElementById('np-progress-bar');
    this.progressFill = document.getElementById('np-progress-fill');

    this._video = null;
    this._isPlaying = false;
    this._duration = 0;
    this._currentTime = 0;
    this._callbacks = {};
    this._handlers = [];

    this._init();
  }

  init(callbacks = {}) {
    this._callbacks = callbacks;
  }

  _init() {
    this._addHandler(this.playBtn, 'click', () => this._callbacks.onPlayPause?.());
    this._addHandler(this.prevBtn, 'click', () => this._callbacks.onPrev?.());
    this._addHandler(this.nextBtn, 'click', () => this._callbacks.onNext?.());
    this._addHandler(this.shuffleBtn, 'click', () => this._callbacks.onShuffle?.());
    this._addHandler(this.repeatBtn, 'click', () => this._callbacks.onRepeat?.());
    this._addHandler(this.expandBtn, 'click', () => this._callbacks.onExpand?.());
    this._addHandler(this.thumb, 'click', () => this._callbacks.onExpand?.());

    // Click progress bar to seek
    this._addHandler(this.progressBar, 'click', (e) => {
      const rect = this.progressBar.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      this._callbacks.onSeek?.(pct * this._duration);
    });
  }

  // ═══ Show / Hide ════════════════════════════════════════════════
  show(video) {
    this._video = video;
    this.bar.classList.remove('hidden');
    this.title.textContent = video.title || 'Untitled';
    this.meta.textContent = this._formatMeta(video);

    // Load thumbnail if available
    if (video.filePath) {
      this._loadThumb(video.filePath);
    }
  }

  hide() {
    this.bar.classList.add('hidden');
    this._video = null;
  }

  // ═══ State updates ══════════════════════════════════════════════
  setPlaying(playing) {
    this._isPlaying = !!playing;
    if (this._isPlaying) {
      this.playIcon.innerHTML = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;
    } else {
      this.playIcon.innerHTML = `<polygon points="5,3 19,12 5,21"/>`;
    }
  }

  setTime(time, duration) {
    this._currentTime = time;
    this._duration = duration || this._duration;
    const pct = this._duration > 0 ? (time / this._duration) * 100 : 0;
    this.progressFill.style.width = pct + '%';
    this.timeCurrent.textContent = this._formatTime(time);
    this.timeTotal.textContent = this._formatTime(this._duration);
  }

  setShuffle(on) {
    this.shuffleBtn.classList.toggle('active', !!on);
  }

  setRepeat(mode) {
    this.repeatBtn.classList.toggle('active', mode !== 'off');
    if (mode === 'one') {
      this.repeatBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="17 1 21 5 17 9"/>
          <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
          <polyline points="7 23 3 19 7 15"/>
          <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
          <text x="12" y="15" text-anchor="middle" font-size="8" font-weight="bold" fill="currentColor" stroke="none">1</text>
        </svg>`;
    } else {
      this.repeatBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="17 1 21 5 17 9"/>
          <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
          <polyline points="7 23 3 19 7 15"/>
          <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
        </svg>`;
    }
  }

  // ═══ Helpers ════════════════════════════════════════════════════
  _formatMeta(video) {
    const parts = [];
    if (video.codec) parts.push(video.codec.toUpperCase());
    if (video.width && video.height) parts.push(`${video.width}×${video.height}`);
    if (video.duration) parts.push(this._formatTime(video.duration));
    return parts.join(' • ') || '—';
  }

  _formatTime(sec) {
    if (!sec || !isFinite(sec) || sec < 0) return '0:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return m + ':' + String(s).padStart(2, '0');
  }

  async _loadThumb(filePath) {
    try {
      const r = await window.novaAPI.invoke('nova:thumbnail-gen', {
        filePath,
        videoId: 'np-' + Date.now()
      });
      if (r && r.ok && r.url) {
        this.thumb.innerHTML = `<img src="${r.url}" alt="">`;
      }
    } catch (_) {}
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

module.exports = NowPlayingBar;
