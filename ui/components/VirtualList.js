/**
 * NovaPlay v2 — Virtual List (slot-pool pattern, reused from NovaTune)
 *
 * v2 CHANGES:
 *   - Video card play button uses filled polygon SVG (NovaTune green circle style)
 *   - Duration badge is pill-shaped (border-radius: 20px)
 *   - Hover-lift effect on cards via CSS transform
 *   - Better blur-up thumbnail loading with crossfade
 */

const VirtualList = {
  items: [],
  container: null,
  scrollEl: null,
  raf: 0,
  lastStart: -1,
  lastEnd: -1,

  // Slot pool — recycled DOM nodes
  slotPool: [],
  activeSlots: new Map(),
  freeSlots: [],

  // Layout
  cardWidth: 200,
  cardHeight: 0,
  gap: 18,
  columns: 5,

  // Velocity-gated overscan
  VIRTUAL_ROW_BUFFER_BASE: 3,
  VIRTUAL_ROW_BUFFER: 3,
  _scrollVelocity: 0,
  _lastScrollTop: 0,
  _lastScrollTime: 0,
  _velocityIdleTimer: null,

  VELOCITY_THRESHOLD: 1200,

  // Hover prefetch
  _hoverPrefetchId: null,
  _thumbCache: new Map(),

  init(scrollEl, container) {
    this.scrollEl = scrollEl;
    this.container = container;
    this._onScroll = this._onScroll.bind(this);
    this._onResize = Utils.debounce(this._onResize.bind(this), 150);
    scrollEl.addEventListener('scroll', this._onScroll, { passive: true });
    window.addEventListener('resize', this._onResize);
    this._computeLayout();
  },

  destroy() {
    this.scrollEl?.removeEventListener('scroll', this._onScroll);
    window.removeEventListener('resize', this._onResize);
    this.resetPool();
  },

  resetPool() {
    this.activeSlots.clear();
    this.freeSlots.length = 0;
    this.slotPool.length = 0;
    this.lastStart = -1;
    this.lastEnd = -1;
  },

  setItems(items) {
    this.items = Array.isArray(items) ? items : [];
    this.resetPool();
    if (this.container) this.container.innerHTML = '';
    this._render();
  },

  _computeLayout() {
    if (!this.scrollEl) return;
    const width = this.scrollEl.clientWidth;
    const targetCardW = 200;
    this.columns = Math.max(2, Math.floor((width - 32) / (targetCardW + this.gap)));
    const padding = 40;
    this.cardWidth = Math.floor((width - padding - (this.columns - 1) * this.gap) / this.columns);
    this.cardHeight = Math.floor(this.cardWidth * (9 / 16)) + 56;
  },

  _onResize() {
    this._computeLayout();
    this.resetPool();
    if (this.container) this.container.innerHTML = '';
    this._render();
  },

  _onScroll() {
    const now = performance.now();
    const currentScrollTop = this.scrollEl.scrollTop;
    const dt = (now - this._lastScrollTime) / 1000;
    if (dt > 0 && this._lastScrollTime > 0) {
      const delta = Math.abs(currentScrollTop - this._lastScrollTop);
      this._scrollVelocity = delta / dt;
      if (this._scrollVelocity > this.VELOCITY_THRESHOLD) {
        this.VIRTUAL_ROW_BUFFER = this.VIRTUAL_ROW_BUFFER_BASE * 3;
      }
    }
    this._lastScrollTop = currentScrollTop;
    this._lastScrollTime = now;

    clearTimeout(this._velocityIdleTimer);
    this._velocityIdleTimer = setTimeout(() => {
      if (this.VIRTUAL_ROW_BUFFER !== this.VIRTUAL_ROW_BUFFER_BASE) {
        this.VIRTUAL_ROW_BUFFER = this.VIRTUAL_ROW_BUFFER_BASE;
        this._ensureSlotPool();
        this._renderVisible();
      }
      this._scrollVelocity = 0;
    }, 150);

    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.VIRTUAL_ROW_BUFFER !== this.VIRTUAL_ROW_BUFFER_BASE) {
        this._ensureSlotPool();
      }
      this._renderVisible();
    });
  },

  _render() {
    if (!this.container || !this.items.length) return;
    const totalRows = Math.ceil(this.items.length / this.columns);
    const totalHeight = totalRows * (this.cardHeight + this.gap) + this.gap;
    this.container.style.height = totalHeight + 'px';
    this.container.style.position = 'relative';

    this._ensureSlotPool();
    this._renderVisible();
  },

  _ensureSlotPool() {
    const visibleRows = Math.ceil((this.scrollEl.clientHeight || 600) / (this.cardHeight + this.gap));
    const needed = (visibleRows + this.VIRTUAL_ROW_BUFFER * 2) * this.columns + 8;
    while (this.slotPool.length < needed) {
      const slot = this._createSlot();
      this.slotPool.push(slot);
      this.freeSlots.push(slot);
    }
  },

  _createSlot() {
    const el = document.createElement('div');
    el.className = 'video-card';
    el.style.position = 'absolute';
    el.style.width = this.cardWidth + 'px';
    el.style.height = this.cardHeight + 'px';
    el.style.willChange = 'transform';
    el.style.display = 'none';
    el.innerHTML = `
      <div class="video-card-thumb-wrap">
        <img class="video-card-thumb-blurup" alt="">
        <img class="video-card-thumb" alt="">
        <div class="video-card-duration">0:00</div>
        <div class="video-card-play-overlay">
          <div class="video-card-play-button">
            <!-- v2: NovaTune-style filled polygon (green circle with black play icon) -->
            <svg viewBox="0 0 24 24" fill="#000"><polygon points="5,3 19,12 5,21"/></svg>
          </div>
        </div>
      </div>
      <div class="video-card-info">
        <div class="video-card-title"></div>
        <div class="video-card-meta">
          <span class="video-card-meta-resolution"></span>
          <div class="video-card-meta-dot"></div>
          <span class="video-card-meta-size"></span>
        </div>
      </div>
    `;
    return el;
  },

  _renderVisible() {
    const scrollTop = this.scrollEl.scrollTop;
    const rowH = this.cardHeight + this.gap;
    const startRow = Math.max(0, Math.floor(scrollTop / rowH) - this.VIRTUAL_ROW_BUFFER);
    const visibleRows = Math.ceil((this.scrollEl.clientHeight || 600) / rowH) + this.VIRTUAL_ROW_BUFFER * 2;
    const endRow = Math.min(Math.ceil(this.items.length / this.columns), startRow + visibleRows);

    const start = startRow * this.columns;
    const end = Math.min(this.items.length, endRow * this.columns);

    if (start === this.lastStart && end === this.lastEnd) return;
    this.lastStart = start;
    this.lastEnd = end;

    const newVisibleIds = new Set();
    for (let i = start; i < end; i++) {
      const v = this.items[i];
      if (v) newVisibleIds.add(v.id);
    }

    for (const [videoId, slot] of this.activeSlots) {
      if (!newVisibleIds.has(videoId)) {
        slot.style.display = 'none';
        slot._videoId = null;
        this.activeSlots.delete(videoId);
        this.freeSlots.push(slot);
      }
    }

    for (let i = start; i < end; i++) {
      const v = this.items[i];
      if (!v) continue;
      if (this.activeSlots.has(v.id)) continue;

      const slot = this.freeSlots.pop() || this._createSlot();
      this._populateSlot(slot, v, i);
      this.activeSlots.set(v.id, slot);
      const row = Math.floor(i / this.columns);
      const col = i % this.columns;
      slot.style.transform = `translate(${col * (this.cardWidth + this.gap) + 20}px, ${row * rowH + 20}px)`;
      slot.style.display = '';
      if (!slot.parentNode) this.container.appendChild(slot);
    }
  },

  _populateSlot(slot, video, index) {
    slot._videoId = video.id;

    const blurImg = slot.querySelector('.video-card-thumb-blurup');
    const mainImg = slot.querySelector('.video-card-thumb');
    const durationEl = slot.querySelector('.video-card-duration');
    const titleEl = slot.querySelector('.video-card-title');
    const resEl = slot.querySelector('.video-card-meta-resolution');
    const sizeEl = slot.querySelector('.video-card-meta-size');

    titleEl.textContent = video.title || 'Untitled';
    durationEl.textContent = Utils.formatTime(video.duration);
    resEl.textContent = Utils.formatResolution(video.width, video.height);
    sizeEl.textContent = Utils.formatBytes(video.size);

    blurImg.classList.remove('hidden');
    blurImg.src = '';
    mainImg.src = '';

    const thumbUrl = 'nova-video://thumb/' + Utils.encodeFilePath(video.filePath);
    mainImg.src = thumbUrl;
    mainImg.onload = () => {
      blurImg.classList.add('hidden');
    };
    mainImg.onerror = () => {
      this._generateThumbnail(video);
    };

    if (!slot._clickBound) {
      slot._clickBound = true;
      slot.addEventListener('click', (e) => {
        e.preventDefault();
        if (slot._videoId) {
          const v = this.items.find(x => x.id === slot._videoId);
          if (v) this._onItemClick(v);
        }
      });
    }
  },

  async _generateThumbnail(video) {
    try {
      const r = await window.novaAPI.invoke('nova:thumbnail-gen', { filePath: video.filePath, videoId: video.id });
      if (r?.ok) {
        const slot = this.activeSlots.get(video.id);
        if (slot) {
          const mainImg = slot.querySelector('.video-card-thumb');
          mainImg.src = r.url + '?t=' + Date.now();
          mainImg.onload = () => {
            slot.querySelector('.video-card-thumb-blurup').classList.add('hidden');
          };
        }
      }
    } catch (_) {}
  },

  onItemClick(fn) { this._onItemClick = fn; }
};

window.VirtualList = VirtualList;
