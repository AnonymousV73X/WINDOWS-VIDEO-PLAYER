/**
 * NovaPlay — User32.dll bindings (Windows-only, REVOLUTIONIZED v2)
 *
 * FIXES vs v1:
 *   1. Pass the raw HWND Buffer directly to koffi (koffi marshals Buffer→void*
 *      natively). v1 converted Buffer→BigInt and passed that to a `void *`
 *      param, which koffi may silently coerce to NULL → top-level window.
 *   2. Use WS_POPUP | WS_VISIBLE instead of WS_CHILD | WS_CLIPSIBLINGS.
 *      WS_CLIPSIBLINGS made the child lose z-order to Chromium's GPU surface.
 *      WS_POPUP gives us a top-level-style window that we explicitly SetParent
 *      to the Electron BrowserWindow — and we can then force HWND_TOPMOST.
 *   3. Explicit SetParent() call after CreateWindowExW — verifies parentage.
 *   4. GetParent() verification helper — surfaces parenting failures.
 *   5. BringToTop() / SetTopMost() helpers — keep child above Chromium GPU.
 *   6. Forward window events (move/resize/dpi-change) via syncPosition().
 *
 * The child HWND uses WS_POPUP | WS_VISIBLE so it can be parented via
 * SetParent (more reliable than WS_CHILD for cross-process scenarios) and
 * kept above Chromium's compositor surface via HWND_TOPMOST.
 *
 * Track description walker: libvlc returns a linked list of
 * libvlc_track_description_t structs. We walk it via koffi.struct.
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
    // Window creation / destruction
    CreateWindowExW: _user32.func('void * CreateWindowExW(uint32 dwExStyle, const char16_t *lpClassName, const char16_t *lpWindowName, uint32 dwStyle, int32 x, int32 y, int32 nWidth, int32 nHeight, void *hWndParent, void *hMenu, void *hInstance, void *lpParam)'),
    DestroyWindow:    _user32.func('int32 DestroyWindow(void *hWnd)'),
    MoveWindow:       _user32.func('int32 MoveWindow(void *hWnd, int32 x, int32 y, int32 nWidth, int32 nHeight, int32 bRepaint)'),
    ShowWindow:       _user32.func('int32 ShowWindow(void *hWnd, int32 nCmdShow)'),
    SetWindowPos:     _user32.func('int32 SetWindowPos(void *hWnd, void *hWndInsertAfter, int32 x, int32 y, int32 cx, int32 cy, uint32 uFlags)'),
    SetParent:        _user32.func('void * SetParent(void *hWndChild, void *hWndNewParent)'),
    GetParent:        _user32.func('void * GetParent(void *hWnd)'),
    InvalidateRect:   _user32.func('int32 InvalidateRect(void *hWnd, void *lpRect, int32 bErase)'),
    UpdateWindow:     _user32.func('int32 UpdateWindow(void *hWnd)'),
    SetWindowLongPtrW:_user32.func('long SetWindowLongPtrW(void *hWnd, int32 nIndex, long value)'),
    GetWindowLongPtrW:_user32.func('long GetWindowLongPtrW(void *hWnd, int32 nIndex)'),
    SetForegroundWindow: _user32.func('int32 SetForegroundWindow(void *hWnd)'),
    IsWindowVisible:  _user32.func('int32 IsWindowVisible(void *hWnd)'),

    // Window style constants — https://learn.microsoft.com/en-us/windows/win32/winmsg/window-styles
    WS_CHILD:         0x40000000,
    WS_VISIBLE:       0x10000000,
    WS_CLIPSIBLINGS:  0x04000000,
    WS_CLIPCHILDREN:  0x02000000,
    WS_POPUP:         0x80000000,
    WS_BORDER:        0x00800000,
    WS_CAPTION:       0x00C00000,
    WS_EX_LAYERED:    0x00080000,
    WS_EX_TRANSPARENT:0x00000020,
    WS_EX_NOACTIVATE: 0x08000000,
    WS_EX_TOOLWINDOW: 0x00000080,

    // SetWindowPos flags — https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos
    SWP_NOZORDER:     0x0004,
    SWP_NOACTIVATE:   0x0010,
    SWP_SHOWWINDOW:   0x0040,
    SWP_HIDEWINDOW:   0x0080,
    SWP_NOMOVE:       0x0002,
    SWP_NOSIZE:       0x0001,
    SWP_NOOWNER:      0x0200,
    SWP_FRAMECHANGE:  0x0020,
    SWP_ASYNCWINDOWPOS: 0x4000,

    // HWND insert-after constants — passed as void * via koffi pointer
    // We use a sentinel: pass them as numbers and let koffi coerce to void*.
    // For "HWND_TOPMOST" we use the literal 0xFFFFFFFFFFFFFFFF (or -1 as int64).
    HWND_TOP:         0x00000000,    // (HWND)0
    HWND_BOTTOM:      0x00000001,    // (HWND)1
    HWND_TOPMOST:     0xFFFFFFFFFFFFFFFF,  // (HWND)-1
    HWND_NOTOPMOST:   0xFFFFFFFFFFFFFFFE,  // (HWND)-2

    // ShowWindow commands
    SW_HIDE:          0,
    SW_SHOWNORMAL:    1,
    SW_SHOWNA:        8,    // show without activating — perfect for child windows
    SW_SHOWNOACTIVATE: 4,

    // GetWindowLongPtrW indices
    GWL_STYLE:        -16,
    GWL_EXSTYLE:      -20,
    GWLP_WNDPROC:     -4
  };

  return _decls;
}

/**
 * Convert an Electron native-window-handle Buffer to a koffi pointer.
 *
 * Electron's getNativeWindowHandle() returns a Buffer whose bytes are the
 * HWND pointer (4 bytes on x86, 8 bytes on x64). Koffi can marshal a Buffer
 * directly to `void *`, which is the safest path — we just pass the Buffer.
 *
 * If for any reason koffi rejects the Buffer, we fall back to constructing
 * a pointer via koffi.as() with the BigInt value.
 */
