/**
 * NovaPlay — Renderer Entry (REVOLUTIONIZED v2)
 *
 * Boot sequence:
 *   1. DOMContentLoaded → initialize all components
 *   2. Load settings → apply theme + accent
 *   3. Load library from DB
 *   4. Wire up sidebar navigation
 *   5. Wire up engine events (time/state/end/error)
 *   6. Hide splash screen
 *
 * The renderer NEVER directly touches libVLC — it goes through the
 * novaAPI bridge to the main process. The .video-area div is a CSS
 * hole (transparent) where the libVLC child HWND shows through.
 */

// ─── Component imports ────────────────────────────────────────────
const Sidebar = require('./components/Sidebar');
const LibraryView = require('./components/LibraryView');
const VideoScreen = require('./components/VideoScreen');
const PlayerControls = require('./components/PlayerControls');
const TrackMenu = require('./components/TrackMenu');
const SettingsPanel = require('./components/SettingsPanel');
const NowPlayingBar = require('./components/NowPlayingBar');

// ─── State ────────────────────────────────────────────────────────
const state = {
  videos: [],
  currentVideo: null,
  queue: [],
  queueIndex: -1,
  isPlaying: false,
  shuffle: false,
  repeatMode: 'off',  // 'off' | 'all' | 'one'
  settings: null,
  engineAvailable: false
};

// ─── Components (instantiated after DOM ready) ────────────────────
let sidebar, libraryView, videoScreen, playerControls, trackMenu, settingsPanel, nowPlayingBar;
let _engineEventUnsub = null;
let _fallbackEventUnsub = null;

// ═══ Boot ════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[boot] NovaPlay initializing…');
  updateSplashStatus('loading', 'Initializing…');

  // 1. Instantiate components
  sidebar = new Sidebar();
  libraryView = new LibraryView();
  videoScreen = new VideoScreen();
  playerControls = new PlayerControls();
  trackMenu = new TrackMenu();
  settingsPanel = new SettingsPanel();
  nowPlayingBar = new NowPlayingBar();

  // 2. Wire components together
  videoScreen.init({ playerControls, trackMenu }, {
    onBack: handleBackToLibrary
  });
  playerControls.init(videoScreen, {
    onPrev: handlePrev,
    onNext: handleNext,
    onShuffleChange: (on) => { state.shuffle = on; nowPlayingBar.setShuffle(on); },
    onRepeatChange: (mode) => { state.repeatMode = mode; nowPlayingBar.setRepeat(mode); },
    onVolumeChange: (vol) => { /* persisted by settings */ },
    onRateChange: (rate) => { /* persisted by settings */ },
    onShowTrackMenu: (type) => trackMenu.show(type),
    onShowSettings: () => { /* could open settings overlay */ }
  });
  trackMenu.init({});
  sidebar.init({
    onNavigate: handleNavigate,
    onAddFolder: handleAddFolder,
    onRemoveFolder: handleRemoveFolder,
    onFolderClick: (folder) => { /* could filter library by folder */ },
    onCreatePlaylist: handleCreatePlaylist,
    onPlaylistClick: (id) => { /* open playlist detail */ },
    onDeletePlaylist: handleDeletePlaylist,
    onResize: (w) => { /* persist sidebar width */ }
  });
  libraryView.init({
    onPlayVideo: handlePlayVideo,
    onAddFolder: handleAddFolder,
    onCancelScan: handleCancelScan,
    onContextMenu: handleContextMenu
  });
  settingsPanel.init({
    onSortChange: (order, dir) => { reloadLibrary(); },
    onAutoHideChange: (ms) => { videoScreen.setAutoHideMs(ms); }
  });
  nowPlayingBar.init({
    onPlayPause: () => playerControls._onPlayPause(),
    onPrev: handlePrev,
    onNext: handleNext,
    onShuffle: () => { playerControls.shuffleBtn.click(); },
    onRepeat: () => { playerControls.repeatBtn.click(); },
    onExpand: () => videoScreen.show(state.currentVideo),
    onSeek: (time) => videoScreen.engineSeek(time)
  });

  // 3. Titlebar wiring
  initTitlebar();

  // 4. Load settings (parallel with library)
  updateSplashStatus('loading', 'Loading settings…');
  await loadSettings();
  applySettings();

  // 5. Check engine availability
  updateSplashStatus('loading', 'Checking video engine…');
  state.engineAvailable = await videoScreen.checkEngine();

  // 6. Load library
  updateSplashStatus('loading', 'Loading library…');
  await reloadLibrary();

  // 7. Load folders + playlists
  await loadFolders();
  await loadPlaylists();

  // 8. Wire engine events
  wireEngineEvents();

  // 9. Auto-rescan if enabled
  if (state.settings.autoRescan && state.settings.scanFolders.length > 0) {
    setTimeout(() => autoRescan(), 500);
  }

  // 10. Handle file association (if app was launched with a video file)
  handleStartupFile();

  // 11. Hide splash
  setTimeout(() => hideSplash(), 300);

  console.log('[boot] NovaPlay ready');
});

