/**
 * NovaPlay — Library View (video grid)
 *
 * Renders the main video grid using the VirtualList slot-pool pattern
 * from NovaTune. Includes a scan-progress overlay card.
 */

class LibraryView {
  constructor() {
    this.grid = document.getElementById('video-grid');
    this.empty = document.getElementById('empty-state');
    this.title = document.getElementById('content-title');
    this.subtitle = document.getElementById('content-subtitle');
    this._filterQuery = '';
    this._callbacks = {};
    this._progressOverlay = null;
    this._createProgressOverlay();

    // Init virtual list with the grid as both scroll container + content
    VirtualList.init(this.grid, this.grid);
    VirtualList.onItemClick((video) => this._callbacks.onVideoClick?.(video));

    // Listen for filter events from Sidebar
    window.addEventListener('novaplay:filter', (e) => {
      this._filterQuery = e.detail;
      this._applyFilter();
    });
  }

  init(callbacks) {
    this._callbacks = callbacks;
  }

  _createProgressOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'scan-progress-overlay';
    overlay.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: rgba(12, 12, 12, 0.96); backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.06); border-radius: 16px;
      padding: 24px; width: 320px; z-index: 500; display: none;
      box-shadow: 0 24px 60px rgba(0,0,0,0.6);
    `;
    overlay.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 14px;">
        <div class="spinner" style="width: 20px; height: 20px;"></div>
        <div style="flex: 1;">
          <div id="scan-title" style="font-size: 14px; font-weight: 600; color: var(--text-primary);">Scanning…</div>
          <div id="scan-detail" style="font-size: 12px; color: var(--text-muted); margin-top: 2px;"></div>
        </div>
      </div>
      <div style="height: 3px; background: rgba(255,255,255,0.06); border-radius: 999px; overflow: hidden;">
        <div id="scan-fill" style="height: 100%; width: 0%; background: var(--accent); transition: width 0.3s var(--ease); box-shadow: 0 0 6px var(--accent-glow);"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    this._progressOverlay = overlay;
  }

  updateScanProgress(data) {
    if (!this._progressOverlay) return;
    const title = this._progressOverlay.querySelector('#scan-title');
    const detail = this._progressOverlay.querySelector('#scan-detail');
    const fill = this._progressOverlay.querySelector('#scan-fill');

    switch (data.stage) {
      case 'scanning':
        this._progressOverlay.style.display = 'block';
        if (title) title.textContent = 'Scanning folder…';
        if (detail) detail.textContent = `Found ${data.count || 0} video files`;
        if (fill) fill.style.width = '0%';
        break;
      case 'reading':
        this._progressOverlay.style.display = 'block';
        if (title) title.textContent = 'Reading metadata…';
        if (detail) detail.textContent = `${data.current || 0} / ${data.total || 0} files`;
        if (fill) fill.style.width = (data.percent || 0) + '%';
        break;
      case 'complete':
        if (title) title.textContent = 'Scan complete';
        if (detail) detail.textContent = `Added ${data.added || 0} new videos`;
        if (fill) fill.style.width = '100%';
        setTimeout(() => { this._progressOverlay.style.display = 'none'; }, 1500);
        break;
      case 'error':
        if (title) title.textContent = 'Scan error';
        if (detail) detail.textContent = data.message || 'Unknown error';
        setTimeout(() => { this._progressOverlay.style.display = 'none'; }, 3000);
        break;
    }
  }

  render(state) {
    if (state.activeView === 'history') {
      this._renderHistory(state);
      return;
    }
    if (state.activeView === 'playlists') {
      this._renderPlaylists(state);
      return;
    }

    let titleText = 'Library';
    let videos = state.videos || [];

    if (state.activeView === 'folder' && state.activeFolder) {
      const folderName = state.activeFolder.split(/[\\/]/).pop() || state.activeFolder;
      titleText = folderName;
      const targetFolderNorm = state.activeFolder.replace(/\\/g, '/').toLowerCase();
      videos = videos.filter(v => {
        if (!v.filePath && !v.folder) return false;
        const vFolder = (v.folder || (v.filePath ? v.filePath.substring(0, v.filePath.lastIndexOf('/')) : '')).replace(/\\/g, '/').toLowerCase();
        return vFolder.startsWith(targetFolderNorm);
      });
    }

    this.title.textContent = titleText;
    if (this._filterQuery) {
      videos = videos.filter(v => (v.title || '').toLowerCase().includes(this._filterQuery));
    }

    if (videos.length === 0) {
      this.grid.style.display = 'none';
      this.empty.classList.remove('hidden');
      if (state.activeView === 'folder') {
        this.subtitle.textContent = this._filterQuery ? 'No videos match your search' : 'No videos found in this folder';
      } else {
        this.subtitle.textContent = state.videos?.length
          ? 'No videos match your search'
          : 'Click "Add folder" to scan for video files';
      }
      return;
    }

    this.grid.style.display = '';
    this.empty.classList.add('hidden');
    this.subtitle.textContent = `${videos.length} video${videos.length !== 1 ? 's' : ''}`;

    VirtualList.setItems(videos);
  }

  _renderHistory(state) {
    this.title.textContent = 'Watch History';
    this.grid.style.display = '';
    this.empty.classList.add('hidden');
    // History isn't a virtual list — just show recent videos
    // For simplicity, we re-use the videos list with last-played sorting
    const sorted = [...(state.videos || [])].filter(v => v.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed);
    if (sorted.length === 0) {
      this.grid.style.display = 'none';
      this.empty.classList.remove('hidden');
      this.subtitle.textContent = 'No watch history yet';
      return;
    }
    this.subtitle.textContent = `${sorted.length} recently watched`;
    VirtualList.setItems(sorted);
  }

  _renderPlaylists(state) {
    this.title.textContent = 'Playlists';
    const playlists = state.playlists || [];
    if (playlists.length === 0) {
      this.grid.style.display = 'none';
      this.empty.classList.remove('hidden');
      this.subtitle.textContent = 'No playlists yet';
      return;
    }
    this.grid.style.display = '';
    this.empty.classList.add('hidden');
    this.subtitle.textContent = `${playlists.length} playlist${playlists.length !== 1 ? 's' : ''}`;
    // Render playlist cards as a simple grid (not virtualised — small N)
    this.grid.style.height = '';
    this.grid.innerHTML = playlists.map(p => `
      <div class="video-card" style="cursor: pointer;" data-playlist-id="${Utils.escape(p.id)}">
        <div class="video-card-thumb-wrap" style="display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, var(--surface) 0%, #0a0a0a 100%);">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="var(--accent)" style="opacity: 0.6;">
            <path d="M3 10h11v2H3v-2zm0-4h11v2H3V6zm0 8h7v2H3v-2zm13 0v6l5-3-5-3z"/>
          </svg>
        </div>
        <div class="video-card-info">
          <div class="video-card-title">${Utils.escape(p.name)}</div>
          <div class="video-card-meta">
            <span>Playlist</span>
          </div>
        </div>
      </div>
    `).join('');
  }

  _applyFilter() {
    // Re-render with current filter
    if (window.state) this.render(window.state);
    else {
      // state not yet global — trigger render via render() function
      if (typeof render === 'function') render();
    }
  }
}

window.LibraryView = LibraryView;
