/**
 * NovaPlay v2 — Renderer Entry
 *
 * Wires together all UI components + services. Holds the global app
 * state (current video, queue, settings, engine availability) and
 * mediates between the engine (libVLC via IPC), the player UI, the
 * library view, and the mini now-playing bar.
 *
 * v2 CHANGES:
 *   - Expose play state to CSS for EQ animation hooks (body.is-playing class)
 *   - Better error handling for video rendering
 *   - The video playback flow now relies on CSS-only positioning for
 *     the <video> fallback element (no inline style overrides in JS)
 */

// ─── Global State ──────────────────────────────────────────────────
const state = {
  videos: [],
  filteredVideos: [],
  playlists: [],
  settings: {},
  currentVideo: null,
  queue: [],
  queueIndex: -1,
  isPlaying: false,
  isFullscreen: false,
  isMiniPlayer: false,
  activeView: 'library',
  engineAvailable: false,
  scanProgress: null
};
window.state = state;

// ─── Component singletons ──────────────────────────────────────────
let ui = null;

// ─── Init ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const splash = document.getElementById('splash-screen');
  const splashFill = document.getElementById('splash-progress-fill');

  function setSplashProgress(pct) {
    if (splashFill) splashFill.style.width = pct + '%';
  }

  setSplashProgress(10);

  // ── Check if libVLC engine is available ──
  try {
    state.engineAvailable = await window.novaAPI.engineIsAvailable();
  } catch (_) {
    state.engineAvailable = false;
  }
  setSplashProgress(30);

  // ── Load settings ──
  try {
    state.settings = await window.novaAPI.getSettings();
  } catch (err) {
    console.error('Failed to load settings:', err);
    state.settings = {};
  }
  applyTheme(state.settings);
  setSplashProgress(50);

  // ── Load library ──
  try {
    state.videos = await window.novaAPI.getLibrary();
  } catch (err) {
    console.error('Failed to load library:', err);
    state.videos = [];
  }
  state.filteredVideos = [...state.videos];
  setSplashProgress(70);

  // ── Load playlists ──
  try {
    state.playlists = await window.novaAPI.getPlaylists();
  } catch (err) {
    console.error('Failed to load playlists:', err);
    state.playlists = [];
  }
  setSplashProgress(85);

  // ── Initialise UI components ──
  ui = {
    sidebar: new Sidebar(),
    library: new LibraryView(),
    videoScreen: new VideoScreen(),
    playerControls: new PlayerControls(),
    nowPlayingBar: new NowPlayingBar(),
    settingsPanel: new SettingsPanel(),
    trackMenu: new TrackMenu()
  };

  ui.sidebar.init({ onAddFolder, onRemoveFolder, onNavClick, onFolderClick });
  ui.library.init({ onVideoClick });
  ui.videoScreen.init({ onBack: () => closeVideoScreen(), onEngineEvent: handleEngineEvent });
  ui.playerControls.init({
    onPlayPause: togglePlayPause,
    onSeek,
    onVolume,
    onRate,
    onPrev: playPrevious,
    onNext: playNext,
    onShuffle, onRepeat,
    onFullscreen, onSettings: openSettings,
    onTracksMenu: (kind, tracks) => ui.trackMenu.show(kind, tracks)
  });
  ui.nowPlayingBar.init({
    onPlayPause: togglePlayPause,
    onPrev: playPrevious,
    onNext: playNext,
    onExpand: openVideoScreen
  });
  ui.settingsPanel.init({ onSettingsChange: applyTheme });
  ui.trackMenu.init({
    onAudioTrack: (id) => window.novaAPI.engineSetAudioTrack(id),
    onSubtitleTrack: (id) => window.novaAPI.engineSetSubtitleTrack(id),
    onChapter: (ch) => window.novaAPI.engineSetChapter(ch)
  });

  setSplashProgress(100);

  // First render
  render();
  setTimeout(() => {
    splash.classList.add('hidden');
    setTimeout(() => splash.remove(), 500);
  }, 200);

  // ── Listen for engine events ──
  window.novaAPI.onEngineEvent(handleEngineEvent);

  // ── Listen for "play file from command line" ──
  window.novaAPI.onPlayFile((filePath) => {
    const video = { id: 'vid_' + Buffer.from(filePath).toString('hex').slice(0,24), filePath, title: filePath.split(/[\\/]/).pop() };
    playVideo(video);
  });

  // ── Listen for scan progress ──
  window.novaAPI.onScanProgress((data) => {
    state.scanProgress = data;
    ui.library.updateScanProgress(data);
    if (data.stage === 'reading' || data.stage === 'complete') {
      refreshLibrary();
    }
  });

  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', handleKeyboard);
});

