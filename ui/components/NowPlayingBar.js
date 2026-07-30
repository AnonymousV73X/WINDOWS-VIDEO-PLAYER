/**
 * NovaPlay v2 — Mini Now Playing Bar
 *
 * A small floating bar at the bottom of the library view that shows the
 * current video + EQ animation bars + play/pause + prev/next + expand button.
 * Mirrors NovaTune's now-playing bar pattern with EQ animation bars.
 *
 * v2 CHANGES:
 *   - Added EQ animation bars that animate when playing
 *   - Play/pause icons use filled polygon/rect SVGs (NovaTune style)
 *   - EQ bars controlled via .is-playing class on the #now-playing-eq element
 */

class NowPlayingBar {
  constructor() {
    this.bar = document.getElementById('now-playing-bar');
    this.thumb = document.getElementById('now-playing-thumb');
    this.title = document.getElementById('now-playing-title');
    this.meta = document.getElementById('now-playing-meta');
    this.progress = document.getElementById('now-playing-progress-fill');
    this.playBtn = document.getElementById('now-playing-play');
    this.prevBtn = document.getElementById('now-playing-prev');
    this.nextBtn = document.getElementById('now-playing-next');
    this.expandBtn = document.getElementById('now-playing-expand');
    this.eqBars = document.getElementById('now-playing-eq');
    this._isPlaying = false;
    this._callbacks = {};
  }

  init(callbacks) {
    this._callbacks = callbacks;
    this.playBtn?.addEventListener('click', () => this._callbacks.onPlayPause?.());
    this.prevBtn?.addEventListener('click', () => this._callbacks.onPrev?.());
    this.nextBtn?.addEventListener('click', () => this._callbacks.onNext?.());
    this.expandBtn?.addEventListener('click', () => this._callbacks.onExpand?.());
  }

  render(state) {
    if (!state.currentVideo) {
      this.bar?.classList.add('hidden');
      // Stop EQ animation when no video
      if (this.eqBars) this.eqBars.classList.remove('is-playing');
      return;
    }
    this.bar?.classList.remove('hidden');
    this.title.textContent = state.currentVideo.title || 'Untitled';
    const metaArr = [];
    if (state.currentVideo.duration) metaArr.push(Utils.formatTime(state.currentVideo.duration));
    if (state.currentVideo.codec) metaArr.push(state.currentVideo.codec.toUpperCase());
    if (state.currentVideo.width && state.currentVideo.height) {
      metaArr.push(Utils.formatResolution(state.currentVideo.width, state.currentVideo.height));
    }
    this.meta.textContent = metaArr.join('  •  ') || '—';

    // Thumbnail
    if (this.thumb) {
      const url = 'nova-video://thumb/' + Utils.encodeFilePath(state.currentVideo.filePath);
      if (this.thumb.src !== url) this.thumb.src = url;
    }

    // EQ animation state
    if (this.eqBars) {
      this.eqBars.classList.toggle('is-playing', this._isPlaying);
    }
  }

  updateTime(timeSec, durationSec) {
    if (this.progress && durationSec > 0) {
      this.progress.style.width = Math.min(100, (timeSec / durationSec) * 100) + '%';
    }
  }

  updateState(stateName) {
    this._isPlaying = (stateName === 'playing');
    
    // ── EQ animation bars: animate when playing ──
    if (this.eqBars) {
      this.eqBars.classList.toggle('is-playing', this._isPlaying);
    }
    
    // ── Play/pause icon: NovaTune-style filled SVGs ──
    if (this.playBtn) {
      const svg = this.playBtn.querySelector('svg');
      if (svg) {
        svg.innerHTML = this._isPlaying
          ? '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>'
          : '<polygon points="5,3 19,12 5,21" fill="currentColor"/>';
      }
    }
    
    // Thumb brightness state
    if (this.thumb) {
      this.thumb.classList.toggle('paused', !this._isPlaying);
    }
  }
}

window.NowPlayingBar = NowPlayingBar;
