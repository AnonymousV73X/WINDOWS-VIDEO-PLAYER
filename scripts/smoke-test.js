/**
 * NovaPlay — Smoke test for renderer components
 *
 * Mocks a minimal DOM + window.novaAPI so we can verify each component
 * instantiates without throwing. Run with: node scripts/smoke-test.js
 */

// ─── Mock DOM elements ────────────────────────────────────────────
class MockElement {
  constructor(id) {
    this.id = id;
    this.children = [];
    this.classList = {
      _set: new Set(),
      add(...c) { c.forEach(x => this._set.add(x)); return this; },
      remove(...c) { c.forEach(x => this._set.delete(x)); return this; },
      toggle(c, force) {
        if (force === true) this._set.add(c);
        else if (force === false) this._set.delete(c);
        else if (this._set.has(c)) this._set.delete(c);
        else this._set.add(c);
        return this._set.has(c);
      },
      contains(c) { return this._set.has(c); }
    };
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this._handlers = {};
    this.innerHTML = '';
    this.textContent = '';
    this.offsetWidth = 800;
    this.offsetHeight = 600;
    this.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600
    });
    this.parentNode = null;
  }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) {
    this.children = this.children.filter(c => c !== child);
    return child;
  }
  querySelector(sel) { return new MockElement('q-' + sel); }
  querySelectorAll(sel) { return [new MockElement('q-' + sel)]; }
  addEventListener(ev, fn, opts) {
    if (!this._handlers[ev]) this._handlers[ev] = [];
    this._handlers[ev].push(fn);
  }
  removeEventListener(ev, fn) {
    if (!this._handlers[ev]) return;
    this._handlers[ev] = this._handlers[ev].filter(f => f !== fn);
  }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k]; }
  removeAttribute(k) { delete this.attributes[k]; }
  cloneNode(deep) { const c = new MockElement(this.id); return c; }
  dispatchEvent(e) {
    if (this._handlers[e.type]) {
      for (const fn of this._handlers[e.type]) fn(e);
    }
  }
  focus() {}
  select() {}
  play() { return Promise.resolve(); }
  pause() {}
  load() {}
  click() { this.dispatchEvent({ type: 'click' }); }
}

// ─── Mock document ────────────────────────────────────────────────
const elements = new Map();
function getOrCreateEl(id) {
  if (!elements.has(id)) elements.set(id, new MockElement(id));
  return elements.get(id);
}

global.document = {
  getElementById: (id) => getOrCreateEl(id),
  querySelector: (sel) => getOrCreateEl('q-' + sel),
  querySelectorAll: (sel) => [getOrCreateEl('qa-' + sel)],
  createElement: (tag) => new MockElement('el-' + tag + '-' + Math.random().toString(36).slice(2, 6)),
  createDocumentFragment: () => new MockElement('fragment'),
  createElementNS: (ns, tag) => new MockElement('svg-' + tag),
  addEventListener: (ev, fn, opts) => {},
  removeEventListener: (ev, fn) => {},
  body: new MockElement('body'),
  documentElement: new MockElement('html'),
  dispatchEvent: (e) => {},
  readyState: 'complete'
};

global.window = {
  novaAPI: {
    invoke: async (ch, ...args) => {
      // Stub responses
      if (ch === 'nova:engine-available') return false;
      if (ch === 'nova:settings-get') return {
        theme: 'dark', accentColor: '#FF8800', backgroundMode: 'dim',
        activeFont: 'Outfit', volume: 0.8, hwAccel: true, resumeOnOpen: true,
        controlsAutoHideMs: 2500, autoRescan: true, sortOrder: 'dateAdded',
        sortDirection: 'desc', thumbnailSeekPct: 25, alwaysOnTop: false,
        reducedMotion: false, scanFolders: []
      };
      if (ch === 'nova:library-get-all') return [];
      if (ch === 'nova:playlists-get') return [];
      if (ch === 'nova:engine-tracks') return { audio: [], subtitles: [], chapters: 0, currentChapter: 0 };
      if (ch === 'nova:thumbnail-gen') return { ok: false };
      if (ch === 'nova:get-startup-file') return null;
      if (ch === 'nova:window-is-maximized') return false;
      if (ch === 'nova:window-is-fullscreen') return false;
      if (ch === 'nova:window-set-overlay-chrome') return { success: true };
      return { ok: true };
    },
    on: (ch, cb) => () => {},
    send: (ch, ...args) => {}
  },
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener: (ev, fn, opts) => {},
  removeEventListener: (ev, fn) => {},
  requestAnimationFrame: (cb) => setTimeout(cb, 16),
  ResizeObserver: class {
    observe() {}
    disconnect() {}
    unobserve() {}
  },
  localStorage: {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; }
  }
};

global.requestIdleCallback = (cb) => setTimeout(cb, 0);
global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
global.navigator = { userAgent: 'node' };

// ─── Test each component ──────────────────────────────────────────
const path = require('path');
const components = [
  'Sidebar',
  'LibraryView',
  'VideoScreen',
  'PlayerControls',
  'TrackMenu',
  'SettingsPanel',
  'NowPlayingBar'
];

let pass = 0, fail = 0;
for (const name of components) {
  try {
    const Cls = require(path.join(__dirname, '..', 'ui', 'components', name + '.js'));
    const instance = new Cls();
    if (typeof instance.init === 'function') {
      instance.init({});
    }
    console.log(`  ✓ ${name} instantiated`);
    pass++;
  } catch (err) {
    console.error(`  ✗ ${name} failed: ${err.message}`);
    console.error('    ' + err.stack.split('\n').slice(1, 3).join('\n    '));
    fail++;
  }
}

console.log(`\n${pass}/${pass + fail} components passed instantiation.`);
process.exit(fail === 0 ? 0 : 1);