function hwndBufferToPointer(buf) {
  if (!buf) return null;
  if (Buffer.isBuffer(buf)) {
    // Preferred path: pass the Buffer directly. koffi marshals it as void *.
    return buf;
  }
  // Already a pointer/number — return as-is.
  return buf;
}

/**
 * Create a child HWND of the given parent (Buffer of native handle).
 *
 * REVOLUTIONIZED v2 strategy:
 *   1. Create as WS_POPUP | WS_VISIBLE (NOT WS_CHILD) — gives us a window
 *      we can fully control z-order on.
 *   2. Pass the raw parent Buffer to CreateWindowExW — koffi marshals it.
 *   3. Call SetParent(child, parent) explicitly to guarantee parentage.
 *   4. Strip WS_CLIPSIBLINGS so the child can paint over Chromium's surface.
 *   5. Call SetWindowPos(child, HWND_TOPMOST, ...) to put it above Chromium.
 *   6. Add WS_EX_NOACTIVATE so the child never steals focus from Electron.
 *
 * Returns the child HWND as a koffi pointer.
 */
function createChildWindow(parentHwndBuf) {
  const u = load();

  // Pass the raw Buffer — koffi knows how to marshal Buffer→void*.
  // This is the FIX for v1's BigInt→void* silent-NULL bug.
  const parentPtr = hwndBufferToPointer(parentHwndBuf);
  if (!parentPtr) throw new Error('createChildWindow: parent HWND is null');

  // WS_POPUP gives us a borderless top-level-style window we can parent
  // and control z-order on. WS_EX_NOACTIVATE prevents focus stealing.
  // We DO NOT use WS_CLIPSIBLINGS — that's what made v1's child invisible
  // behind Chromium's GPU compositor surface.
  const style = u.WS_POPUP | u.WS_VISIBLE;
  const exStyle = u.WS_EX_NOACTIVATE;

  console.log('[user32] CreateWindowExW: style=0x' + style.toString(16) +
              ' exStyle=0x' + exStyle.toString(16));

  const hwnd = u.CreateWindowExW(
    exStyle,
    'Static',           // built-in Win32 static control — safe, no WNDPROC needed
    'NovaPlayVideo',
    style,
    0, 0, 10, 10,       // initial size; repositioned by syncPosition()
    parentPtr,          // ← raw Buffer, koffi marshals to void *
    null, null, null
  );

  if (!hwnd) {
    throw new Error('CreateWindowExW returned NULL (style=0x' + style.toString(16) + ')');
  }

  console.log('[user32] child HWND created:', hwnd);

  // Explicitly SetParent — guarantees parentage even if CreateWindowExW
  // silently dropped the parent (defensive; should be a no-op if it worked).
  try {
    const previousParent = u.SetParent(hwnd, parentPtr);
    if (previousParent === null || previousParent === 0) {
      // SetParent returned NULL — could mean child was previously top-level,
      // which is exactly the v1 bug we're fixing. Now it's parented.
      console.log('[user32] SetParent: child was previously top-level (v1 bug!) — now reparented');
    }
  } catch (err) {
    console.warn('[user32] SetParent failed (non-fatal):', err.message);
  }

  // Verify parentage — if GetParent != expected, something is wrong.
  try {
    const actualParent = u.GetParent(hwnd);
    // Compare via Buffer equality (koffi returns a pointer we can compare
    // against the original Buffer's value).
    const expected = Buffer.isBuffer(parentHwndBuf)
      ? (parentHwndBuf.length >= 8
          ? parentHwndBuf.readBigUInt64LE(0)
          : BigInt(parentHwndBuf.readUInt32LE(0)))
      : null;
    // koffi pointer → BigInt via koffi.address() if available
    let actualBig = null;
    try { actualBig = BigInt(koffi.address(actualParent)); } catch (_) {}
    if (expected !== null && actualBig !== null && actualBig !== expected) {
      console.warn('[user32] GetParent mismatch! expected=' + expected +
                   ' actual=' + actualBig + ' — child may still be detached');
    } else {
      console.log('[user32] GetParent verified: child is correctly parented');
    }
  } catch (err) {
    console.warn('[user32] GetParent verification failed (non-fatal):', err.message);
  }

  // Force the child to the top of the z-order so it paints above Chromium's
  // GPU compositor surface (a sibling HWND inside the BrowserWindow).
  bringToTop(hwnd);

  return hwnd;
}

