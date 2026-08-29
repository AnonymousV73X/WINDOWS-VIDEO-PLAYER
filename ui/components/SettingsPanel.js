/**
 * NovaPlay — SettingsPanel (NovaTune-style)
 *
 * Settings sections:
 *   - Appearance: theme (dark/light), accent color swatches + custom,
 *     background mode (amoled/dim), font family (Outfit/Figtree)
 *   - Playback: volume, hardware acceleration, resume on open,
 *     controls auto-hide timeout
 *   - Library: auto-rescan, sort order/direction, thumbnail seek %
 *   - Engine: libVLC availability status
 *   - Window: always-on-top, mini player
 *
 * All controls are NovaTune-style: toggle switches, swatch picker,
 * range sliders with green fill, engine status pill.
 */

class SettingsPanel {
  constructor() {
    this.container = document.getElementById('settings-panel');
    this._settings = null;
    this._engineAvailable = false;
    this._callbacks = {};
    this._handlers = [];

    // 8 preset accent swatches (NovaTune-style, with VLC orange as default)
    this._swatches = [
      { name: 'VLC Orange', hex: '#FF8800' },
      { name: 'Spotify Green', hex: '#1ed760' },
      { name: 'Sky Blue', hex: '#00bfff' },
      { name: 'Yellow', hex: '#f7c948' },
      { name: 'Mint', hex: '#3de0c0' },
      { name: 'Pink', hex: '#e040fb' },
      { name: 'Red', hex: '#ff4d6d' },
      { name: 'Ice', hex: '#a8edea' }
    ];
  }

  init(callbacks = {}) {
    this._callbacks = callbacks;
  }

  async load() {
    try {
      this._settings = await window.novaAPI.invoke('nova:settings-get');
      this._engineAvailable = await window.novaAPI.invoke('nova:engine-available');
    } catch (err) {
      console.error('[settings] load failed:', err);
      return;
    }
    this._render();
  }

  // ═══ Render ═════════════════════════════════════════════════════
  _render() {
    this.container.innerHTML = '';

    this._renderAppearance();
    this._renderPlayback();
    this._renderLibrary();
    this._renderEngine();
    this._renderWindow();
  }

  // ─── Appearance ─────────────────────────────────────────────────
  _renderAppearance() {
    const section = this._section('Appearance');

    // Theme toggle (Dark / Light)
    section.appendChild(this._row({
      label: 'Theme',
      desc: 'Switch between dark and light mode.',
      control: this._segmentedControl(
        [
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' }
        ],
        this._settings.theme || 'dark',
        (val) => this._setSetting('theme', val, () => {
          document.documentElement.setAttribute('data-theme', val);
        })
      )
    }));

    // Accent color
    const swatchPicker = document.createElement('div');
    swatchPicker.className = 'swatch-picker';
    for (const sw of this._swatches) {
      const el = document.createElement('div');
      el.className = 'swatch' + (this._settings.accentColor === sw.hex ? ' selected' : '');
      el.style.background = sw.hex;
      el.title = sw.name;
      this._addHandler(el, 'click', () => {
        this._setSetting('accentColor', sw.hex, () => {
          document.documentElement.style.setProperty('--green', sw.hex);
          document.documentElement.style.setProperty('--accent', sw.hex);
        });
        // Update selected state
        for (const s of swatchPicker.querySelectorAll('.swatch')) {
          s.classList.remove('selected');
        }
        el.classList.add('selected');
      });
      swatchPicker.appendChild(el);
    }
    // Custom color picker
    const customWrap = document.createElement('div');
    customWrap.className = 'swatch-custom';
    customWrap.title = 'Custom color';
    const customInput = document.createElement('input');
    customInput.type = 'color';
    customInput.value = this._settings.accentColor || '#FF8800';
    this._addHandler(customInput, 'input', () => {
      const hex = customInput.value;
      this._setSetting('accentColor', hex, () => {
        document.documentElement.style.setProperty('--green', hex);
        document.documentElement.style.setProperty('--accent', hex);
      });
      for (const s of swatchPicker.querySelectorAll('.swatch')) {
        s.classList.remove('selected');
      }
    });
    customWrap.appendChild(customInput);
    swatchPicker.appendChild(customWrap);

    section.appendChild(this._row({
      label: 'Accent color',
      desc: 'Used for active states, progress bars, and glows.',
      control: swatchPicker
    }));

    // Background mode (amoled / dim)
    section.appendChild(this._row({
      label: 'Background',
      desc: 'AMOLED uses pure black (#000) for OLED battery savings. Dim uses #121212.',
      control: this._segmentedControl(
        [
          { value: 'amoled', label: 'AMOLED' },
          { value: 'dim', label: 'Dim' }
        ],
        this._settings.backgroundMode || 'dim',
        (val) => this._setSetting('backgroundMode', val, () => {
          document.documentElement.style.setProperty('--bg',
            val === 'amoled' ? '#000000' : '#121212');
        })
      )
    }));

    // Font family
    section.appendChild(this._row({
      label: 'Font',
      desc: 'Outfit is the default. Figtree is an alternative.',
      control: this._segmentedControl(
        [
          { value: 'Outfit', label: 'Outfit' },
          { value: 'Figtree', label: 'Figtree' }
        ],
        this._settings.activeFont || 'Outfit',
        (val) => this._setSetting('activeFont', val, () => {
          document.documentElement.style.setProperty('--app-font', `"${val}", sans-serif`);
          // Toggle figtree CSS load
          const figtreeLink = document.getElementById('figtree-css');
          if (figtreeLink) {
            figtreeLink.media = (val === 'Figtree') ? 'all' : 'not all';
          }
        })
      )
    }));

    this.container.appendChild(section);
  }

