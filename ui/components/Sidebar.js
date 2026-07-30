/**
 * NovaPlay v2 — Sidebar Component
 *
 * Renders the left navigation rail: search box, library/folders section,
 * playlists section, and "Add folder" button. Mirrors NovaTune's
 * Sidebar.js layout, adapted for video library.
 *
 * v2 CHANGE: Removed inline `style="border-left: 3px solid var(--accent);"` 
 * from active nav items. The green left-border indicator is now handled
 * entirely by CSS ::before pseudo-element on `.sidebar-nav-item.active` 
 * and `.sidebar-folder-item.active` — cleaner and more maintainable.
 */

class Sidebar {
  constructor() {
    this.el = document.getElementById('sidebar');
    this._callbacks = {};
  }

  init(callbacks) {
    this._callbacks = callbacks;
    this._bindEvents();
  }

  _bindEvents() {
    // Delegated click handler — single listener for all nav items
    this.el.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.sidebar-folder-remove');
      if (removeBtn) {
        e.stopPropagation();
        const folder = removeBtn.dataset.folder;
        if (folder) this._callbacks.onRemoveFolder?.(folder);
        return;
      }
      const navItem = e.target.closest('.sidebar-nav-item');
      if (navItem?.dataset.section) {
        this._callbacks.onNavClick?.(navItem.dataset.section);
        return;
      }
      const folderItem = e.target.closest('.sidebar-folder-item');
      if (folderItem) {
        const folder = folderItem.dataset.folder;
        if (folder) {
          this._callbacks.onFolderClick?.(folder);
          return;
        }
        const playlist = folderItem.dataset.playlist;
        if (playlist) {
          this._callbacks.onNavClick?.('playlists');
          return;
        }
      }
      const addBtn = e.target.closest('.sidebar-add-folder');
      if (addBtn) {
        this._callbacks.onAddFolder?.();
        return;
      }
    });

    // Search input — debounced filter
    const searchInput = this.el.querySelector('#sidebar-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', Utils.debounce((e) => {
        const q = e.target.value.toLowerCase().trim();
        window.dispatchEvent(new CustomEvent('novaplay:filter', { detail: q }));
      }, 150));
    }
  }

  render(state) {
    if (!this.el) return;
    const folders = state.settings?.scanFolders || [];
    const playlists = state.playlists || [];

    this.el.innerHTML = `
      <div class="sidebar-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="sidebar-search-input" placeholder="Search videos" autocomplete="off" spellcheck="false">
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-title">Browse</div>
        <!-- v2: NO inline style on active items — CSS ::before handles the green left border -->
        <div class="sidebar-nav-item ${state.activeView === 'library' ? 'active' : ''}" data-section="library">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>
          <span>Library</span>
        </div>
        <div class="sidebar-nav-item ${state.activeView === 'history' ? 'active' : ''}" data-section="history">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>Watch History</span>
        </div>
        <div class="sidebar-nav-item ${state.activeView === 'playlists' ? 'active' : ''}" data-section="playlists">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/><circle cx="18" cy="18" r="3"/><path d="M21 18v5"/></svg>
          <span>Playlists</span>
        </div>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-title">Folders</div>
        ${folders.length === 0
          ? '<div style="padding: 8px 12px; font-size: 12px; color: var(--text-muted);">No folders added yet</div>'
          : folders.map(f => `
            <!-- v2: NO inline style on active — CSS ::before handles green border -->
            <div class="sidebar-folder-item ${state.activeView === 'folder' && state.activeFolder === f ? 'active' : ''}" data-folder="${Utils.escape(f)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              <span class="sidebar-folder-name" title="${Utils.escape(f)}">${Utils.escape(f.split(/[\\/]/).pop())}</span>
              <button class="sidebar-folder-remove" data-folder="${Utils.escape(f)}" title="Remove folder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          `).join('')
        }
        <button class="sidebar-add-folder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>Add folder</span>
        </button>
      </div>

      ${playlists.length > 0 ? `
        <div class="sidebar-section">
          <div class="sidebar-section-title">Playlists</div>
          ${playlists.map(p => `
            <div class="sidebar-folder-item" data-playlist="${Utils.escape(p.id)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/><circle cx="18" cy="18" r="3"/><path d="M21 18v5"/></svg>
              <span class="sidebar-folder-name" title="${Utils.escape(p.name)}">${Utils.escape(p.name)}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
      <div class="sidebar-resizer" id="sidebar-resizer"></div>
    `;
    this._bindResizer();
  }

  _bindResizer() {
    const resizer = this.el.querySelector('#sidebar-resizer');
    if (!resizer || resizer.dataset.bound) return;
    resizer.dataset.bound = 'true';

    let startX = 0;
    let startWidth = 0;

    const onMouseMove = (e) => {
      const deltaX = e.clientX - startX;
      let newWidth = Math.max(200, Math.min(500, startWidth + deltaX));
      document.documentElement.style.setProperty('--sidebar-w', newWidth + 'px');
    };

    const onMouseUp = () => {
      resizer.classList.remove('resizing');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = this.el.offsetWidth;
      resizer.classList.add('resizing');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }
}

window.Sidebar = Sidebar;
