/**
 * NovaPlay v2 — Settings Panel
 *
 * Modal overlay matching NovaTune's settings UI patterns. Sections:
 *   - Appearance (theme, accent color, background mode)
 *   - Playback (default volume, hw accel, resume on open)
 *   - Library (scan folders, auto-rescan, sort order)
 *   - Engine (libVLC engine status)
 *   - About (always on top, reduced motion)
 *
 * v2 CHANGES:
 *   - NovaTune-style dark glass panels with better backdrop blur
 *   - Color swatches with glow effect when active
 *   - Modern toggle switches with green accent
 *   - Better select/input styling with green focus rings
 */

class SettingsPanel {
  constructor() {
    this.overlay = document.getElementById('settings-overlay');
    this.panel = document.getElementById('settings-panel');
    this._callbacks = {};
  }

  init(callbacks) {
    this._callbacks = callbacks;
    this.overlay?.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
  }

  show(settings) {
    this._settings = settings;
    this._render();
    this.overlay?.classList.add('visible');
  }

  hide() {
    this.overlay?.classList.remove('visible');
  }

  async _render() {
    const s = this._settings;
    const engineAvailable = await window.novaAPI.engineIsAvailable();
    // NovaTune accent presets — same color palette
    const accentPresets = ['#1ed760', '#3b82f6', '#a855f7', '#ec4899', '#f97316', '#ef4444', '#06b6d4'];

    this.panel.innerHTML = `
      <div class="settings-header">
        <div class="settings-title">Settings</div>
        <button class="settings-close" id="settings-close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Appearance</div>
        <div class="settings-row">
          <div class="settings-row-label">Accent color</div>
          <div class="settings-row-control">
            <!-- NovaTune-style color swatches with glow -->
            <div class="settings-color-swatch-row" id="accent-row">
              ${accentPresets.map(c => `
                <div class="settings-color-swatch ${s.accentColor === c ? 'active' : ''}"
                  style="background:${c}; box-shadow: 0 0 12px ${c}55;"
                  data-color="${c}"></div>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">Background</div>
          <div class="settings-row-control">
            <select class="settings-select" id="bg-mode">
              <option value="amoled" ${s.backgroundMode === 'amoled' ? 'selected' : ''}>Pure black (AMOLED)</option>
              <option value="dim" ${s.backgroundMode === 'dim' ? 'selected' : ''}>Dim (#0a0a0a)</option>
            </select>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">Font family</div>
          <div class="settings-row-control">
            <select class="settings-select" id="settings-font">
              <option value="Outfit" ${s.activeFont === 'Outfit' ? 'selected' : ''}>Outfit</option>
              <option value="Figtree" ${s.activeFont === 'Figtree' ? 'selected' : ''}>Figtree</option>
            </select>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Playback</div>
        <div class="settings-row">
          <div class="settings-row-label">Default volume</div>
          <div class="settings-row-control">
            <input type="range" min="0" max="100" value="${Math.round((s.volume || 0.8) * 100)}" id="default-vol" style="accent-color: var(--accent);">
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">Hardware acceleration</div>
          <div class="settings-row-control">
            <!-- NovaTune-style toggle switch -->
            <div class="settings-toggle ${s.hwAccel ? 'on' : ''}" id="hw-accel-toggle"></div>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">Resume from last position</div>
          <div class="settings-row-control">
            <div class="settings-toggle ${s.resumeOnOpen ? 'on' : ''}" id="resume-toggle"></div>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">Controls auto-hide (ms)</div>
          <div class="settings-row-control">
            <input type="number" min="500" max="10000" step="100" value="${s.controlsAutoHideMs || 2500}" id="auto-hide-ms" class="settings-input" style="min-width:80px;">
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Library</div>
        <div class="settings-row">
          <div class="settings-row-label">Auto-rescan folders on launch</div>
          <div class="settings-row-control">
            <div class="settings-toggle ${s.autoRescan ? 'on' : ''}" id="auto-rescan-toggle"></div>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">Sort by</div>
          <div class="settings-row-control">
            <select class="settings-select" id="sort-order">
              <option value="dateAdded" ${s.sortOrder === 'dateAdded' ? 'selected' : ''}>Date added</option>
              <option value="title" ${s.sortOrder === 'title' ? 'selected' : ''}>Title</option>
              <option value="duration" ${s.sortOrder === 'duration' ? 'selected' : ''}>Duration</option>
              <option value="lastPlayed" ${s.sortOrder === 'lastPlayed' ? 'selected' : ''}>Last played</option>
            </select>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">Sort direction</div>
          <div class="settings-row-control">
            <select class="settings-select" id="sort-direction">
              <option value="desc" ${s.sortDirection === 'desc' ? 'selected' : ''}>Descending</option>
              <option value="asc" ${s.sortDirection === 'asc' ? 'selected' : ''}>Ascending</option>
            </select>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Engine</div>
        <div class="settings-row">
          <div class="settings-row-label">libVLC engine status</div>
          <div class="settings-row-control">
            <span style="font-size: 12px; font-weight: 600; color: ${engineAvailable ? 'var(--accent)' : 'var(--danger)'};">
              ${engineAvailable ? 'Available' : 'Not found — install VLC or set NOVAPLAY_LIBVLC'}
            </span>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">Always on top</div>
          <div class="settings-row-control">
            <div class="settings-toggle ${s.alwaysOnTop ? 'on' : ''}" id="always-on-top-toggle"></div>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">Reduced motion</div>
          <div class="settings-row-control">
            <div class="settings-toggle ${s.reducedMotion ? 'on' : ''}" id="reduced-motion-toggle"></div>
          </div>
        </div>
      </div>

      <button class="settings-reset-btn" id="settings-reset">Reset all settings to defaults</button>
    `;

    this._bindControls();
  }

  _bindControls() {
    // Close
    document.getElementById('settings-close')?.addEventListener('click', () => this.hide());

    // Accent color — NovaTune-style swatches with glow
    document.querySelectorAll('.settings-color-swatch').forEach(el => {
      el.addEventListener('click', async () => {
        document.querySelectorAll('.settings-color-swatch').forEach(s => s.classList.remove('active'));
        el.classList.add('active');
        const color = el.dataset.color;
        await window.novaAPI.setSetting('accentColor', color);
        this._settings.accentColor = color;
        this._callbacks.onSettingsChange?.(this._settings);
      });
    });

    // Background mode
    document.getElementById('bg-mode')?.addEventListener('change', async (e) => {
      await window.novaAPI.setSetting('backgroundMode', e.target.value);
      this._settings.backgroundMode = e.target.value;
      this._callbacks.onSettingsChange?.(this._settings);
    });

    // Font selection
    document.getElementById('settings-font')?.addEventListener('change', async (e) => {
      await window.novaAPI.setSetting('activeFont', e.target.value);
      this._settings.activeFont = e.target.value;
      this._callbacks.onSettingsChange?.(this._settings);
    });

    // Default volume
    document.getElementById('default-vol')?.addEventListener('input', Utils.debounce(async (e) => {
      const vol = parseInt(e.target.value, 10) / 100;
      await window.novaAPI.setSetting('volume', vol);
      this._settings.volume = vol;
    }, 200));

    // Toggles — NovaTune-style green toggles
    const toggleMap = {
      'hw-accel-toggle': 'hwAccel',
      'resume-toggle': 'resumeOnOpen',
      'auto-rescan-toggle': 'autoRescan',
      'always-on-top-toggle': 'alwaysOnTop',
      'reduced-motion-toggle': 'reducedMotion'
    };
    for (const [id, key] of Object.entries(toggleMap)) {
      const el = document.getElementById(id);
      el?.addEventListener('click', async () => {
        el.classList.toggle('on');
        const on = el.classList.contains('on');
        await window.novaAPI.setSetting(key, on);
        this._settings[key] = on;
        if (key === 'alwaysOnTop') {
          window.novaAPI.send('nova:window-always-on-top', on);
        }
      });
    }

    // Sort order / direction
    document.getElementById('sort-order')?.addEventListener('change', async (e) => {
      await window.novaAPI.setSetting('sortOrder', e.target.value);
      this._settings.sortOrder = e.target.value;
    });
    document.getElementById('sort-direction')?.addEventListener('change', async (e) => {
      await window.novaAPI.setSetting('sortDirection', e.target.value);
      this._settings.sortDirection = e.target.value;
    });

    // Auto-hide ms
    document.getElementById('auto-hide-ms')?.addEventListener('input', Utils.debounce(async (e) => {
      const ms = parseInt(e.target.value, 10);
      if (ms >= 500 && ms <= 10000) {
        await window.novaAPI.setSetting('controlsAutoHideMs', ms);
        this._settings.controlsAutoHideMs = ms;
      }
    }, 300));

    // Reset
    document.getElementById('settings-reset')?.addEventListener('click', async () => {
      if (!confirm('Reset all settings to defaults?')) return;
      const defaults = await window.novaAPI.resetSettings();
      this._settings = defaults;
      this._render();
      this._callbacks.onSettingsChange?.(defaults);
    });
  }
}

window.SettingsPanel = SettingsPanel;