  // ─── Playback ───────────────────────────────────────────────────
  _renderPlayback() {
    const section = this._section('Playback');

    // Hardware acceleration
    section.appendChild(this._row({
      label: 'Hardware acceleration',
      desc: 'Use DXVA2/D3D11 for decoding (essential for 10-bit x265).',
      control: this._toggle(this._settings.hwAccel !== false, (on) =>
        this._setSetting('hwAccel', on)
      )
    }));

    // Resume on open
    section.appendChild(this._row({
      label: 'Resume on open',
      desc: 'When reopening a video, jump to your last position.',
      control: this._toggle(this._settings.resumeOnOpen !== false, (on) =>
        this._setSetting('resumeOnOpen', on)
      )
    }));

    // Controls auto-hide
    const autoHideRow = this._row({
      label: 'Controls auto-hide',
      desc: `Hide player controls after ${Math.round((this._settings.controlsAutoHideMs || 2500) / 1000)}s of inactivity.`,
      control: this._rangeSlider(
        (this._settings.controlsAutoHideMs || 2500) / 1000,
        0.5, 10, 0.5,
        (val) => {
          this._setSetting('controlsAutoHideMs', Math.round(val * 1000));
          this._callbacks.onAutoHideChange?.(Math.round(val * 1000));
        },
        (val) => val + 's'
      )
    });
    section.appendChild(autoHideRow);

    // Default volume
    section.appendChild(this._row({
      label: 'Default volume',
      desc: `Volume when starting playback (${Math.round((this._settings.volume || 0.8) * 100)}%).`,
      control: this._rangeSlider(
        (this._settings.volume || 0.8) * 100,
        0, 100, 1,
        (val) => this._setSetting('volume', val / 100),
        (val) => Math.round(val) + '%'
      )
    }));

    this.container.appendChild(section);
  }

  // ─── Library ────────────────────────────────────────────────────
  _renderLibrary() {
    const section = this._section('Library');

    // Auto-rescan
    section.appendChild(this._row({
      label: 'Auto-rescan on launch',
      desc: 'Rescan folders when NovaPlay starts.',
      control: this._toggle(this._settings.autoRescan !== false, (on) =>
        this._setSetting('autoRescan', on)
      )
    }));

    // Sort order
    section.appendChild(this._row({
      label: 'Sort by',
      desc: 'Default sort field for the library.',
      control: this._segmentedControl(
        [
          { value: 'dateAdded', label: 'Date Added' },
          { value: 'title', label: 'Title' },
          { value: 'duration', label: 'Duration' },
          { value: 'lastPlayed', label: 'Last Played' }
        ],
        this._settings.sortOrder || 'dateAdded',
        (val) => this._setSetting('sortOrder', val, () => {
          this._callbacks.onSortChange?.(val, this._settings.sortDirection);
        })
      )
    }));

    // Sort direction
    section.appendChild(this._row({
      label: 'Sort direction',
      desc: 'Ascending or descending.',
      control: this._segmentedControl(
        [
          { value: 'desc', label: 'Desc' },
          { value: 'asc', label: 'Asc' }
        ],
        this._settings.sortDirection || 'desc',
        (val) => this._setSetting('sortDirection', val, () => {
          this._callbacks.onSortChange?.(this._settings.sortOrder, val);
        })
      )
    }));

    // Thumbnail seek %
    section.appendChild(this._row({
      label: 'Thumbnail seek',
      desc: 'Position (as % of duration) used when generating thumbnails.',
      control: this._rangeSlider(
        this._settings.thumbnailSeekPct || 25,
        0, 100, 5,
        (val) => this._setSetting('thumbnailSeekPct', val),
        (val) => val + '%'
      )
    }));

    this.container.appendChild(section);
  }