// ─── Render (push state to all components) ─────────────────────────
function render() {
  if (!ui) return;
  ui.sidebar.render(state);
  ui.library.render(state);
  ui.videoScreen.render(state);
  ui.playerControls.render(state);
  ui.nowPlayingBar.render(state);
}

// ─── Theme application ──────────────────────────────────────────────
function applyTheme(settings) {
  const root = document.documentElement;
  if (settings.accentColor) {
    root.style.setProperty('--accent', settings.accentColor);
    const hex = settings.accentColor.replace('#', '');
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      root.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.35)`);
      root.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.08)`);
      // Also update --green variables so the theme color propagates everywhere
      root.style.setProperty('--green', settings.accentColor);
      root.style.setProperty('--green-glow', `rgba(${r}, ${g}, ${b}, 0.35)`);
      root.style.setProperty('--green-soft', `rgba(${r}, ${g}, ${b}, 0.08)`);
    }
  }
  if (settings.backgroundMode === 'dim') {
    root.style.setProperty('--bg', '#0a0a0a');
    root.style.setProperty('--sidebar-bg', '#0f0f0f');
  } else {
    root.style.setProperty('--bg', '#000000');
    root.style.setProperty('--sidebar-bg', '#0a0a0a');
  }
  if (settings.activeFont === 'Figtree') {
    root.style.setProperty('--app-font', '"Figtree", system-ui, sans-serif');
  } else {
    root.style.setProperty('--app-font', '"Outfit", "Segoe UI", system-ui, sans-serif');
  }
}

// ─── Sidebar actions ────────────────────────────────────────────────
async function onAddFolder() {
  const folder = await window.novaAPI.pickFolder();
  if (!folder) return;
  await window.novaAPI.scanFolder(folder);
}

async function onRemoveFolder(folder) {
  const s = await window.novaAPI.getSettings();
  s.scanFolders = (s.scanFolders || []).filter(f => f !== folder);
  await window.novaAPI.setSetting('scanFolders', s.scanFolders);
  state.settings = s;
  render();
}

function onNavClick(section) {
  state.activeView = section;
  state.activeFolder = null;
  render();
}

function onFolderClick(folderPath) {
  state.activeView = 'folder';
  state.activeFolder = folderPath;
  render();
}

// ─── Library actions ────────────────────────────────────────────────
async function refreshLibrary() {
  state.videos = await window.novaAPI.getLibrary();
  state.filteredVideos = [...state.videos];
  render();
}

function onVideoClick(video) {
  const idx = state.filteredVideos.findIndex(v => v.id === video.id);
  state.queue = [...state.filteredVideos];
  state.queueIndex = idx >= 0 ? idx : 0;
  playVideo(video);
}

// ─── Video playback ─────────────────────────────────────────────────
async function playVideo(video) {
  if (!video) return;
  state.currentVideo = video;
  openVideoScreen();

  ui.playerControls.setLoading(true);

  // ── Engine-first playback ──
  // libVLC handles its own codecs (x265/HEVC, MKV, AVI, FLV, WMV, …) and
  // renders into a native child HWND embedded in the window. Only when
  // libVLC is unavailable do we fall back to Chromium's HTML5 <video>,
  // which can only decode browser-native codecs (H.264/VP9/AV1 in mp4/webm).
  if (state.engineAvailable) {
    ui.videoScreen.useEngine();
    try {
      const r = await window.novaAPI.engineLoad(video.filePath);
      if (!r?.ok) {
        // Engine rejected the file (rare) — fall back to HTML5 <video>.
        console.warn('[player] engineLoad returned', r, '— falling back to HTML5');
        ui.videoScreen.useFallback(video.filePath);
      } else {
        await window.novaAPI.enginePlay();
      }
    } catch (err) {
      console.warn('[player] libVLC load/play failed — falling back to HTML5:', err);
      ui.videoScreen.useFallback(video.filePath);
    }
  } else {
    ui.videoScreen.useFallback(video.filePath);
  }

  ui.playerControls.setLoading(false);

  // Record watch
  try {
    await window.novaAPI.recordWatch({
      videoId: video.id,
      position: 0,
      duration: video.duration || 0,
      completed: false
    });
  } catch (_) {}

  render();
}


function openVideoScreen() {
  state.isMiniPlayer = false;
  document.body.classList.add('player-active');
  document.getElementById('video-screen').classList.remove('hidden');
  setTimeout(() => ui?.videoScreen.reportRect(), 50);
  ui?.playerControls.startAutoHide();
}

