/**
 * NovaPlay — VLC Dynamic Binding (via koffi)
 *
 * Loads libvlc.dll / libvlc.so / libvlc.dylib at runtime via koffi's FFI
 * layer — no native compilation required. The user just needs VLC
 * installed (or libvlc on their PATH).
 *
 * All function declarations mirror the public libvlc 3.x API surface:
 *   https://videolan.videolan.videolan/vlc-3.0/gen/html/group__libvlc__media__player.html
 *
 * We declare only the functions NovaPlay uses. Add new ones here as needed.
 *
 * SAFETY: every function call goes through koffi which validates pointer
 * types against the declared signature. NULL pointers are returned as
 * null (not undefined) so callers can do strict-equal null checks.
 */

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');

// ─── Library resolution ────────────────────────────────────────────
// Search order:
//   1. NOVAPLAY_LIBVLC env var (absolute path to libvlc.so/dll)
//   2. Bundled libvlc next to app.asar (./bin/libvlc.dll)
//   3. Common Windows install paths (VideoLAN)
//   4. Standard Unix paths (/usr/lib, /usr/local/lib, /opt/homebrew/lib)
//   5. Default library name (system loader / PATH)
function findLibvlc() {
  const candidates = [];
  if (process.env.NOVAPLAY_LIBVLC) candidates.push(process.env.NOVAPLAY_LIBVLC);

  try {
    const appRoot = require('electron')?.app?.getAppPath?.() || __dirname;
    candidates.push(path.join(appRoot, '..', 'bin', process.platform === 'win32' ? 'libvlc.dll' : 'libvlc.so'));
  } catch (_) {}

  if (process.platform === 'win32') {
    candidates.push('C:\\Program Files\\VideoLAN\\VLC\\libvlc.dll');
    candidates.push('C:\\Program Files (x86)\\VideoLAN\\VLC\\libvlc.dll');
    candidates.push('libvlc.dll');
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/VLC.app/Contents/MacOS/lib/libvlc.dylib');
    candidates.push('/usr/local/lib/libvlc.dylib');
    candidates.push('/opt/homebrew/lib/libvlc.dylib');
    candidates.push('libvlc.dylib');
  } else {
    candidates.push('/usr/lib/libvlc.so');
    candidates.push('/usr/lib/x86_64-linux-gnu/libvlc.so.5');
    candidates.push('/usr/local/lib/libvlc.so');
    candidates.push('libvlc.so.5');
    candidates.push('libvlc.so');
  }

  for (const c of candidates) {
    if (c.includes(path.sep) || c.includes('/')) {
      if (fs.existsSync(c)) {
        console.log('[vlc] found at', c);
        return c;
      }
    } else {
      // Try system loader via koffi — koffi.find() probes the dynamic linker path
      try {
        koffi.find(c);
        console.log('[vlc] found on system loader:', c);
        return c;
      } catch (_) {}
    }
  }
  return null;
}

let _lib = null;
let _decls = null;
let _available = false;

/** Reset the cached load state so a fresh load() attempt can be made. */
function resetCache() {
  _lib = null;
  _decls = null;
  _available = false;
}

// ─── Koffi types — registered once globally ───────────────────────
// koffi.proto() and koffi.pointer() register into a global type
// registry and throw "Duplicate type name" if called twice with the
// same name. Keep them as module-level singletons.
let _koffi_types = null;
function getTypes() {
  if (_koffi_types) return _koffi_types;
  const void_p  = koffi.pointer('void');
  const char_p  = koffi.pointer('char');
  const char_pp = koffi.pointer(char_p);
  const void_fn         = koffi.proto('void vlc_void_cb()');
  const libvlc_callback_t = koffi.proto('void vlc_event_cb(void *p_event, void *p_data)');
  _koffi_types = { void_p, char_p, char_pp, void_fn, libvlc_callback_t };
  return _koffi_types;
}

