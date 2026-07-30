/**
 * NovaPlay — User32.dll bindings (Windows-only)
 *
 * Creates + manages a child HWND of the Electron BrowserWindow so libVLC
 * can render video into it. On non-Windows platforms, all functions
 * throw — the VideoEngine falls back to no-embedding mode.
 *
 * The child HWND uses WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS so it
 * renders above Chromium's content area but stays within the parent's
 * client area. This is the standard approach for embedded video in
 * Electron apps on Windows.
 *
 * Track description walker: libvlc returns a linked list of
 * libvlc_track_description_t structs. We walk it via Buffer reads.
 */

const koffi = require('koffi');

let _user32 = null;
let _decls = null;

function load() {
  if (_decls) return _decls;
  if (process.platform !== 'win32') {
    throw new Error('User32 only available on Windows');
  }

  _user32 = koffi.load('user32.dll');

  _decls = {
    CreateWindowExW: _user32.func('void * CreateWindowExW(uint32 dwExStyle, const char16_t *lpClassName, const char16_t *lpWindowName, uint32 dwStyle, int32 x, int32 y, int32 nWidth, int32 nHeight, void *hWndParent, void *hMenu, void *hInstance, void *lpParam)'),
    DestroyWindow:    _user32.func('int32 DestroyWindow(void *hWnd)'),
    MoveWindow:       _user32.func('int32 MoveWindow(void *hWnd, int32 x, int32 y, int32 nWidth, int32 nHeight, int32 bRepaint)'),
    ShowWindow:       _user32.func('int32 ShowWindow(void *hWnd, int32 nCmdShow)'),
    SetWindowPos:     _user32.func('int32 SetWindowPos(void *hWnd, void *hWndInsertAfter, int32 x, int32 y, int32 cx, int32 cy, uint32 uFlags)'),
    SetParent:        _user32.func('void * SetParent(void *hWndChild, void *hWndNewParent)'),
    InvalidateRect:   _user32.func('int32 InvalidateRect(void *hWnd, void *lpRect, int32 bErase)'),
    UpdateWindow:     _user32.func('int32 UpdateWindow(void *hWnd)'),

    // Window style constants
    WS_CHILD:         0x40000000,
    WS_VISIBLE:       0x10000000,
    WS_CLIPSIBLINGS:  0x04000000,
    WS_CLIPCHILDREN:  0x02000000,
    WS_EX_LAYERED:    0x00080000,

    SWP_NOZORDER:     0x0004,
    SWP_NOACTIVATE:   0x0010,
    SWP_SHOWWINDOW:   0x0040,

    SW_HIDE:          0,
    SW_SHOWNORMAL:    1
  };

  return _decls;
}

/**
 * Create a child HWND of the given parent (Buffer of native handle).
 * Returns the child HWND as a Buffer/koffi pointer.
 */
function createChildWindow(parentHwndBuf) {
  const u = load();
  // We pass className as "Static" — a built-in Win32 class that's
  // safe to instantiate as a child window. We don't need a custom class
  // because we never paint to it ourselves (libVLC will paint).
  const className = Buffer.from('Static\0', 'utf16le');
  const windowName = Buffer.from('NovaPlayVideo\0', 'utf16le');

  // Electron returns native handle as a Buffer containing the HWND pointer
  let parentPtr = parentHwndBuf;
  if (Buffer.isBuffer(parentHwndBuf)) {
    parentPtr = parentHwndBuf.length >= 8 ? parentHwndBuf.readBigUInt64LE(0) : parentHwndBuf.readUInt32LE(0);
  }

  const hwnd = u.CreateWindowExW(
    0,
    'Static',
    'NovaPlayVideo',
    u.WS_CHILD | u.WS_VISIBLE | u.WS_CLIPSIBLINGS | u.WS_CLIPCHILDREN,
    0, 0, 10, 10,
    parentPtr,
    null, null, null
  );

  if (!hwnd) throw new Error('CreateWindowExW returned null');
  return hwnd;
}

function moveWindow(hwnd, x, y, w, h, repaint = true) {
  const u = load();
  // Use SetWindowPos with NOZORDER + NOACTIVATE for cleaner behaviour
  return u.SetWindowPos(hwnd, null, Math.round(x), Math.round(y), Math.round(w), Math.round(h),
    u.SWP_NOZORDER | u.SWP_NOACTIVATE | u.SWP_SHOWWINDOW);
}

function showWindow(hwnd, visible = true) {
  const u = load();
  return u.ShowWindow(hwnd, visible ? u.SHOWNORMAL : u.SW_HIDE);
}

function destroyWindow(hwnd) {
  const u = load();
  return u.DestroyWindow(hwnd);
}

/**
 * Walk a libvlc_track_description_t linked list and return a JS array.
 *
 * struct libvlc_track_description_t {
 *   int   i_id;
 *   char *psz_name;
 *   struct libvlc_track_description_t *p_next;
 * };
 *
 * On 64-bit: 4-byte int + 4-byte padding + 8-byte pointer + 8-byte pointer = 24 bytes per node.
 */
function readTrackDescription(headPtr, currentId) {
  if (!headPtr) return [];
  const result = [];
  // Use koffi to read the struct fields directly.
  // We declare a struct + pointer-to-struct and walk the chain.
  try {
    const TrackDesc = koffi.struct('libvlc_track_description_t', {
      i_id:   'int32',
      _pad:   koffi.array('char', 4),
      psz_name: koffi.pointer('char'),
      p_next: koffi.pointer('libvlc_track_description_t')
    });
    let p = headPtr;
    let guard = 0;
    while (p && !p.isNull?.() && guard < 100) {
      const node = koffi.decode(p, TrackDesc);
      let name = '';
      if (node.psz_name) {
        try {
          const buf = koffi.decode(node.psz_name, koffi.array('char', 256));
          name = Buffer.from(buf).toString('utf-8').split('\0')[0];
        } catch (_) { name = 'Track ' + node.i_id; }
      }
      result.push({
        id: node.i_id,
        name,
        selected: node.i_id === currentId
      });
      if (!node.p_next || node.p_next.isNull?.()) break;
      p = node.p_next;
      guard++;
    }
  } catch (err) {
    console.warn('[user32] track description walk failed:', err.message);
  }
  return result;
}

module.exports = {
  load,
  createChildWindow,
  moveWindow,
  showWindow,
  destroyWindow,
  readTrackDescription
};