function closeVideoScreen() {
  document.body.classList.remove('player-active');
  document.getElementById('video-screen').classList.add('hidden');
  state.isMiniPlayer = true;
  ui?.playerControls.stopAutoHide();
  // Stop whichever surface is active. stopFallback() releases the HTML5
  // <video> media (no-op if it isn't active). engineStop() halts libVLC.
  ui?.videoScreen.stopFallback();
  if (state.engineAvailable) {
    try { window.novaAPI.engineStop?.(); } catch (_) {}
  }
  // Shrink the child HWND to zero so the native video surface disappears.
  window.novaAPI.reportVideoRect({ x: 0, y: 0, width: 0, height: 0 });
}


async function togglePlayPause() {
  if (!state.currentVideo) return;
  if (state.engineAvailable) {
    try { await window.novaAPI.engineToggle(); return; } catch (_) {}
  }
  // Fallback: HTML5 <video> is the primary renderer
  ui.videoScreen.toggleFallback();
}

async function playNext() {
  if (state.queue.length === 0) return;
  state.queueIndex = (state.queueIndex + 1) % state.queue.length;
  const next = state.queue[state.queueIndex];
  await playVideo(next);
}

async function playPrevious() {
  if (state.queue.length === 0) return;
  state.queueIndex = (state.queueIndex - 1 + state.queue.length) % state.queue.length;
  const prev = state.queue[state.queueIndex];
  await playVideo(prev);
}

async function onSeek(timeSec) {
  if (state.engineAvailable) {
    try { await window.novaAPI.engineSeek(timeSec); return; } catch (_) {}
  }
  ui.videoScreen.seekFallback(timeSec);
}

async function onVolume(vol) {
  if (state.engineAvailable) {
    try { await window.novaAPI.engineSetVolume(vol); } catch (_) {}
  } else {
    ui.videoScreen.setFallbackVolume(vol);
  }
  state.settings.volume = vol;
  await window.novaAPI.setSetting('volume', vol);
}

async function onRate(rate) {
  if (state.engineAvailable) {
    try { await window.novaAPI.engineSetRate(rate); } catch (_) {}
  } else {
    ui.videoScreen.setFallbackRate(rate);
  }
  state.settings.playbackRate = rate;
  await window.novaAPI.setSetting('playbackRate', rate);
}

async function onShuffle(enabled) {
  state.settings.shuffle = enabled;
  await window.novaAPI.setSetting('shuffle', enabled);
}

async function onRepeat(mode) {
  state.settings.repeatMode = mode;
  await window.novaAPI.setSetting('repeatMode', mode);
}

async function onFullscreen() {
  state.isFullscreen = !state.isFullscreen;
  if (state.isFullscreen) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
}

function openSettings() {
  ui.settingsPanel.show(state.settings);
}

// ─── Engine event handler ───────────────────────────────────────────
function handleEngineEvent(evt) {
  if (!evt) return;
  switch (evt.type) {
    case 'time':
      ui?.playerControls.updateTime(evt.time, evt.duration);
      ui?.nowPlayingBar.updateTime(evt.time, evt.duration);
      break;
    case 'state':
      state.isPlaying = (evt.state === 'playing');
      // ── v2: Expose play state to CSS for EQ animation ──
      document.body.classList.toggle('is-playing', state.isPlaying);
      ui?.playerControls.updateState(evt.state);
      ui?.nowPlayingBar.updateState(evt.state);
      break;
    case 'end':
      playNext();
      break;
    case 'error':
      ui?.playerControls.showError(evt.message);
      break;
  }
}

// ─── Keyboard shortcuts ─────────────────────────────────────────────
function handleKeyboard(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch (e.code) {
    case 'Space':
      e.preventDefault();
      togglePlayPause();
      break;
    case 'ArrowRight':
      if (e.shiftKey) playNext();
      break;
    case 'ArrowLeft':
      if (e.shiftKey) playPrevious();
      break;
    case 'KeyF':
      onFullscreen();
      break;
    case 'Escape':
      if (state.isFullscreen) onFullscreen();
      else if (!document.getElementById('video-screen').classList.contains('hidden')) closeVideoScreen();
      break;
    case 'KeyM':
      const volBtn = document.getElementById('player-volume-btn');
      if (volBtn) volBtn.click();
      break;
    case 'ArrowUp':
      e.preventDefault();
      ui?.playerControls.adjustVolume(0.05);
      break;
    case 'ArrowDown':
      e.preventDefault();
      ui?.playerControls.adjustVolume(-0.05);
      break;
  }
}