// ═══ Settings ════════════════════════════════════════════════════
async function loadSettings() {
  try {
    state.settings = await window.novaAPI.invoke('nova:settings-get');
  } catch (err) {
    console.error('[boot] failed to load settings:', err);
    state.settings = {};
  }
}

function applySettings() {
  const s = state.settings;

  // Theme
  if (s.theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }

  // Accent
  if (s.accentColor) {
    document.documentElement.style.setProperty('--green', s.accentColor);
    document.documentElement.style.setProperty('--accent', s.accentColor);
  }

  // Background mode
  if (s.backgroundMode === 'amoled') {
    document.documentElement.style.setProperty('--bg', '#000000');
  }

  // Font
  if (s.activeFont === 'Figtree') {
    const figtreeLink = document.getElementById('figtree-css');
    if (figtreeLink) figtreeLink.media = 'all';
    document.documentElement.style.setProperty('--app-font', '"Figtree", sans-serif');
  }

  // Volume (apply to player controls UI)
  if (typeof s.volume === 'number') {
    playerControls.setVolume(s.volume);
  }

  // Auto-hide
  if (s.controlsAutoHideMs) {
    videoScreen.setAutoHideMs(s.controlsAutoHideMs);
  }

  // Always on top
  if (s.alwaysOnTop) {
    window.novaAPI.send('nova:window-always-on-top', true);
  }

  // Reduced motion
  if (s.reducedMotion) {
    document.body.classList.add('reduced-motion');
  }
}

// ═══ Library ═════════════════════════════════════════════════════
async function reloadLibrary() {
  try {
    const videos = await window.novaAPI.invoke('nova:library-get-all');
    state.videos = videos || [];
    libraryView.setVideos(state.videos);
    sidebar.setLibraryCount(state.videos.length);
  } catch (err) {
    console.error('[boot] failed to load library:', err);
    libraryView.setVideos([]);
  }
}

async function loadFolders() {
  const folders = state.settings.scanFolders || [];
  sidebar.setFolders(folders);
}

async function loadPlaylists() {
  try {
    const playlists = await window.novaAPI.invoke('nova:playlists-get');
    sidebar.setPlaylists(playlists || []);
  } catch (err) {
    console.warn('[boot] failed to load playlists:', err);
  }
}

// ═══ Engine events ═══════════════════════════════════════════════
function wireEngineEvents() {
  if (_engineEventUnsub) _engineEventUnsub();
  if (_fallbackEventUnsub) _fallbackEventUnsub();

  _engineEventUnsub = videoScreen.subscribeEngineEvents(
    // onTime
    (event) => {
      playerControls.setTime(event.time, event.duration, event.position);
      nowPlayingBar.setTime(event.time, event.duration);
    },
    // onState
    (event) => {
      const playing = event.state === 'playing';
      state.isPlaying = playing;
      playerControls.setPlaying(playing);
      nowPlayingBar.setPlaying(playing);

      // Record watch history
      if (playing && state.currentVideo) {
        recordWatchHistory(state.currentVideo.id, event.time, event.duration);
      }
    },
    // onEnd
    () => {
      handleVideoEnded();
    },
    // onError
    (event) => {
      console.error('[engine] error:', event.message);
      showToast(event.message || 'Playback error', 'error');
    }
  );

  // Fallback (HTML5 <video>) events
  _fallbackEventUnsub = videoScreen.subscribeFallbackEvents(
    (event) => {
      playerControls.setTime(event.time, event.duration, event.position);
      nowPlayingBar.setTime(event.time, event.duration);
    },
    (event) => {
      const playing = event.state === 'playing';
      state.isPlaying = playing;
      playerControls.setPlaying(playing);
      nowPlayingBar.setPlaying(playing);
    },
    () => handleVideoEnded(),
    (event) => {
      console.error('[fallback] error:', event.message);
      showToast(event.message || 'Playback error', 'error');
    }
  );
}

