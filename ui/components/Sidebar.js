/**
 * NovaPlay — Sidebar (NovaTune-style)
 *
 * Left navigation: search, browse nav, folders, playlists.
 * NovaTune aesthetic: floating card, 12px radius, active item with green
 * left-border indicator (::before), search input with green focus ring.
 */

class Sidebar {
  constructor() {
    this.container = document.getElementById('sidebar');
    this.searchInput = document.getElementById('search-input');
    this.searchClear = document.getElementById('search-clear');
    this.navItems = document.querySelectorAll('.nav-item');
    this.foldersContainer = document.getElementById('sidebar-folders');
    this.playlistsContainer = document.getElementById('sidebar-playlists');
    this.playlistsSection = document.getElementById('sidebar-playlists-section');
    this.addFolderBtn = document.getElementById('add-folder-btn');
    this.createPlaylistBtn = document.getElementById('create-playlist-btn');
    this.resizer = document.getElementById('sidebar-resizer');

    this._activeSection = 'library';
    this._folders = [];
    this._playlists = [];
    this._callbacks = {};
    this._handlers = [];
    this._searchDebounce = null;

    this._init();
  }

  init(callbacks = {}) {
    this._callbacks = callbacks;
  }

  _init() {
    this._initNavigation();
    this._initSearch();
    this._initResizer();
  }

  // ═══ Navigation ═════════════════════════════════════════════════
  _initNavigation() {
    for (const item of this.navItems) {
      this._addHandler(item, 'click', () => {
        const section = item.dataset.section;
        this.setActiveSection(section);
        this._callbacks.onNavigate?.(section);
      });
    }

    this._addHandler(this.addFolderBtn, 'click', () => {
      this._callbacks.onAddFolder?.();
    });

    this._addHandler(this.createPlaylistBtn, 'click', () => {
      this._callbacks.onCreatePlaylist?.();
    });
  }

  setActiveSection(section) {
    this._activeSection = section;
    for (const item of this.navItems) {
      item.classList.toggle('active', item.dataset.section === section);
    }
    // Show playlists list when in playlists section
    if (this.playlistsSection) {
      this.playlistsSection.style.display = (section === 'playlists') ? 'block' : 'none';
    }
  }

  // ═══ Search ═════════════════════════════════════════════════════
  _initSearch() {
    this._addHandler(this.searchInput, 'input', () => {
      const q = this.searchInput.value;
      this.searchClear.classList.toggle('visible', q.length > 0);

      // Debounce
      if (this._searchDebounce) clearTimeout(this._searchDebounce);
      this._searchDebounce = setTimeout(() => {
        this._callbacks.onSearch?.(q);
      }, 250);
    });

    this._addHandler(this.searchClear, 'click', () => {
      this.searchInput.value = '';
      this.searchClear.classList.remove('visible');
      this._callbacks.onSearch?.('');
    });

    // Keyboard shortcut: Ctrl/Cmd+F focuses search
    this._addHandler(document, 'keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        this.searchInput.focus();
        this.searchInput.select();
      }
    });
  }

  // ═══ Folders ════════════════════════════════════════════════════
  setFolders(folders) {
    this._folders = folders || [];
    this._renderFolders();
  }

  _renderFolders() {
    this.foldersContainer.innerHTML = '';
    for (const folder of this._folders) {
      const el = document.createElement('div');
      el.className = 'sidebar-folder-item';
      el.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span class="folder-name" title="${this._escape(folder)}">${this._escape(folder.split(/[\\/]/).pop() || folder)}</span>
        <button class="folder-remove" title="Remove">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="2" y1="2" x2="8" y2="8"/>
            <line x1="8" y1="2" x2="2" y2="8"/>
          </svg>
        </button>
      `;
      this._addHandler(el.querySelector('.folder-remove'), 'click', (e) => {
        e.stopPropagation();
        this._callbacks.onRemoveFolder?.(folder);
      });
      this._addHandler(el, 'click', () => {
        this._callbacks.onFolderClick?.(folder);
      });
      this.foldersContainer.appendChild(el);
    }
  }

  // ═══ Playlists ══════════════════════════════════════════════════
  setPlaylists(playlists) {
    this._playlists = playlists || [];
    this._renderPlaylists();
  }

  _renderPlaylists() {
    this.playlistsContainer.innerHTML = '';
    for (const pl of this._playlists) {
      const el = document.createElement('div');
      el.className = 'sidebar-folder-item';
      el.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">
          <path d="M3 5h18M3 12h18M3 19h12"/>
        </svg>
        <span class="folder-name" title="${this._escape(pl.name)}">${this._escape(pl.name)}</span>
        <button class="folder-remove" title="Delete">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="2" y1="2" x2="8" y2="8"/>
            <line x1="8" y1="2" x2="2" y2="8"/>
          </svg>
        </button>
      `;
      this._addHandler(el.querySelector('.folder-remove'), 'click', (e) => {
        e.stopPropagation();
        this._callbacks.onDeletePlaylist?.(pl.id);
      });
      this._addHandler(el, 'click', () => {
        this._callbacks.onPlaylistClick?.(pl.id);
      });
      this.playlistsContainer.appendChild(el);
    }
  }

  // ═══ Resizer ════════════════════════════════════════════════════
  _initResizer() {
    let startX = 0;
    let startW = 0;
    let dragging = false;

    this._addHandler(this.resizer, 'mousedown', (e) => {
      dragging = true;
      startX = e.clientX;
      startW = this.container.offsetWidth;
      this.resizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    this._addHandler(document, 'mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const newW = Math.max(200, Math.min(500, startW + dx));
      this.container.style.width = newW + 'px';
      document.documentElement.style.setProperty('--sidebar-w', newW + 'px');
    });

    this._addHandler(document, 'mouseup', () => {
      if (!dragging) return;
      dragging = false;
      this.resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      this._callbacks.onResize?.(this.container.offsetWidth);
    });
  }

  // ═══ Library count badge ════════════════════════════════════════
  setLibraryCount(n) {
    const badge = document.getElementById('library-count');
    if (badge) {
      badge.textContent = n > 0 ? String(n) : '';
    }
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

module.exports = Sidebar;
