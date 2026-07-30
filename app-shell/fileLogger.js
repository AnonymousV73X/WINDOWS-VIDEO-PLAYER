/**
 ** NovaPlay — File Logger
 *! Reused pattern from NovaTune. Captures every console.log/error to a
 ** rotating log file in userData so packaged-exe users can send logs.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');


let _stream = null;
let _buffer = [];
let _flushTimer = null;
let _initialised = false;

function _resolveLogPath() {
  let dir;
  try {
    dir = app.getPath('userData');
  } catch (_) {
    dir = require('os').tmpdir();
  }
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return path.join(dir, 'novaplay.log');
}

function _write(line) {
  if (!_stream) {
    _buffer.push(line);
    return;
  }
  _stream.write(line + '\n');
}

function _flushBuffer() {
  if (!_stream || _buffer.length === 0) return;
  for (const line of _buffer) _stream.write(line + '\n');
  _buffer.length = 0;
}

function initFileLogger() {
  if (_initialised) return;
  _initialised = true;

  try {
    const logPath = _resolveLogPath();
    _stream = fs.createWriteStream(logPath, { flags: 'a' });
    _stream.on('open', () => {
      _flushBuffer();
    });
    _stream.on('error', (err) => {
      console.warn('[fileLogger] stream error:', err.message);
    });
  } catch (err) {
    console.warn('[fileLogger] init failed:', err.message);
  }

  const origLog = console.log;
  const origErr = console.error;
  const origWarn = console.warn;

  console.log = (...args) => {
    origLog(...args);
    try { _write(formatArgs(args)); } catch (_) {}
  };
  console.error = (...args) => {
    origErr(...args);
    try { _write('[ERROR] ' + formatArgs(args)); } catch (_) {}
  };
  console.warn = (...args) => {
    origWarn(...args);
    try { _write('[WARN]  ' + formatArgs(args)); } catch (_) {}
  };

  // Periodic flush safety net (write stream usually line-buffers).
  _flushTimer = setInterval(() => {
    try { _stream?.end(); _stream = fs.createWriteStream(_resolveLogPath(), { flags: 'a' }); } catch (_) {}
  }, 30000).unref();

  console.log(`[fileLogger] initialised — log path: ${_resolveLogPath()}`);
}

function closeFileLogger() {
  try {
    if (_flushTimer) clearInterval(_flushTimer);
    _stream?.end();
  } catch (_) {}
}

function formatArgs(args) {
  return args.map(a => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch (_) { return String(a); }
  }).join(' ');
}

module.exports = { initFileLogger, closeFileLogger };