// ═══ Playback flow ═══════════════════════════════════════════════
async function handlePlayVideo(video) {
  state.currentVideo = video;

  // Build a queue from the current filtered library
  const filtered = libraryView._filtered || state.videos;
  state.queue = filtered.slice();
  state.queueIndex = state.queue.findIndex(v => v.id === video.id);
  if (state.queueIndex < 0) {
    state.queue = [video];
    state.queueIndex = 0;
  }

  // Show video screen
  videoScreen.show(video);
  nowPlayingBar.show(video);

  // Load into engine
  await videoScreen.load(video);

  // Auto-play
  await videoScreen.enginePlay();

  // Record watch
  recordWatchHistory(video.id, 0, video.duration || 0);
}

async function handlePrev() {
  if (state.queueIndex <= 0) return;
  state.queueIndex--;
  const next = state.queue[state.queueIndex];
  if (next) {
    state.currentVideo = next;
    videoScreen.show(next);
    nowPlayingBar.show(next);
    await videoScreen.load(next);
    await videoScreen.enginePlay();
  }
}

async function handleNext() {
  if (state.shuffle && state.queue.length > 1) {
    let idx;
    do { idx = Math.floor(Math.random() * state.queue.length); }
    while (idx === state.queueIndex);
    state.queueIndex = idx;
  } else if (state.queueIndex < state.queue.length - 1) {
    state.queueIndex++;
  } else if (state.repeatMode === 'all') {
    state.queueIndex = 0;
  } else {
    return;  // end of queue, no repeat
  }
  const next = state.queue[state.queueIndex];
  if (next) {
    state.currentVideo = next;
    videoScreen.show(next);
    nowPlayingBar.show(next);
    await videoScreen.load(next);
    await videoScreen.enginePlay();
  }
}

async function handleVideoEnded() {
  if (state.repeatMode === 'one' && state.currentVideo) {
    await videoScreen.engineSeek(0);
    await videoScreen.enginePlay();
  } else {
    await handleNext();
  }
}

function handleBackToLibrary() {
  videoScreen.hide();
  // Pause playback when leaving video screen
  if (state.isPlaying) {
    videoScreen.enginePause();
  }
}

// ═══ Navigation ══════════════════════════════════════════════════
function handleNavigate(section) {
  // Hide all views
  document.getElementById('library-view').classList.add('hidden');
  document.getElementById('settings-view').classList.add('hidden');
  document.getElementById('video-screen').classList.remove('active');

  if (section === 'settings') {
    document.getElementById('settings-view').classList.remove('hidden');
    settingsPanel.load();
  } else {
    document.getElementById('library-view').classList.remove('hidden');
    libraryView.setView(section);
    if (section === 'history') {
      loadHistory();
    } else if (section === 'playlists') {
      loadPlaylistsView();
    } else {
      libraryView.setVideos(state.videos);
    }
  }
}

async function loadHistory() {
  try {
    const history = await window.novaAPI.invoke('nova:watch-history-get');
    if (history && history.length > 0) {
      // Map history entries to video objects
      const videos = history.map(h => state.videos.find(v => v.id === h.videoId)).filter(Boolean);
      libraryView.setVideos(videos);
    } else {
      libraryView.setVideos([]);
    }
  } catch (err) {
    console.warn('[history] load failed:', err);
  }
}

async function loadPlaylistsView() {
  // For now, just show empty state — playlist detail view can be added later
  libraryView.setVideos([]);
}