  // ─── Engine ─────────────────────────────────────────────────────
  _renderEngine() {
    const section = this._section('Video Engine');

    const status = document.createElement('div');
    status.className = 'engine-status';
    status.innerHTML = `
      <div class="engine-status-dot ${this._engineAvailable ? 'ok' : 'error'}"></div>
      <div class="engine-status-text">libVLC ${this._engineAvailable ? 'Available' : 'Not Found'}</div>
      <div class="engine-status-detail">${this._engineAvailable ? 'All formats supported' : 'Install VLC or set NOVAPLAY_LIBVLC'}</div>
    `;
    section.appendChild(status);

    section.appendChild(this._row({
      label: 'About libVLC',
      desc: 'NovaPlay uses libVLC for broad format support — MP4, MKV, AVI, MOV, WebM, FLV, WMV, MPG, MPEG, TS, M2TS, VOB, OGV, 3GP, and 10-bit x265 (HEVC). Hardware acceleration via DXVA2/D3D11 is enabled by default.',
      control: document.createElement('div')
    }));

    this.container.appendChild(section);
  }

  // ─── Window ─────────────────────────────────────────────────────
  _renderWindow() {
    const section = this._section('Window');

    // Always on top
    section.appendChild(this._row({
      label: 'Always on top',
      desc: 'Keep NovaPlay above other windows.',
      control: this._toggle(this._settings.alwaysOnTop === true, (on) => {
        this._setSetting('alwaysOnTop', on);
        window.novaAPI.send('nova:window-always-on-top', on);
      })
    }));

    // Reduced motion
    section.appendChild(this._row({
      label: 'Reduced motion',
      desc: 'Minimize non-essential animations.',
      control: this._toggle(this._settings.reducedMotion === true, (on) => {
        this._setSetting('reducedMotion', on);
        document.body.classList.toggle('reduced-motion', on);
      })
    }));

    this.container.appendChild(section);
  }

  // ═══ UI primitives ══════════════════════════════════════════════
  _section(title) {
    const sec = document.createElement('div');
    sec.className = 'settings-section';
    sec.innerHTML = `<div class="settings-section-title">${this._escape(title)}</div>`;
    return sec;
  }

  _row({ label, desc, control }) {
    const row = document.createElement('div');
    row.className = 'settings-row';
    row.innerHTML = `
      <div class="settings-row-info">
        <div class="settings-row-label">${this._escape(label)}</div>
        <div class="settings-row-desc">${this._escape(desc)}</div>
      </div>
    `;
    const ctrlWrap = document.createElement('div');
    ctrlWrap.className = 'settings-row-control';
    ctrlWrap.appendChild(control);
    row.appendChild(ctrlWrap);
    return row;
  }

  _toggle(initialOn, onChange) {
    const el = document.createElement('div');
    el.className = 'toggle-switch' + (initialOn ? ' on' : '');
    el.setAttribute('role', 'switch');
    el.setAttribute('aria-checked', String(!!initialOn));
    el.tabIndex = 0;
    this._addHandler(el, 'click', () => {
      const on = !el.classList.contains('on');
      el.classList.toggle('on', on);
      el.setAttribute('aria-checked', String(on));
      onChange(on);
    });
    this._addHandler(el, 'keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        el.click();
      }
    });
    return el;
  }

  _segmentedControl(options, initialValue, onChange) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;background:var(--surface);border-radius:8px;padding:2px;gap:2px;border:1px solid color-mix(in srgb, var(--text-muted) 15%, transparent);';
    for (const opt of options) {
      const btn = document.createElement('button');
      btn.textContent = opt.label;
      btn.dataset.value = opt.value;
      btn.style.cssText = `padding:6px 14px;font-size:12.5px;font-weight:500;border-radius:6px;color:${opt.value === initialValue ? 'var(--btn-text-dark)' : 'var(--text-secondary)'};background:${opt.value === initialValue ? 'var(--green)' : 'transparent'};transition:background 0.15s,color 0.15s;`;
      this._addHandler(btn, 'click', () => {
        for (const b of wrap.querySelectorAll('button')) {
          b.style.background = 'transparent';
          b.style.color = 'var(--text-secondary)';
        }
        btn.style.background = 'var(--green)';
        btn.style.color = 'var(--btn-text-dark)';
        onChange(opt.value);
      });
      wrap.appendChild(btn);
    }
    return wrap;
  }

  _rangeSlider(initialValue, min, max, step, onChange, formatFn) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'range-slider';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(initialValue);
    const label = document.createElement('span');
    label.textContent = formatFn ? formatFn(initialValue) : String(initialValue);
    label.style.cssText = 'font-size:12px;color:var(--text-secondary);font-variant-numeric:tabular-nums;min-width:36px;text-align:right;';
    this._addHandler(slider, 'input', () => {
      const v = parseFloat(slider.value);
      label.textContent = formatFn ? formatFn(v) : String(v);
      onChange(v);
    });
    wrap.appendChild(slider);
    wrap.appendChild(label);
    return wrap;
  }

  // ═══ Setting persistence ════════════════════════════════════════
  async _setSetting(key, value, onApply) {
    if (this._settings) this._settings[key] = value;
    try {
      await window.novaAPI.invoke('nova:settings-set', { key, value });
    } catch (err) {
      console.error('[settings] set failed:', err);
    }
    if (onApply) onApply();
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

module.exports = SettingsPanel;