function load() {
  if (_lib) return _decls;
  const libPath = findLibvlc();
  if (!libPath) {
    _available = false;
    throw new Error('libvlc not found — install VLC or set NOVAPLAY_LIBVLC');
  }

  try {
    _lib = koffi.load(libPath);
  } catch (err) {
    _available = false;
    throw new Error(`koffi failed to load ${libPath}: ${err.message}`);
  }

  // ─── Get the shared type singletons ───────────────────────────
  const { void_p, char_p, char_pp, void_fn, libvlc_callback_t } = getTypes();


  // ─── Core ────────────────────────────────────────────────────────
  _decls = {
    libvlc_new:                _lib.func('void * libvlc_new(int argc, char **argv)'),
    libvlc_release:            _lib.func('void libvlc_release(void *inst)'),
    libvlc_get_version:       _lib.func('const char * libvlc_get_version()'),
    libvlc_set_user_agent:    _lib.func('void libvlc_set_user_agent(void *inst, const char *name, const char *http)'),

    // Media
    libvlc_media_new_path:     _lib.func('void * libvlc_media_new_path(void *inst, const char *path)'),
    libvlc_media_release:      _lib.func('void libvlc_media_release(void *media)'),
    libvlc_media_get_meta:     _lib.func('const char * libvlc_media_get_meta(void *media, int e_meta)'),
    libvlc_media_get_duration: _lib.func('int64 libvlc_media_get_duration(void *media)'),
    libvlc_media_parse_async:  _lib.func('void libvlc_media_parse_async(void *media)'),
    libvlc_media_parse_stop:   _lib.func('void libvlc_media_parse_stop(void *media)'),

    // Media player
    libvlc_media_player_new_from_media: _lib.func('void * libvlc_media_player_new_from_media(void *media)'),
    libvlc_media_player_release:       _lib.func('void libvlc_media_player_release(void *mp)'),
    libvlc_media_player_play:           _lib.func('int libvlc_media_player_play(void *mp)'),
    libvlc_media_player_pause:         _lib.func('void libvlc_media_player_pause(void *mp)'),
    libvlc_media_player_stop:          _lib.func('void libvlc_media_player_stop(void *mp)'),
    libvlc_media_player_set_media:     _lib.func('void libvlc_media_player_set_media(void *mp, void *media)'),

    libvlc_media_player_get_time:      _lib.func('int64 libvlc_media_player_get_time(void *mp)'),
    libvlc_media_player_set_time:      _lib.func('void libvlc_media_player_set_time(void *mp, int64 time)'),
    libvlc_media_player_get_length:    _lib.func('int64 libvlc_media_player_get_length(void *mp)'),
    libvlc_media_player_get_position:  _lib.func('float libvlc_media_player_get_position(void *mp)'),
    libvlc_media_player_set_position:  _lib.func('void libvlc_media_player_set_position(void *mp, float pos)'),
    libvlc_media_player_get_rate:       _lib.func('float libvlc_media_player_get_rate(void *mp)'),
    libvlc_media_player_set_rate:       _lib.func('int libvlc_media_player_set_rate(void *mp, float rate)'),

    libvlc_media_player_get_state:      _lib.func('int libvlc_media_player_get_state(void *mp)'),
    libvlc_media_player_get_fps:         _lib.func('float libvlc_media_player_get_fps(void *mp)'),
    libvlc_media_player_has_vout:        _lib.func('int libvlc_media_player_has_vout(void *mp)'),
    libvlc_media_player_is_seekable:    _lib.func('int libvlc_media_player_is_seekable(void *mp)'),

    // Volume + audio
    libvlc_audio_get_volume:    _lib.func('int libvlc_audio_get_volume(void *mp)'),
    libvlc_audio_set_volume:   _lib.func('int libvlc_audio_set_volume(void *mp, int vol)'),
    libvlc_audio_get_mute:      _lib.func('int libvlc_audio_get_mute(void *mp)'),
    libvlc_audio_set_mute:      _lib.func('void libvlc_audio_set_mute(void *mp, int status)'),
    libvlc_audio_get_track:     _lib.func('int libvlc_audio_get_track(void *mp)'),
    libvlc_audio_set_track:     _lib.func('int libvlc_audio_set_track(void *mp, int i_track)'),
    libvlc_audio_get_track_description: _lib.func('void * libvlc_audio_get_track_description(void *mp)'),

    // Subtitles
    libvlc_video_get_spu:        _lib.func('int libvlc_video_get_spu(void *mp)'),
    libvlc_video_set_spu:        _lib.func('int libvlc_video_set_spu(void *mp, int i_spu)'),
    libvlc_video_get_spu_description: _lib.func('void * libvlc_video_get_spu_description(void *mp)'),

    // Chapters + titles
    libvlc_media_player_get_chapter:  _lib.func('int libvlc_media_player_get_chapter(void *mp)'),
    libvlc_media_player_set_chapter:  _lib.func('int libvlc_media_player_set_chapter(void *mp, int chapter)'),
    libvlc_media_player_get_chapter_count: _lib.func('int libvlc_media_player_get_chapter_count(void *mp)'),
    libvlc_media_player_get_title_count: _lib.func('int libvlc_media_player_get_title_count(void *mp)'),

    // Window handle (HWND on Windows, NSView on macOS, X Window on Linux)
    libvlc_media_player_set_hwnd:  _lib.func('void libvlc_media_player_set_hwnd(void *mp, void *hwnd)'),
    libvlc_media_player_get_hwnd:  _lib.func('void * libvlc_media_player_get_hwnd(void *mp)'),

    // Track description walker (linked list returned by libvlc)
    libvlc_track_description_release: _lib.func('void libvlc_track_description_release(void *td)'),

    // Event manager
    libvlc_media_player_event_manager: _lib.func('void * libvlc_media_player_event_manager(void *mp)'),
    libvlc_event_attach:              _lib.func('int libvlc_event_attach(void *em, int type, void *cb, void *data)'),
    libvlc_event_detach:              _lib.func('void libvlc_event_detach(void *em, int type, void *cb, void *data)')
  };

  _available = true;
  console.log('[vlc] libvlc loaded:', _decls.libvlc_get_version());
  return _decls;
}