// ═══ Folders ═════════════════════════════════════════════════════
async function handleAddFolder() {
  try {
    const folder = await window.novaAPI.invoke('nova:pick-folder');
    if (!folder) return;

    // Start scan
    libraryView.showScan('Scanning…', folder, 0);

    const unsub = window.novaAPI.on('nova:scan-progress', (data) => {
      if (data.stage === 'scanning') {
        libraryView.updateScan('Scanning…', `${data.count} files found`, null);
      } else if (data.stage === 'reading') {
        const pct = data.total ? (data.current / data.total) * 100 : 0;
        libraryView.updateScan('Reading metadata…', `${data.current}/${data.total}`, pct);
      } else if (data.stage === 'complete') {
        libraryView.updateScan('Complete!', `${data.added} videos added`, 100);
        setTimeout(() => libraryView.hideScan(), 800);
        reloadLibrary();
        loadFolders();
        unsub();
      } else if (data.stage === 'error') {
        libraryView.hideScan();
        showToast('Scan failed: ' + (data.message || 'unknown error'), 'error');
        unsub();
      }
    });

    const r = await window.novaAPI.invoke('nova:scan-folder', folder);
    if (!r || !r.ok) {
      libraryView.hideScan();
      showToast('Scan failed: ' + (r?.error || 'unknown error'), 'error');
      unsub();
    }
  } catch (err) {
    console.error('[folders] add failed:', err);
    showToast('Failed to add folder', 'error');
  }
}

async function handleRemoveFolder(folder) {
  try {
    // Remove from settings
    const folders = state.settings.scanFolders.filter(f => f !== folder);
    await window.novaAPI.invoke('nova:settings-set', { key: 'scanFolders', value: folders });
    state.settings.scanFolders = folders;
    sidebar.setFolders(folders);

    // Optionally remove videos from library that belong to this folder
    // (commented out — keep videos but stop scanning this folder)
    // await window.novaAPI.invoke('nova:library-remove-folder', folder);
    // await reloadLibrary();

    showToast('Folder removed');
  } catch (err) {
    console.error('[folders] remove failed:', err);
  }
}

async function handleCancelScan() {
  try {
    window.novaAPI.send('nova:scan-cancel');
    libraryView.hideScan();
  } catch (_) {}
}

async function autoRescan() {
  if (!state.settings.scanFolders || state.settings.scanFolders.length === 0) return;
  for (const folder of state.settings.scanFolders) {
    try {
      await window.novaAPI.invoke('nova:scan-folder', folder);
    } catch (_) {}
  }
  await reloadLibrary();
}

// ═══ Playlists ═══════════════════════════════════════════════════
async function handleCreatePlaylist() {
  const name = await showPromptDialog('New Playlist', 'Enter a name for your playlist:');
  if (!name) return;
  try {
    await window.novaAPI.invoke('nova:playlist-create', name);
    await loadPlaylists();
    showToast('Playlist created');
  } catch (err) {
    showToast('Failed to create playlist', 'error');
  }
}

async function handleDeletePlaylist(id) {
  const ok = await showConfirmDialog('Delete Playlist', 'Are you sure you want to delete this playlist? This cannot be undone.');
  if (!ok) return;
  try {
    await window.novaAPI.invoke('nova:playlist-delete', id);
    await loadPlaylists();
    showToast('Playlist deleted');
  } catch (err) {
    showToast('Failed to delete playlist', 'error');
  }
}

// ═══ Watch history ═══════════════════════════════════════════════
let _historyRecordTimer = null;
function recordWatchHistory(videoId, position, duration) {
  if (_historyRecordTimer) clearTimeout(_historyRecordTimer);
  _historyRecordTimer = setTimeout(async () => {
    try {
      await window.novaAPI.invoke('nova:watch-record', {
        videoId, position, duration,
        completed: duration > 0 && position > duration * 0.9
      });
    } catch (_) {}
  }, 2000);
}

// ═══ Context menu ════════════════════════════════════════════════
async function handleContextMenu(video, pos) {
  // Simple context menu: play, add to playlist
  // For now, just play
  handlePlayVideo(video);
}

// ═══ File association ════════════════════════════════════════════
async function handleStartupFile() {
  try {
    const file = await window.novaAPI.invoke('nova:get-startup-file');
    if (file) {
      // Create a video object and play
      const video = {
        id: 'vid_' + file,
        title: file.split(/[\\/]/).pop(),
        filePath: file,
        duration: 0
      };
      handlePlayVideo(video);
    }
  } catch (_) {}
}

// Listen for player:play-file events (second-instance launch)
window.novaAPI.on('player:play-file', async (filePath) => {
  if (!filePath) return;
  const video = {
    id: 'vid_' + filePath,
    title: filePath.split(/[\\/]/).pop(),
    filePath,
    duration: 0
  };
  handlePlayVideo(video);
});

