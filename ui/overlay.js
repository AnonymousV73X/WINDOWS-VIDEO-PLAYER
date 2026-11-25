/**
 * NovaPlay — Overlay Renderer
 *
 * Runs in the transparent overlay BrowserWindow that sits above the VLC
 * native HWND. Communicates with the main window renderer via IPC relay
 * through the main process.
 *
 * All engine calls are forwarded via nova:overlay-* IPC channels.
 */

const root = document.getElementById("overlay-root");
let _visible = false;
let _time = 0,
  _duration = 0,
  _isPlaying = false;
let _volume = 80;
let _isDraggingProgress = false;
let _isDraggingVolume = false;
let _autoHideTimer = null;
let _autoHideMs = 2500;
let _accentColor = "#FF8800";

// ─── Auto-hide ────────────────────────────────────────────────────────
function showControls() {
  if (!_visible) return;
  root.classList.remove("hidden");
  resetAutoHide();
}

function hideControls() {
  root.classList.add("hidden");
}

function resetAutoHide() {
  if (_autoHideTimer) clearTimeout(_autoHideTimer);
  _autoHideTimer = setTimeout(() => {
    if (!_isDraggingProgress && !_isDraggingVolume && !_menu) hideControls();
  }, _autoHideMs);
}

document.addEventListener("mousemove", showControls);
document.addEventListener("mousedown", showControls);

// ─── Show/Hide overlay ───────────────────────────────────────────────
window.novaAPI.on("nova:overlay-show", (data) => {
  _visible = true;
  if (data && data.title)
    document.getElementById("ov-video-title").textContent = data.title;
  if (data && data.accentColor) {
    document.documentElement.style.setProperty("--green", data.accentColor);
    document.documentElement.style.setProperty("--accent", data.accentColor);
  }
  showControls();
});

window.novaAPI.on("nova:overlay-hide", () => {
  _visible = false;
  hideControls();
});

// ─── Engine events forwarded from main window ─────────────────────────
window.novaAPI.on("nova:engine-event", (event) => {
  if (!event) return;
  if (event.type === "time") {
    _time = event.time || 0;
    _duration = event.duration || 0;
    updateProgress();
    if (event.state) {
      const p =
        event.state === "playing" ||
        event.state === "buffering" ||
        event.state === "opening";
      if (p !== _isPlaying) {
        _isPlaying = p;
        updatePlayPauseIcon();
      }
    }
  } else if (event.type === "state") {
    _isPlaying = event.state === "playing";
    updatePlayPauseIcon();
  }
});

// ─── Progress bar ─────────────────────────────────────────────────────
const progressWrap = document.getElementById("ov-progress-wrap");
const progressFill = document.getElementById("ov-progress-fill");
const progressHandle = document.getElementById("ov-progress-handle");
const progressBubble = document.getElementById("ov-progress-bubble");
const timeCurrent = document.getElementById("ov-time-current");
const timeTotal = document.getElementById("ov-time-total");

