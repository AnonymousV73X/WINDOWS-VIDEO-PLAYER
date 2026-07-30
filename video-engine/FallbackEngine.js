/**
 * NovaPlay — Fallback Video Engine (HTML5 <video>)
 *
 * Used when libVLC isn't available. The renderer creates a hidden
 * <video> element with the source set to nova-video://local/<path>.
 * This supports browser-native codecs (mp4/webm with H.264/VP9/AV1)
 * but NOT mkv, avi, flv, wmv, etc.
 *
 * The fallback is invisible to the rest of the code — same API as
 * VideoEngine, but every method reports the result via IPC events
 * fired from the renderer's HTML5VideoBridge.
 *
 * This file is the "main process side" of the fallback — it just tracks
 * state and exposes a getFullState() for the renderer's initial sync.
 */

class FallbackEngine {
  constructor() {
    this._available = false;  // the renderer-side bridge handles actual playback
    this._lastState = { available: false, time: 0, duration: 0, state: 'idle', position: 0, rate: 1, volume: 80, hasVout: 0 };
  }

  isAvailable() { return false; }  // tells renderer to use HTML5 fallback
  attachToWindow(_mainWindow) {}
  load(_filePath) { return { ok: false, error: 'fallback mode' }; }
  play() { return { ok: false }; }
  pause() { return { ok: false }; }
  toggle() { return { ok: false }; }
  stop() { return { ok: false }; }
  seek(_timeSec) { return { ok: false }; }
  setVolume(_vol) { return { ok: false }; }
  setRate(_rate) { return { ok: false }; }
  setAudioTrack(_id) { return { ok: false }; }
  setSubtitleTrack(_id) { return { ok: false }; }
  setChapter(_chapter) { return { ok: false }; }
  getState() { return 'idle'; }
  getFullState() { return this._lastState; }
  getTracks() { return { audio: [], subtitles: [], chapters: 0, currentChapter: 0 }; }
  destroy() {}
}

module.exports = FallbackEngine;