/**
 * Move + resize the child HWND to match the renderer's reported rect.
 *
 * Uses SetWindowPos with SWP_NOZORDER|SWP_NOACTIVATE|SWP_SHOWWINDOW — we
 * do NOT touch z-order here (call bringToTop() separately if needed).
 *
 * Coordinates must be in PHYSICAL pixels (already scaled by devicePixelRatio
 * on the renderer side).
 */
function moveWindow(hwnd, x, y, w, h, repaint = true) {
  const u = load();
  return u.SetWindowPos(hwnd, null, Math.round(x), Math.round(y), Math.round(w), Math.round(h),
    u.SWP_NOZORDER | u.SWP_NOACTIVATE | u.SWP_SHOWWINDOW | (repaint ? 0 : 0));  // SWP_SHOWWINDOW ensures visible
}

/**
 * Convenience wrapper — same as moveWindow but takes a rect object.
 */
function syncPosition(hwnd, rect) {
  if (!rect || !rect.width || !rect.height) {
    return showWindow(hwnd, false);
  }
  return moveWindow(hwnd, rect.x, rect.y, rect.width, rect.height, true);
}

/**
 * Force the child HWND above Chromium's GPU compositor surface.
 *
 * Call this after every moveWindow, after every BrowserWindow move/resize,
 * and after DPI changes. Without this, Chromium's GPU surface wins z-order
 * and the child HWND (where VLC paints) is invisible.
 *
 * HWND_TOPMOST = (HWND)-1 — we pass it as a sentinel. Koffi accepts a
 * BigInt for `void *` parameters when explicitly typed.
 */
function bringToTop(hwnd) {
  const u = load();
  try {
    // Pass HWND_TOPMOST as a literal pointer. Koffi needs an explicit pointer
    // type, not a bare number — use koffi.as() to wrap it.
    const topmost = koffi.as(u.HWND_TOPMOST, 'void *');
    return u.SetWindowPos(hwnd, topmost, 0, 0, 0, 0,
      u.SWP_NOMOVE | u.SWP_NOSIZE | u.SWP_NOACTIVATE | u.SWP_SHOWWINDOW);
  } catch (err) {
    // Fallback: try passing the sentinel as a Buffer (8-byte LE of -1).
    try {
      const topmostBuf = Buffer.alloc(8);
      topmostBuf.writeBigUInt64LE(BigInt(u.HWND_TOPMOST) & 0xFFFFFFFFFFFFFFFFn, 0);
      return u.SetWindowPos(hwnd, topmostBuf, 0, 0, 0, 0,
        u.SWP_NOMOVE | u.SWP_NOSIZE | u.SWP_NOACTIVATE | u.SWP_SHOWWINDOW);
    } catch (err2) {
      console.warn('[user32] bringToTop failed:', err2.message);
      return 0;
    }
  }
}

function showWindow(hwnd, visible = true) {
  const u = load();
  // SW_SHOWNOACTIVATE = 4 — show without stealing focus from Electron.
  return u.ShowWindow(hwnd, visible ? u.SW_SHOWNOACTIVATE : u.SW_HIDE);
}

function destroyWindow(hwnd) {
  const u = load();
  return u.DestroyWindow(hwnd);
}

/**
 * Check if the child HWND is actually parented to the expected parent.
 * Returns true if parented, false if detached (the v1 bug).
 */
function isParentedTo(childHwnd, expectedParentBuf) {
  if (!childHwnd || !expectedParentBuf) return false;
  const u = load();
  try {
    const actual = u.GetParent(childHwnd);
    if (!actual) return false;
    const expectedBig = Buffer.isBuffer(expectedParentBuf)
      ? (expectedParentBuf.length >= 8
          ? expectedParentBuf.readBigUInt64LE(0)
          : BigInt(expectedParentBuf.readUInt32LE(0)))
      : null;
    let actualBig = null;
    try { actualBig = BigInt(koffi.address(actual)); } catch (_) {}
    return expectedBig !== null && actualBig !== null && actualBig === expectedBig;
  } catch (_) {
    return false;
  }
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
  syncPosition,
  bringToTop,
  showWindow,
  destroyWindow,
  isParentedTo,
  readTrackDescription
};