function formatTime(s) {
  if (!isFinite(s) || s < 0) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function updateProgress() {
  const pct = _duration > 0 ? Math.min(1, _time / _duration) * 100 : 0;
  progressFill.style.width = pct + "%";
  progressHandle.style.left = pct + "%";
  timeCurrent.textContent = formatTime(_time);
  timeTotal.textContent = formatTime(_duration);
}

progressWrap.addEventListener("mouseenter", () => {
  progressWrap.addEventListener("mousemove", onProgressHover);
  progressBubble.style.opacity = "1";
});
progressWrap.addEventListener("mouseleave", () => {
  progressWrap.removeEventListener("mousemove", onProgressHover);
  progressBubble.style.opacity = "0";
});

function onProgressHover(e) {
  const rect = progressWrap.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  progressBubble.textContent = formatTime(pct * _duration);
  progressBubble.style.left = pct * 100 + "%";
}

progressWrap.addEventListener("mousedown", (e) => {
  _isDraggingProgress = true;
  progressWrap.classList.add("dragging");
  seek(e);
  const onMove = (e) => seek(e);
  const onUp = () => {
    _isDraggingProgress = false;
    progressWrap.classList.remove("dragging");
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    resetAutoHide();
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
});

function seek(e) {
  const rect = progressWrap.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const time = pct * _duration;
  window.novaAPI.send("nova:overlay-seek", time);
}

// ─── Volume ───────────────────────────────────────────────────────────
const volumeWrap = document.getElementById("ov-volume-wrap");
const volumeFill = document.getElementById("ov-volume-fill");
const volumeHandle = document.getElementById("ov-volume-handle");
const volumeBtn = document.getElementById("ov-volume-btn");

volumeWrap.addEventListener("mousedown", (e) => {
  _isDraggingVolume = true;
  setVolume(e);
  const onMove = (e) => setVolume(e);
  const onUp = () => {
    _isDraggingVolume = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    resetAutoHide();
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
});

function setVolume(e) {
  const rect = volumeWrap.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  _volume = pct * 100;
  volumeFill.style.width = _volume + "%";
  volumeHandle.style.left = _volume + "%";
  window.novaAPI.send("nova:overlay-volume", _volume / 100);
}

volumeBtn.addEventListener("click", () => {
  window.novaAPI.send("nova:overlay-mute");
});

// ─── Transport ────────────────────────────────────────────────────────
const playPauseBtn = document.getElementById("ov-play-pause-btn");
const playPauseIcon = document.getElementById("ov-play-pause-icon");
const prevBtn = document.getElementById("ov-prev-btn");
const nextBtn = document.getElementById("ov-next-btn");
const shuffleBtn = document.getElementById("ov-shuffle-btn");
const repeatBtn = document.getElementById("ov-repeat-btn");
const fullscreenBtn = document.getElementById("ov-fullscreen-btn");
const speedPill = document.getElementById("ov-speed-pill");

const PLAY_PATH = "M6 4l12 8-12 8V4z";
const PAUSE_PATH = "M6 19V5M18 19V5";

function updatePlayPauseIcon() {
  const path = playPauseIcon.querySelector("path") || playPauseIcon;
  if (_isPlaying) {
    playPauseIcon.innerHTML =
      '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>';
  } else {
    playPauseIcon.innerHTML =
      '<path d="M6 4l12 8-12 8V4z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
  }
}

playPauseBtn.addEventListener("click", () => {
  _isPlaying = !_isPlaying;
  updatePlayPauseIcon();
  window.novaAPI.send("nova:overlay-toggle");
});
window.novaAPI.on("nova:overlay-show", () => updatePlayPauseIcon());
prevBtn.addEventListener("click", () =>
  window.novaAPI.send("nova:overlay-prev"),
);
nextBtn.addEventListener("click", () =>
  window.novaAPI.send("nova:overlay-next"),
);
shuffleBtn.addEventListener("click", () =>
  window.novaAPI.send("nova:overlay-shuffle"),
);
repeatBtn.addEventListener("click", () =>
  window.novaAPI.send("nova:overlay-repeat"),
);
fullscreenBtn.addEventListener("click", () =>
  window.novaAPI.send("nova:overlay-fullscreen"),
);

let _speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
let _speedIdx = 3;
speedPill.addEventListener("click", () => {
  _speedIdx = (_speedIdx + 1) % _speeds.length;
  const rate = _speeds[_speedIdx];
  speedPill.textContent = rate + "x";
  window.novaAPI.send("nova:overlay-rate", rate);
});

// ─── Back button ──────────────────────────────────────────────────────
document.getElementById("ov-back-btn").addEventListener("click", () => {
  window.novaAPI.send("nova:overlay-back");
});

// ─── Action buttons ───────────────────────────────────────────────────
let _menu = null,
  _menuType = null;
function closeMenu() {
  if (_menu) {
    _menu.remove();
    _menu = null;
    _menuType = null;
  }
  resetAutoHide();
}
async function openMenu(type) {
  if (_menuType === type) {
    closeMenu();
    return;
  }
  closeMenu();
  let t = { audio: [], subtitles: [], chapters: 0, currentChapter: 0 };
  try {
    t = (await window.novaAPI.invoke("nova:engine-tracks")) || t;
  } catch (_) {}
  const items = [];
  let title = "",
    onPick = null;
  if (type === "audio") {
    title = "Audio";
    t.audio.forEach((x) =>
      items.push({ label: x.name, sel: x.selected, id: x.id }),
    );
    onPick = (id) => window.novaAPI.invoke("nova:engine-audio-track", id);
  } else if (type === "subtitle") {
    title = "Subtitles";
    const off = !t.subtitles.some((x) => x.selected && x.id !== -1);
    items.push({ label: "Off", sel: off, id: -1 });
    t.subtitles
      .filter((x) => x.id !== -1)
      .forEach((x) => items.push({ label: x.name, sel: x.selected, id: x.id }));
    onPick = (id) => window.novaAPI.invoke("nova:engine-subtitle-track", id);
  } else {
    title = "Chapters";
    for (let i = 0; i < t.chapters; i++)
      items.push({
        label: "Chapter " + (i + 1),
        sel: i === t.currentChapter,
        id: i,
      });
    onPick = (id) => window.novaAPI.invoke("nova:engine-chapter", id);
  }
  const m = document.createElement("div");
  m.style.cssText =
    "position:fixed;top:60px;right:16px;min-width:220px;max-width:340px;max-height:60vh;overflow:auto;" +
    "background:rgba(20,20,20,.97);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:6px;" +
    'box-shadow:0 10px 30px rgba(0,0,0,.6);z-index:100002;color:#fff;font:500 13px "Outfit","Segoe UI",sans-serif;pointer-events:auto;';
  const h = document.createElement("div");
  h.textContent = title;
  h.style.cssText =
    "padding:6px 10px;font-size:11px;letter-spacing:.8px;text-transform:uppercase;opacity:.6;";
  m.appendChild(h);
  if (!items.length) {
    const e = document.createElement("div");
    e.textContent = "None available";
    e.style.cssText = "padding:8px 10px;opacity:.6;";
    m.appendChild(e);
  }
  for (const it of items) {
    const r = document.createElement("div");
    r.textContent = (it.sel ? "\u2713  " : "\u2003 ") + it.label;
    r.style.cssText =
      "padding:8px 10px;border-radius:8px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" +
      (it.sel ? "background:rgba(255,255,255,.1);" : "");
    r.onmouseenter = () => {
      r.style.background = "rgba(255,255,255,.16)";
    };
    r.onmouseleave = () => {
      r.style.background = it.sel ? "rgba(255,255,255,.1)" : "";
    };
    r.onclick = async () => {
      await onPick(it.id);
      closeMenu();
    };
    m.appendChild(r);
  }
  m.addEventListener("mousedown", (e) => e.stopPropagation());
  document.body.appendChild(m);
  _menu = m;
  _menuType = type;
  if (_autoHideTimer) clearTimeout(_autoHideTimer);
}
document.addEventListener("mousedown", (e) => {
  if (_menu && !e.target.closest(".player-action-btn")) closeMenu();
});
document
  .getElementById("ov-audio-tracks")
  .addEventListener("click", () => openMenu("audio"));
document
  .getElementById("ov-subtitle-tracks")
  .addEventListener("click", () => openMenu("subtitle"));
document
  .getElementById("ov-chapters")
  .addEventListener("click", () => openMenu("chapters"));

// ─── Window controls ─────────────────────────────────────────────────
document
  .getElementById("ov-minimize")
  .addEventListener("click", () => window.novaAPI.send("nova:window-minimize"));
document
  .getElementById("ov-maximize")
  .addEventListener("click", () => window.novaAPI.send("nova:window-maximize"));
document
  .getElementById("ov-close")
  .addEventListener("click", () => window.novaAPI.send("nova:window-close"));
