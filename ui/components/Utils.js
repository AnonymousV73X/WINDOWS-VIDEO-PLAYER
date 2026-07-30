/**
 * NovaPlay — UI Utilities
 *
 * Small helpers used across all UI components: time formatting,
 * DOM querying, event binding with cleanup, and a simple HTML escape.
 */

const Utils = {
  /** Format seconds as M:SS or H:MM:SS */
  formatTime(seconds) {
    if (!seconds || !isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  },

  /** Format bytes as human-readable (e.g. "1.4 GB") */
  formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const val = bytes / Math.pow(1024, i);
    return (i < 2 ? Math.round(val) : val.toFixed(1)) + ' ' + units[i];
  },

  /** Format resolution (e.g. "1920×1080" or "4K") */
  formatResolution(w, h) {
    if (!w || !h) return '';
    if (w >= 3840) return '4K';
    if (w >= 1920) return '1080p';
    if (w >= 1280) return '720p';
    if (w >= 854) return '480p';
    return `${w}×${h}`;
  },

  /** Query selector shorthand */
  $(selector) { return document.querySelector(selector); },
  $$(selector) { return document.querySelectorAll(selector); },

  /** Add event listener that returns a cleanup function */
  on(el, event, handler, opts) {
    if (!el) return () => {};
    el.addEventListener(event, handler, opts);
    return () => el.removeEventListener(event, handler, opts);
  },

  /** Debounce */
  debounce(fn, ms = 100) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  },

  /** Throttle via requestAnimationFrame */
  rafThrottle(fn) {
    let scheduled = false;
    let lastArgs = null;
    return (...args) => {
      lastArgs = args;
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        fn(...lastArgs);
      });
    };
  },

  /** Escape HTML to prevent injection */
  escape(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /** Encode a file path for use in nova-video:// URLs */
  encodeFilePath(filePath) {
    // URL-encode but preserve backslashes (they get decoded later)
    return encodeURIComponent(filePath).replace(/%2F/g, '/').replace(/%5C/g, '\\');
  },

  /** Show a tooltip near an element */
  showTooltip(text, x, y) {
    const tip = document.getElementById('tooltip');
    if (!tip) return;
    tip.textContent = text;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    tip.classList.add('visible');
  },

  hideTooltip() {
    const tip = document.getElementById('tooltip');
    if (tip) tip.classList.remove('visible');
  }
};

window.Utils = Utils;
