# NovaPlay

A premium Windows video player built with Electron + libVLC, featuring a pure-black AMOLED dark theme and NovaTune-inspired UI. Plays **every** video format VLC supports — fully offline, no network calls of any kind.

---

## Features

- **libVLC-powered playback** — every codec/container VLC supports (MKV, AVI, FLV, MOV, WMV, MP4, HEVC, AV1, WebM, VOB, TS, 3GP, OGV, and dozens more)
- **Pure black AMOLED UI** with a single soft-glowing accent color (NovaTune signature green by default, configurable)
- **Borderless floating video** — no VLC chrome, no OS chrome, just NovaPlay
- **Smooth virtual-scroll library** with slot-pool recycling + velocity-gated overscan (reused from NovaTune)
- **Blur-up thumbnail loading** — first paint is a tiny blurred placeholder, crossfades to the HQ version when loaded
- **Glowing progress bar** with hover bubble showing timestamp
- **Fade-in/out controls** — controls hide after inactivity, reappear on mouse move
- **Mini now-playing bar** at the bottom, expandable to full player view
- **Settings panel** matching NovaTune's patterns (theme, accent, default folders, playback behavior)
- **Local SQLite database** for library, watch history, playlists, settings — no cloud, no accounts
- **Local cache** for thumbnails, generated via ffmpeg (with graceful fallback to a sharp-drawn placeholder if ffmpeg isn't installed)
- **Offline-bundled Outfit fonts** (300–700 weights) — no Google Fonts at runtime
- **File associations** — double-click any video file in Explorer → opens NovaPlay
- **Keyboard shortcuts** — Space (play/pause), F (fullscreen), ←/→ (seek), Shift+←/→ (prev/next), ↑/↓ (volume), M (mute), Esc (exit fullscreen / back to library)

---

## Project structure

```
novaplay/
├── app-shell/              Electron main process
│   ├── main.js             Entry: window creation, protocol registration
│   ├── preload.js          contextBridge — exposes window.novaAPI
│   ├── ipc.js              All IPC handlers (library, settings, engine)
│   ├── windowManager.js   Window state persistence
│   └── fileLogger.js       File-based logger (packaged-exe friendly)
├── video-engine/           libVLC integration
│   ├── VlcBinding.js       koffi FFI bindings to libvlc.dll
│   ├── VideoEngine.js      Player orchestration + HWND embedding
│   ├── User32.js           user32.dll bindings (child window creation)
│   └── FallbackEngine.js   HTML5 <video> fallback when libVLC missing
├── ui/                     Renderer (HTML/CSS/JS)
│   ├── index.html          Main HTML
│   ├── renderer.js         Entry + global state machine
│   ├── components/         UI components
│   │   ├── Utils.js
│   │   ├── VirtualList.js  Slot-pool virtual scroller (reused from NovaTune)
│   │   ├── Sidebar.js
│   │   ├── LibraryView.js  Video grid with blur-up thumbnails
│   │   ├── VideoScreen.js  Full player view + child HWND positioning
│   │   ├── PlayerControls.js
│   │   ├── NowPlayingBar.js Mini player
│   │   ├── SettingsPanel.js
│   │   └── TrackMenu.js     Audio/subtitle/chapter picker
│   └── styles/
│       ├── main.css        Pure-black AMOLED theme + glow
│       └── outfit.css      Offline font declarations
├── local-data/             Storage layer
│   ├── database.js         better-sqlite3 wrapper + schema
│   ├── settingsStore.js    JSON settings (serialized read-modify-write)
│   ├── fileScanner.js      Recursive folder walker for video files
│   └── cache.js            Thumbnail generator (ffmpeg + sharp fallback)
├── assets/
│   ├── icons/              icon.png, icon.ico
│   └── fonts/              Outfit TTFs (300-700, offline-bundled)
├── scripts/
│   ├── download-fonts.js  (optional) re-fetch Outfit TTFs
│   ├── make_icons.js      Generate app icon
│   └── check-deps.js      Postinstall sanity check
├── package.json
├── electron.config.js      electron-builder config
└── README.md
```

---

## How libVLC integration works

NovaPlay uses **HWND embedding** — the cleanest, smoothest approach for Electron on Windows:

1. The main process loads `libvlc.dll` via **koffi** (FFI) — no native compilation required
2. A child `WS_CHILD` window is created as a child of the Electron BrowserWindow's HWND (via `user32.dll` `CreateWindowExW`)
3. The child HWND is passed to `libvlc_media_player_set_hwnd()` — libVLC renders directly into it
4. The renderer reports the screen-space rect of its `video-area` element via IPC (`nova:video-rect`)
5. The main process uses `SetWindowPos` to keep the child HWND aligned with the renderer's rect
6. When controls fade in, the renderer reports a slightly shorter rect — the child HWND shrinks, revealing the controls strip beneath, giving the illusion of controls overlaying the video

The result: hardware-accelerated video with zero per-frame IPC overhead, smooth at any resolution / framerate.

A **vmem callback** approach (libVLC decodes to memory, JS paints to canvas) is also feasible but suffers from per-frame IPC overhead at HD/4K. The HWND embedding approach is preferred for production use.

---

## Requirements

- **Windows 10 or later** (recommended) — supports full libVLC embedding via HWND
- **Node.js 18+** and **npm**
- **VLC media player** installed (provides `libvlc.dll`) — or set `NOVAPLAY_LIBVLC` env var to point at a `libvlc.dll`/`libvlc.so`/`libvlc.dylib`
- **ffmpeg** (optional) — for thumbnail generation. Without it, NovaPlay generates branded placeholder thumbnails via sharp.

### Linux / macOS

NovaPlay runs on Linux/macOS too, but:
- The child HWND embedding (Windows `user32.dll`) is unavailable — the app falls back to the HTML5 `<video>` engine for browser-native codecs (mp4/webm)
- For full codec support on Linux/macOS, the libVLC binding still loads (`libvlc.so` / `libvlc.dylib`), but you'll need to extend `VideoEngine.js` to use libVLC's X11/NSView embedding instead of HWND

---

## Building from source

1. **Clone + install dependencies**

   ```bash
   cd novaplay
   npm install
   ```

2. **(Optional) Re-download fonts** — fonts are already bundled, but if you want to refresh them:

   ```bash
   npm run download-fonts
   ```

3. **Run in development**

   ```bash
   npm run dev
   ```

   Or build the Windows installer:

   ```bash
   npm run build
   ```

   The installer will be at `dist/NovaPlay Setup x.y.z.exe`.

4. **Run the packaged app** — double-click `NovaPlay.exe` after install.

---

## Configuration

### Pointing at a custom libvlc

If VLC isn't installed at the default location (`C:\Program Files\VideoLAN\VLC\libvlc.dll`), set:

```cmd
set NOVAPLAY_LIBVLC=C:\path\to\libvlc.dll
```

Or in PowerShell:
```powershell
$env:NOVAPLAY_LIBVLC = "C:\path\to\libvlc.dll"
```

### Pointing at a custom ffmpeg

```cmd
set NOVAPLAY_FFMPEG=C:\path\to\ffmpeg.exe
```

### Settings file

User settings live at `%APPDATA%\NovaPlay\settings.json`. Database + cache are in the same folder.

---

## Architecture decisions

### Why koffi (FFI) instead of a C++ native addon?

- **No native compilation required** — `npm install` just works, no Visual Studio / node-gyp setup needed
- **Same libvlc.dll** that ships with VLC — no risk of binary incompatibility
- **Cross-platform** — same code path works on Windows/Linux/macOS (different shared libraries, same FFI)

### Why HWND embedding instead of vmem callbacks?

- **Hardware-accelerated** — libVLC uses DXVA2/D3D11 for hardware decoding, paints directly to the GPU surface of the child HWND
- **Zero per-frame IPC overhead** — no JS callback per frame, no SharedArrayBuffer gymnastics
- **Proven approach** — same technique used by WebChimera.js and other Electron+VLC wrappers

### Why better-sqlite3 (same as NovaTune)?

- **Synchronous** — no callback hell, simpler code
- **Fastest** native SQLite binding for Node.js
- **Mature** — handles the schema migrations + WAL mode + pragmas cleanly

### Why pure black instead of NovaTune's #121212?

The user specifically requested "pure black / AMOLED-style dark theme" — pushed one shade darker than NovaTune for true OLED black (saves battery on OLED laptops, looks more cinematic for video). All other design tokens (accent color, typography, spacing, radii) match NovaTune exactly.

---

## License

MIT. See [LICENSE](LICENSE).

---

## Acknowledgements

- **NovaTune** — UI architecture, virtual list pattern, blur-up thumbnail loader, IPC patterns, settings store approach. NovaPlay reuses these directly.
- **VideoLAN** — libVLC engine, the most codec-complete media library on the planet.
- **koffi** — modern Node.js FFI that makes loading libvlc.dll at runtime trivial.
- **better-sqlite3** — fast synchronous SQLite for Node.js.
- **sharp** — image processing for thumbnail generation.
- **Outfit** — typeface by [Jeremy Dooley](https://fonts.google.com/specimen/Outfit).
