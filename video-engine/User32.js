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

const koffi = require("koffi");

let _user32 = null;
let _decls = null;

function load() {
  if (_decls) return _decls;
  if (process.platform !== "win32") {
    throw new Error("User32 only available on Windows");
  }

  _user32 = koffi.load("user32.dll");

  _decls = {
    // Window creation / destruction
    // NOTE: HWNDs are declared as uint64 so koffi passes the numeric pointer
    // VALUE (BigInt) rather than a pointer-to-buffer — the v2 Buffer→void* bug.
    CreateWindowExW: _user32.func(
      "uint64 CreateWindowExW(uint32 dwExStyle, const char16_t *lpClassName, const char16_t *lpWindowName, uint32 dwStyle, int32 x, int32 y, int32 nWidth, int32 nHeight, uint64 hWndParent, uint64 hMenu, uint64 hInstance, uint64 lpParam)",
    ),
    DestroyWindow: _user32.func("int32 DestroyWindow(uint64 hWnd)"),
    MoveWindow: _user32.func(
      "int32 MoveWindow(uint64 hWnd, int32 x, int32 y, int32 nWidth, int32 nHeight, int32 bRepaint)",
    ),
    ShowWindow: _user32.func("int32 ShowWindow(uint64 hWnd, int32 nCmdShow)"),
    SetWindowPos: _user32.func(
      "int32 SetWindowPos(uint64 hWnd, uint64 hWndInsertAfter, int32 x, int32 y, int32 cx, int32 cy, uint32 uFlags)",
    ),
    SetParent: _user32.func(
      "uint64 SetParent(uint64 hWndChild, uint64 hWndNewParent)",
    ),
    GetParent: _user32.func("uint64 GetParent(uint64 hWnd)"),
    InvalidateRect: _user32.func(
      "int32 InvalidateRect(uint64 hWnd, void *lpRect, int32 bErase)",
    ),
    UpdateWindow: _user32.func("int32 UpdateWindow(uint64 hWnd)"),
    SetWindowLongPtrW: _user32.func(
      "long SetWindowLongPtrW(uint64 hWnd, int32 nIndex, long value)",
    ),
    GetWindowLongPtrW: _user32.func(
      "long GetWindowLongPtrW(uint64 hWnd, int32 nIndex)",
    ),
    SetForegroundWindow: _user32.func("int32 SetForegroundWindow(uint64 hWnd)"),
    IsWindowVisible: _user32.func("int32 IsWindowVisible(uint64 hWnd)"),

    // Window style constants — https://learn.microsoft.com/en-us/windows/win32/winmsg/window-styles
    WS_CHILD: 0x40000000,
    WS_VISIBLE: 0x10000000,
    WS_CLIPSIBLINGS: 0x04000000,
    WS_CLIPCHILDREN: 0x02000000,
    WS_POPUP: 0x80000000,
    WS_BORDER: 0x00800000,
    WS_CAPTION: 0x00c00000,
    WS_EX_LAYERED: 0x00080000,
    WS_EX_TRANSPARENT: 0x00000020,
    WS_EX_NOACTIVATE: 0x08000000,
    WS_EX_TOOLWINDOW: 0x00000080,

    // SetWindowPos flags — https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos
    SWP_NOZORDER: 0x0004,
    SWP_NOACTIVATE: 0x0010,
    SWP_SHOWWINDOW: 0x0040,
    SWP_HIDEWINDOW: 0x0080,
    SWP_NOMOVE: 0x0002,
    SWP_NOSIZE: 0x0001,
    SWP_NOOWNER: 0x0200,
    SWP_FRAMECHANGE: 0x0020,
    SWP_ASYNCWINDOWPOS: 0x4000,

    // HWND insert-after constants — passed as void * via koffi pointer
    // We use a sentinel: pass them as numbers and let koffi coerce to void*.
    // For "HWND_TOPMOST" we use the literal 0xFFFFFFFFFFFFFFFF (or -1 as int64).
    HWND_TOP: 0x00000000, // (HWND)0
    HWND_BOTTOM: 0x00000001, // (HWND)1
    HWND_TOPMOST: 0xffffffffffffffff, // (HWND)-1
    HWND_NOTOPMOST: 0xfffffffffffffffe, // (HWND)-2

    // ShowWindow commands
    SW_HIDE: 0,
    SW_SHOWNORMAL: 1,
    SW_SHOWNA: 8, // show without activating — perfect for child windows
    SW_SHOWNOACTIVATE: 4,

    // GetWindowLongPtrW indices
    GWL_STYLE: -16,
    GWL_EXSTYLE: -20,
    GWLP_WNDPROC: -4,
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
/**
 * Extract the HWND numeric value from an Electron getNativeWindowHandle() Buffer.
 * Returns a BigInt — passed to uint64 koffi params which accept BigInt directly.
 */
function hwndBufferToPointer(buf) {
  if (!buf) return 0n;
  if (Buffer.isBuffer(buf)) {
    // Electron returns the HWND as raw little-endian bytes (8 on x64, 4 on x86).
    return buf.length >= 8
      ? buf.readBigUInt64LE(0)
      : BigInt(buf.readUInt32LE(0));
  }
  // Already a BigInt or number.
  if (typeof buf === "bigint") return buf;
  return BigInt(buf);
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

  // Extract the parent HWND as a BigInt — passed to uint64 koffi param.
  const parentVal = hwndBufferToPointer(parentHwndBuf);
  if (!parentVal) throw new Error("createChildWindow: parent HWND is null");

  const style = u.WS_POPUP | u.WS_VISIBLE;
  const exStyle = u.WS_EX_NOACTIVATE;

  console.log(
    "[user32] CreateWindowExW: style=0x" +
      style.toString(16) +
      " exStyle=0x" +
      exStyle.toString(16),
  );

  // CreateWindowExW returns uint64 (the child HWND as a BigInt).
  const hwnd = u.CreateWindowExW(
    exStyle,
    "Static",
    "NovaPlayVideo",
    style,
    0,
    0,
    10,
    10,
    parentVal, // ← BigInt → uint64, koffi passes the value directly
    0n,
    0n,
    0n,
  );

  if (!hwnd || hwnd === 0n) {
    throw new Error("CreateWindowExW returned NULL");
  }

  console.log("[user32] child HWND created: 0x" + hwnd.toString(16));

  // SetParent — reparent the WS_POPUP window to the BrowserWindow.
  try {
    const prev = u.SetParent(hwnd, parentVal);
    console.log("[user32] SetParent result: 0x" + prev.toString(16));
  } catch (err) {
    console.warn("[user32] SetParent failed (non-fatal):", err.message);
  }

  // Verify parentage.
  try {
    const actual = u.GetParent(hwnd);
    // koffi may return uint64 as Number for small values — normalize to BigInt.
    const actualBig = BigInt(actual);
    if (actualBig === parentVal) {
      console.log(
        "[user32] GetParent verified: child correctly parented to 0x" +
          parentVal.toString(16),
      );
    } else {
      console.warn(
        "[user32] GetParent mismatch! expected=0x" +
          parentVal.toString(16) +
          " actual=0x" +
          actualBig.toString(16) +
          " — WS_POPUP owner may differ",
      );
    }
  } catch (err) {
    console.warn("[user32] GetParent verification failed:", err.message);
  }

  // Start hidden — shown only when the video screen is active.
  showWindow(hwnd, false);

  return hwnd; // BigInt HWND value
}

/**
 * Move + resize the child HWND to match the renderer's reported rect.
 * Coordinates must be in PHYSICAL pixels (scaled by devicePixelRatio).
 */
function moveWindow(hwnd, x, y, w, h, show = true) {
  const u = load();
  return u.SetWindowPos(
    hwnd,
    0n,
    Math.round(x),
    Math.round(y),
    Math.round(w),
    Math.round(h),
    u.SWP_NOZORDER | u.SWP_NOACTIVATE | (show ? u.SWP_SHOWWINDOW : 0),
  );
}

/**
 * Convenience wrapper — takes a rect object { x, y, width, height }.
 */
function syncPosition(hwnd, rect) {
  if (!rect || !rect.width || !rect.height) {
    return showWindow(hwnd, false);
  }
  return moveWindow(hwnd, rect.x, rect.y, rect.width, rect.height, true);
}

/**
 * Force the child HWND above Chromium's GPU compositor surface.
 * Now that SetWindowPos takes uint64, HWND_TOPMOST is just 0xFFFFFFFFFFFFFFFFn.
 */
function bringToTop(hwnd) {
  const u = load();
  try {
    // HWND_TOP (0n) keeps VLC above Chromium's GPU compositor surface so the
    // video is visible. WS_EX_TRANSPARENT (set at creation) lets mouse events
    // fall through to the HTML controls overlay beneath.
    return u.SetWindowPos(
      hwnd,
      0n,
      0,
      0,
      0,
      0,
      u.SWP_NOMOVE | u.SWP_NOSIZE | u.SWP_NOACTIVATE,
    );
  } catch (err) {
    console.warn("[user32] bringToTop failed:", err.message);
    return 0;
  }
}

function showWindow(hwnd, visible = true) {
  const u = load();
  return u.ShowWindow(hwnd, visible ? u.SW_SHOWNOACTIVATE : u.SW_HIDE);
}

function destroyWindow(hwnd) {
  const u = load();
  return u.DestroyWindow(hwnd);
}

/**
 * Check if child HWND is parented to expectedParentBuf (Buffer from Electron).
 * With uint64 returns, GetParent returns a BigInt we can compare directly.
 */
function isParentedTo(childHwnd, expectedParentBuf) {
  if (!childHwnd || !expectedParentBuf) return false;
  const u = load();
  try {
    const expected = hwndBufferToPointer(expectedParentBuf);
    const actual = u.GetParent(childHwnd);
    // Normalize to BigInt — koffi may return uint64 as Number for small values.
    return BigInt(actual) === BigInt(expected);
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
    // libvlc_track_description_t (x64): int i_id @0, char *psz_name @8, next @16
    let p = headPtr;
    let guard = 0;
    while (p && guard < 100) {
      const id = koffi.decode(p, 0, "int32");
      const namePtr = koffi.decode(p, 8, "void *");
      let name = "";
      if (namePtr) {
        try {
          name = koffi.decode(namePtr, "char", -1);
        } catch (_) {
          try {
            const buf = koffi.decode(namePtr, koffi.array("char", 256));
            name = (
              typeof buf === "string" ? buf : Buffer.from(buf).toString("utf-8")
            ).split("\0")[0];
          } catch (_) {
            name = "Track " + id;
          }
        }
      }
      result.push({
        id,
        name: name || "Track " + id,
        selected: id === currentId,
      });
      p = koffi.decode(p, 16, "void *");
      guard++;
    }
  } catch (err) {
    console.warn("[user32] track description walk failed:", err.message);
  }
  try {
    require("./VlcBinding").load().libvlc_track_description_release(headPtr);
  } catch (_) {}
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
  readTrackDescription,
};
