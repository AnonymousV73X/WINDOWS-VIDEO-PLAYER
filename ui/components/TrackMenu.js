/**
 * NovaPlay — TrackMenu (audio/subtitle/chapter selector)
 *
 * Glassmorphic popover (NovaTune-style) for selecting audio tracks,
 * subtitle tracks, and chapters. Sections shown based on availability.
 *
 * Anchored to the bottom-right of the video screen (above the controls bar).
 */

class TrackMenu {
  constructor() {
    this.container = document.getElementById('track-menu');
    this._visible = false;
    this._currentType = null;
    this._tracks = { audio: [], subtitles: [], chapters: 0, currentChapter: 0 };
    this._callbacks = {};
    this._handlers = [];

    this._initOutsideClick();
  }

  init(callbacks = {}) {
    this._callbacks = callbacks;
  }

  // ═══ Show / Hide ════════════════════════════════════════════════
  async show(type) {
    // If clicking the same type that's open, toggle closed
    if (this._visible && this._currentType === type) {
      this.hide();
      return;
    }

    this._currentType = type;
    this._visible = true;
    this.container.classList.add('visible');

    // Refresh tracks from engine
    await this._refreshTracks();
    this._render();
  }

  hide() {
    this._visible = false;
    this._currentType = null;
    this.container.classList.remove('visible');
    this.container.innerHTML = '';
  }

  isVisible() { return this._visible; }

  // ═══ Track fetching ═════════════════════════════════════════════
  async _refreshTracks() {
    try {
      this._tracks = await window.novaAPI.invoke('nova:engine-tracks');
      if (!this._tracks) {
        this._tracks = { audio: [], subtitles: [], chapters: 0, currentChapter: 0 };
      }
    } catch (err) {
      console.warn('[track-menu] failed to fetch tracks:', err);
      this._tracks = { audio: [], subtitles: [], chapters: 0, currentChapter: 0 };
    }
  }

  // ═══ Render ═════════════════════════════════════════════════════
  _render() {
    this.container.innerHTML = '';

    if (this._currentType === 'audio') {
      this._renderAudio();
    } else if (this._currentType === 'subtitles') {
      this._renderSubtitles();
    } else if (this._currentType === 'chapters') {
      this._renderChapters();
    }
  }

  _renderAudio() {
    const header = document.createElement('div');
    header.className = 'track-menu-header';
    header.textContent = 'Audio Tracks';
    this.container.appendChild(header);

    if (this._tracks.audio.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'track-menu-item';
      empty.innerHTML = '<span class="item-name">No audio tracks</span>';
      this.container.appendChild(empty);
      return;
    }

    for (const track of this._tracks.audio) {
      const item = document.createElement('div');
      item.className = 'track-menu-item' + (track.selected ? ' selected' : '');
      item.innerHTML = `
        <span class="item-name">${this._escape(track.name || 'Track ' + track.id)}</span>
        <svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      `;
      this._addHandler(item, 'click', async () => {
        await window.novaAPI.invoke('nova:engine-audio-track', track.id);
        this.hide();
      });
      this.container.appendChild(item);
    }
  }

  _renderSubtitles() {
    const header = document.createElement('div');
    header.className = 'track-menu-header';
    header.textContent = 'Subtitles';
    this.container.appendChild(header);

    // "Off" option
    const offItem = document.createElement('div');
    const offSelected = this._tracks.subtitles.length === 0 ||
      this._tracks.subtitles.every(t => !t.selected);
    offItem.className = 'track-menu-item' + (offSelected ? ' selected' : '');
    offItem.innerHTML = `
      <span class="item-name">Off</span>
      <svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    `;
    this._addHandler(offItem, 'click', async () => {
      // libVLC uses -1 for "no subtitles"
      await window.novaAPI.invoke('nova:engine-subtitle-track', -1);
      this.hide();
    });
    this.container.appendChild(offItem);

    if (this._tracks.subtitles.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'track-menu-item';
      empty.innerHTML = '<span class="item-name" style="color:var(--text-muted)">No subtitle tracks</span>';
      this.container.appendChild(empty);
      return;
    }

    for (const track of this._tracks.subtitles) {
      const item = document.createElement('div');
      item.className = 'track-menu-item' + (track.selected ? ' selected' : '');
      item.innerHTML = `
        <span class="item-name">${this._escape(track.name || 'Subtitle ' + track.id)}</span>
        <svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      `;
      this._addHandler(item, 'click', async () => {
        await window.novaAPI.invoke('nova:engine-subtitle-track', track.id);
        this.hide();
      });
      this.container.appendChild(item);
    }
  }

  _renderChapters() {
    const header = document.createElement('div');
    header.className = 'track-menu-header';
    header.textContent = 'Chapters';
    this.container.appendChild(header);

    const count = this._tracks.chapters || 0;
    const current = this._tracks.currentChapter || 0;

    if (count === 0) {
      const empty = document.createElement('div');
      empty.className = 'track-menu-item';
      empty.innerHTML = '<span class="item-name" style="color:var(--text-muted)">No chapters</span>';
      this.container.appendChild(empty);
      return;
    }

    for (let i = 0; i < count; i++) {
      const item = document.createElement('div');
      item.className = 'track-menu-item' + (i === current ? ' selected' : '');
      item.innerHTML = `
        <span class="item-name">Chapter ${i + 1}</span>
        <span class="item-info">${i + 1}/${count}</span>
        <svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      `;
      this._addHandler(item, 'click', async () => {
        await window.novaAPI.invoke('nova:engine-chapter', i);
        this.hide();
      });
      this.container.appendChild(item);
    }
  }

  // ═══ Outside-click to close ═════════════════════════════════════
  _initOutsideClick() {
    this._addHandler(document, 'click', (e) => {
      if (!this._visible) return;
      // If the click was outside the track menu AND outside the action buttons that open it
      if (!this.container.contains(e.target) &&
          !e.target.closest('#action-audio-tracks, #action-subtitle-tracks, #action-chapters')) {
        this.hide();
      }
    });

    this._addHandler(document, 'keydown', (e) => {
      if (e.key === 'Escape' && this._visible) {
        this.hide();
      }
    });
  }

  // ═══ Helpers ════════════════════════════════════════════════════
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
  }
}

module.exports = TrackMenu;
