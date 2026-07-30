/**
 * NovaPlay v2 — Track / Subtitle / Chapter Menu
 *
 * A popover that shows available audio tracks, subtitle tracks, or
 * chapters for the current video. Triggered from the player controls
 * top-right buttons.
 *
 * v2 CHANGES:
 *   - NovaTune-style glass morphism backdrop with better blur
 *   - Better check indicators with green color + glow
 *   - Improved item hover effects
 */

class TrackMenu {
  constructor() {
    this.menu = document.getElementById('track-menu');
    this._callbacks = {};
    this._currentKind = null;
  }

  init(callbacks) {
    this._callbacks = callbacks;

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (!this.menu?.classList.contains('visible')) return;
      if (this.menu.contains(e.target)) return;
      const isTrigger = e.target.closest('#player-audio-tracks-btn, #player-subtitle-tracks-btn, #player-chapters-btn');
      if (!isTrigger) this.hide();
    });
  }

  async show(kind, tracks) {
    if (!kind) return;
    this._currentKind = kind;

    // If no tracks passed, fetch them
    if (!tracks) {
      const t = await window.novaAPI.engineGetTracks();
      if (kind === 'audio') tracks = t.audio || [];
      else if (kind === 'subtitles') tracks = t.subtitles || [];
      else if (kind === 'chapters') {
        tracks = [];
        for (let i = 0; i < t.chapters; i++) {
          tracks.push({ id: i, name: `Chapter ${i + 1}`, selected: i === t.currentChapter });
        }
      }
    }

    const titles = { audio: 'Audio tracks', subtitles: 'Subtitles', chapters: 'Chapters' };

    // Add a "disable" option for subtitles
    let items = tracks;
    if (kind === 'subtitles') {
      items = [{ id: -1, name: 'Off', selected: tracks.every(t => !t.selected) }, ...tracks];
    }

    this.menu.innerHTML = `
      <div class="track-menu-title">${titles[kind] || 'Tracks'}</div>
      ${items.map(t => `
        <div class="track-menu-item ${t.selected ? 'active' : ''}" data-id="${t.id}">
          <!-- NovaTune-style check indicator with green accent + glow -->
          <svg class="track-menu-item-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span>${Utils.escape(t.name)}</span>
        </div>
      `).join('')}
    `;

    // Position near top-right of player
    const screen = document.getElementById('video-screen');
    const screenRect = screen?.getBoundingClientRect();
    if (screenRect) {
      this.menu.style.bottom = '100px';
      this.menu.style.right = '24px';
      this.menu.style.top = 'auto';
      this.menu.style.left = 'auto';
    }

    this.menu.classList.add('visible');

    // Bind item clicks
    this.menu.querySelectorAll('.track-menu-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = parseInt(el.dataset.id, 10);
        if (kind === 'audio') this._callbacks.onAudioTrack?.(id);
        else if (kind === 'subtitles') this._callbacks.onSubtitleTrack?.(id);
        else if (kind === 'chapters') this._callbacks.onChapter?.(id);
        this.hide();
      });
    });
  }

  hide() {
    this.menu?.classList.remove('visible');
    this._currentKind = null;
  }
}

window.TrackMenu = TrackMenu;