function isAvailable() {
  if (_available) return true;
  try { load(); return _available; } catch (_) { return false; }
}

/**
 * Return the directory that contains libvlc.dll (the VLC install root).
 * Used by VideoEngine to set VLC_PLUGIN_PATH and PATH before libvlc_new.
 */
function getVlcDir() {
  const p = findLibvlc();
  if (!p) return null;
  // If it's an absolute path to the DLL, return its directory.
  // If it's just a bare name (system loader), fall back to common paths.
  if (require('path').isAbsolute(p)) {
    return require('path').dirname(p);
  }
  // Bare name — try common Windows paths
  const common = [
    'C:\\Program Files\\VideoLAN\\VLC',
    'C:\\Program Files (x86)\\VideoLAN\\VLC'
  ];
  for (const d of common) {
    if (require('fs').existsSync(require('path').join(d, 'libvlc.dll'))) return d;
  }
  return null;
}

// libvlc_event_e enum (subset we care about — see vlc/libvlc_events.h)
const EventType = {
  MediaChanged:           0x0000,
  Opening:                0x0001,
  Buffering:              0x0002,
  Playing:                0x0003,
  Paused:                 0x0004,
  Stopped:                0x0005,
  Forward:                0x0006,
  Backward:               0x0007,
  EndReached:             0x0008,
  EncounteredError:       0x0009,
  TimeChanged:            0x000A,
  PositionChanged:        0x000B,
  SeekableChanged:        0x000C,
  LengthChanged:          0x000D,
  TitleChanged:           0x000E,
  ChapterChanged:         0x000F,
  ESAdded:                0x0010,
  ESDeleted:               0x0011,
  ESSelected:              0x0012,
  MediaStateChanged:      0x0022,
  MediaParsedChanged:     0x0023
};

module.exports = { load, isAvailable, resetCache, getVlcDir, EventType };
