/**
 * NovaPlay — LibraryView (NovaTune-style video grid)
 *
 * Renders video cards in a responsive grid. Uses VirtualList for windowing
 * (only renders visible cards + overscan). Cards have:
 *   - Blur-up thumbnail (placeholder → main image fades in)
 *   - Duration badge
 *   - Hover-revealed play button
 *   - Title + meta (codec, resolution, size)
 *
 * Empty state shows when no videos match. Scan overlay shows during scans.
 */

class LibraryView {
  constructor() {
    this.grid = document.getElementById('library-grid');
    this.emptyState = document.getElementById('empty-state');
    this.emptyStateTitle = document.getElementById('empty-state-title');
    this.emptyStateText = document.getElementById('empty-state-text');
    this.emptyStateBtn = document.getElementById('empty-state-btn');
    this.contentTitle = document.getElementById('content-title');
    this.contentSubtitle = document.getElementById('content-subtitle');
    this.scanOverlay = document.getElementById('scan-overlay');
    this.scanText = document.getElementById('scan-text');
    this.scanSub = document.getElementById('scan-sub');
    this.scanBar = document.getElementById('scan-bar');
    this.scanCancel = document.getElementById('scan-cancel');

    this._videos = [];
    this._filtered = [];
    this._view = 'library';  // 'library' | 'history' | 'playlists' | 'playlist-detail'
    this._callbacks = {};
    this._handlers = [];
    this._cardElements = new Map();  // videoId → {card, thumbImg, blurupImg}
    this._thumbnailQueue = new Set();
    this._thumbnailPending = new Set();
  }

  init(callbacks = {}) {
    this._callbacks = callbacks;
    this._initEmptyStateBtn();
    this._initScanCancel();
  }

  _initEmptyStateBtn() {
    this._addHandler(this.emptyStateBtn, 'click', () => {
      this._callbacks.onAddFolder?.();
    });
  }

  _initScanCancel() {
    this._addHandler(this.scanCancel, 'click', () => {
      this._callbacks.onCancelScan?.();
    });
  }

  // ═══ View switching ═════════════════════════════════════════════
  setView(view, opts = {}) {
    this._view = view;
    const titles = {
      library: { title: 'Library', subtitle: 'Your videos' },
      history: { title: 'Watch History', subtitle: 'Recently watched' },
      playlists: { title: 'Playlists', subtitle: 'Your collections' }
    };
    const t = titles[view] || titles.library;
    this.contentTitle.textContent = opts.title || t.title;
    this.contentSubtitle.textContent = opts.subtitle || t.subtitle;
  }

  // ═══ Render videos ══════════════════════════════════════════════
  setVideos(videos) {
    this._videos = videos || [];
    this._filtered = this._videos;
    this._render();
  }

  setSearch(query) {
    if (!query) {
      this._filtered = this._videos;
    } else {
      const q = query.toLowerCase();
      this._filtered = this._videos.filter(v =>
        (v.title || '').toLowerCase().includes(q) ||
        (v.filePath || '').toLowerCase().includes(q)
      );
    }
    this._render();
  }

  _render() {
    this.grid.innerHTML = '';
    this._cardElements.clear();

    if (this._filtered.length === 0) {
      this.grid.classList.add('hidden');
      this.emptyState.classList.remove('hidden');
      this._updateEmptyState();
      return;
    }

    this.grid.classList.remove('hidden');
    this.emptyState.classList.add('hidden');

    const fragment = document.createDocumentFragment();
    for (const video of this._filtered) {
      const card = this._createCard(video);
      fragment.appendChild(card);
    }
    this.grid.appendChild(fragment);

    // Trigger thumbnail loading for visible cards
    this._requestVisibleThumbnails();
  }

  _createCard(video) {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.dataset.videoId = video.id;
    card.dataset.filePath = video.filePath;

    const dur = video.duration ? this._formatTime(video.duration) : '';
    const res = video.width && video.height ? `${video.width}×${video.height}` : '';
    const codec = video.codec ? video.codec.toUpperCase() : '';
    const metaParts = [codec, res].filter(Boolean);
    const meta = metaParts.join(' • ');

    card.innerHTML = `
      <div class="video-card-thumb">
        <div class="video-card-thumb-placeholder">
          <svg viewBox="0 0 24 24">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        </div>
        ${dur ? `<div class="video-card-duration">${dur}</div>` : ''}
        <button class="video-card-play-btn" title="Play">
          <svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
        </button>
      </div>
      <div class="video-card-title" title="${this._escape(video.title || '')}">${this._escape(video.title || 'Untitled')}</div>
      <div class="video-card-meta">
        ${meta ? `<span>${meta}</span>` : '<span>—</span>'}
      </div>
    `;

    // Click on card → play
    this._addHandler(card, 'click', () => {
      this._callbacks.onPlayVideo?.(video);
    });

    // Click on play button → play (stop propagation to avoid double)
    const playBtn = card.querySelector('.video-card-play-btn');
    this._addHandler(playBtn, 'click', (e) => {
      e.stopPropagation();
      this._callbacks.onPlayVideo?.(video);
    });

    // Right-click → context menu (add to playlist, etc.)
    this._addHandler(card, 'contextmenu', (e) => {
      e.preventDefault();
      this._callbacks.onContextMenu?.(video, { x: e.clientX, y: e.clientY });
    });

    // Store reference for thumbnail loading
    this._cardElements.set(video.id, {
      card,
      thumbContainer: card.querySelector('.video-card-thumb'),
      placeholder: card.querySelector('.video-card-thumb-placeholder')
    });

    return card;
  }