// ═══ Titlebar ════════════════════════════════════════════════════
function initTitlebar() {
  document.getElementById('titlebar-minimize').addEventListener('click', () => {
    window.novaAPI.send('nova:window-minimize');
  });
  document.getElementById('titlebar-maximize').addEventListener('click', async () => {
    const isMax = await window.novaAPI.invoke('nova:window-is-maximized');
    window.novaAPI.send('nova:window-maximize');
    // Update icon
    const icon = document.querySelector('#titlebar-maximize svg');
    if (icon) {
      // Toggle between maximize and restore icons (both look similar here)
    }
  });
  document.getElementById('titlebar-close').addEventListener('click', () => {
    window.novaAPI.send('nova:window-close');
  });
}

// ═══ Splash screen ═══════════════════════════════════════════════
function updateSplashStatus(state, text) {
  const dot = document.querySelector('.splash-status-dot');
  const textEl = document.querySelector('.splash-status-text');
  if (dot) {
    dot.classList.remove('is-loading', 'is-done', 'is-error');
    dot.classList.add('is-' + state);
  }
  if (textEl) textEl.textContent = text;

  // Animate progress bar
  const fill = document.getElementById('splash-progress-fill');
  if (fill) {
    const pct = parseFloat(fill.style.width) || 0;
    fill.style.width = Math.min(100, pct + 20) + '%';
  }
}

function hideSplash() {
  const splash = document.getElementById('splash-screen');
  if (splash) {
    const fill = document.getElementById('splash-progress-fill');
    if (fill) fill.style.width = '100%';
    setTimeout(() => splash.classList.add('hidden'), 200);
  }
}

// ═══ Toast ═══════════════════════════════════════════════════════
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast' + (type === 'error' ? ' error' : '');
  toast.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      ${type === 'error'
        ? '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'
        : '<polyline points="20 6 9 17 4 12"/>'}
    </svg>
    <span>${escapeHtml(message)}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

// ═══ Dialog helpers ══════════════════════════════════════════════
function showPromptDialog(title, body, defaultValue = '') {
  return new Promise((resolve) => {
    const backdrop = document.getElementById('dialog-backdrop');
    const titleEl = document.getElementById('dialog-title');
    const bodyEl = document.getElementById('dialog-body');
    const actions = document.getElementById('dialog-actions');

    titleEl.textContent = title;
    bodyEl.innerHTML = `<input type="text" class="dialog-input" id="dialog-input" value="${escapeHtml(defaultValue)}" placeholder="Enter name…">`;
    actions.innerHTML = `
      <button class="dialog-btn secondary" id="dialog-cancel">Cancel</button>
      <button class="dialog-btn primary" id="dialog-ok">OK</button>
    `;

    backdrop.classList.add('visible');

    const input = document.getElementById('dialog-input');
    input.focus();
    input.select();

    const cleanup = () => {
      backdrop.classList.remove('visible');
    };

    document.getElementById('dialog-cancel').onclick = () => {
      cleanup();
      resolve(null);
    };
    document.getElementById('dialog-ok').onclick = () => {
      const val = input.value.trim();
      cleanup();
      resolve(val || null);
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') document.getElementById('dialog-ok').click();
      if (e.key === 'Escape') document.getElementById('dialog-cancel').click();
    };
  });
}

function showConfirmDialog(title, body) {
  return new Promise((resolve) => {
    const backdrop = document.getElementById('dialog-backdrop');
    const titleEl = document.getElementById('dialog-title');
    const bodyEl = document.getElementById('dialog-body');
    const actions = document.getElementById('dialog-actions');

    titleEl.textContent = title;
    bodyEl.textContent = body;
    actions.innerHTML = `
      <button class="dialog-btn secondary" id="dialog-cancel">Cancel</button>
      <button class="dialog-btn danger" id="dialog-ok">Confirm</button>
    `;

    backdrop.classList.add('visible');

    const cleanup = () => {
      backdrop.classList.remove('visible');
    };

    document.getElementById('dialog-cancel').onclick = () => {
      cleanup();
      resolve(false);
    };
    document.getElementById('dialog-ok').onclick = () => {
      cleanup();
      resolve(true);
    };
  });
}

// ═══ Helpers ═════════════════════════════════════════════════════
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

// Expose for debugging
window.__novaplay = { state, components: () => ({ sidebar, libraryView, videoScreen, playerControls, trackMenu, settingsPanel, nowPlayingBar }) };