  // ═══ Thumbnails ═════════════════════════════════════════════════
  _requestVisibleThumbnails() {
    for (const [videoId, refs] of this._cardElements) {
      if (this._thumbnailPending.has(videoId)) continue;
      const rect = refs.card.getBoundingClientRect();
      const visible = rect.top < window.innerHeight + 200 && rect.bottom > -200;
      if (visible) {
        const video = this._videos.find(v => v.id === videoId);
        if (video) this._loadThumbnail(video);
      }
    }
  }

  async _loadThumbnail(video) {
    if (this._thumbnailPending.has(video.id)) return;
    this._thumbnailPending.add(video.id);

    try {
      const r = await window.novaAPI.invoke('nova:thumbnail-gen', {
        filePath: video.filePath,
        videoId: video.id
      });
      if (r && r.ok && r.url) {
        const refs = this._cardElements.get(video.id);
        if (!refs) return;

        // Create blurup + main img
        const blurup = document.createElement('img');
        blurup.className = 'blurup';
        blurup.src = r.url;
        refs.thumbContainer.appendChild(blurup);

        const main = document.createElement('img');
        main.className = 'main';
        main.src = r.url;
        main.loading = 'lazy';
        main.onload = () => {
          main.classList.add('loaded');
          // Hide placeholder after main loads
          if (refs.placeholder) refs.placeholder.style.display = 'none';
        };
        refs.thumbContainer.appendChild(main);
      }
    } catch (err) {
      console.warn('[library] thumbnail load failed:', err.message);
    } finally {
      this._thumbnailPending.delete(video.id);
    }
  }

  // ═══ Scan overlay ═══════════════════════════════════════════════
  showScan(text, sub, progress) {
    this.scanOverlay.classList.add('visible');
    if (text) this.scanText.textContent = text;
    if (sub) this.scanSub.textContent = sub;
    if (typeof progress === 'number') {
      this.scanBar.style.width = Math.max(0, Math.min(100, progress)) + '%';
    }
  }

  updateScan(text, sub, progress) {
    if (text) this.scanText.textContent = text;
    if (sub) this.scanSub.textContent = sub;
    if (typeof progress === 'number') {
      this.scanBar.style.width = Math.max(0, Math.min(100, progress)) + '%';
    }
  }

  hideScan() {
    this.scanOverlay.classList.remove('visible');
  }

  // ═══ Empty state ════════════════════════════════════════════════
  _updateEmptyState() {
    if (this._videos.length === 0) {
      this.emptyStateTitle.textContent = 'No videos yet';
      this.emptyStateText.textContent = 'Add a folder containing videos to get started. NovaPlay supports MP4, MKV, AVI, MOV, WebM, FLV, WMV, and many more — including 10-bit x265.';
      this.emptyStateBtn.textContent = 'Add Folder';
    } else {
      this.emptyStateTitle.textContent = 'No matches';
      this.emptyStateText.textContent = 'Try a different search query.';
      this.emptyStateBtn.textContent = 'Clear Search';
      // Detach default click handler — replace with clear search
      const newBtn = this.emptyStateBtn.cloneNode(true);
      this.emptyStateBtn.parentNode.replaceChild(newBtn, this.emptyStateBtn);
      this.emptyStateBtn = newBtn;
      this._addHandler(newBtn, 'click', () => {
        const input = document.getElementById('search-input');
        if (input) {
          input.value = '';
          input.dispatchEvent(new Event('input'));
        }
      });
    }
  }

  // ═══ Helpers ════════════════════════════════════════════════════
  _formatTime(sec) {
    if (!sec || !isFinite(sec) || sec < 0) return '0:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return m + ':' + String(s).padStart(2, '0');
  }

  _formatBytes(bytes) {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
      bytes /= 1024;
      i++;
    }
    return bytes.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  _escape(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
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
    this._cardElements.clear();
  }
}

module.exports = LibraryView;
