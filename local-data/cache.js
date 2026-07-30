/**
 * NovaPlay — Thumbnail + Preview Frame Cache
 *
 * Generates poster thumbnails for video files using ffmpeg (preferred)
 * with a Node-only fallback that probes the first KB and renders a
 * placeholder PNG via sharp (so the library still works without ffmpeg
 * installed — the user gets a branded "play" placeholder thumbnail).
 *
 * Cached on disk under userData/cache/thumbs/<videoId>.jpg.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { ensureDirSync } = require('../app-shell/windowManager');
const db = require('./database');

let _cacheDir = null;
let _ffmpegAvailable = null;
let _ffmpegPath = null;

function getCacheDir() {
  if (_cacheDir) return _cacheDir;
  const base = process.env.NODE_ENV === 'development'
    ? path.join(__dirname, '..', 'data', 'cache')
    : (app?.getPath?.('userData') || path.join(require('os').tmpdir(), 'NovaPlay'));
  _cacheDir = path.join(base, 'thumbs');
  ensureDirSync(_cacheDir);
  return _cacheDir;
}

function _hashPath(filePath) {
  return crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 20);
}

/**
 * Try to locate ffmpeg on the system. Search order:
 *   1. NOVAPLAY_FFMPEG env var
 *   2. Bundled bin/ffmpeg.exe (next to app.asar)
 *   3. Common Windows install paths
 *   4. PATH
 */
function findFfmpeg() {
  if (_ffmpegAvailable !== null) return _ffmpegAvailable ? _ffmpegPath : null;

  const candidates = [];
  if (process.env.NOVAPLAY_FFMPEG) candidates.push(process.env.NOVAPLAY_FFMPEG);

  // Bundled ffmpeg
  try {
    const exeDir = app?.getAppPath?.() || __dirname;
    candidates.push(path.join(exeDir, '..', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
    candidates.push(path.join(exeDir, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
  } catch (_) {}

  if (process.platform === 'win32') {
    candidates.push('C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe');
    candidates.push('C:\\ffmpeg\\bin\\ffmpeg.exe');
    candidates.push('C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe');
  }
  candidates.push('ffmpeg'); // PATH fallback

  for (const c of candidates) {
    try {
      // We can't execSync a missing binary without an error on some platforms;
      // require.resolve doesn't work for executables, so use fs.existsSync for paths.
      if (c === 'ffmpeg') {
        const { execSync } = require('child_process');
        execSync('ffmpeg -version', { stdio: 'ignore', windowsHide: true });
        _ffmpegPath = c;
        _ffmpegAvailable = true;
        console.log('[cache] ffmpeg found on PATH');
        return _ffmpegPath;
      } else if (fs.existsSync(c)) {
        _ffmpegPath = c;
        _ffmpegAvailable = true;
        console.log('[cache] ffmpeg found at', c);
        return _ffmpegPath;
      }
    } catch (_) { /* keep trying */ }
  }

  _ffmpegAvailable = false;
  console.warn('[cache] ffmpeg not found — using placeholder thumbnails');
  return null;
}

/**
 * Generate a thumbnail for a video file. Caches on disk and in DB.
 * @returns {Promise<string|null>} absolute path to thumbnail jpg
 */
async function getThumbnail(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const videoId = 'vid_' + Buffer.from(filePath).toString('hex').slice(0, 24);
  const cached = db.getThumbnailRow(videoId);
  if (cached && fs.existsSync(cached.thumbPath)) return cached.thumbPath;

  const thumbPath = path.join(getCacheDir(), _hashPath(filePath) + '.jpg');

  // Try ffmpeg first
  const ffmpeg = findFfmpeg();
  if (ffmpeg) {
    try {
      const { execFile } = require('child_process');
      await new Promise((resolve, reject) => {
        execFile(ffmpeg, [
          '-y',
          '-ss', '00:00:03',         // seek 3 seconds in (or 25% if smaller file)
          '-i', filePath,
          '-frames:v', '1',
          '-vf', 'scale=320:-2',
          '-q:v', '4',
          thumbPath
        ], { windowsHide: true, timeout: 8000 }, (err) => {
          if (err) reject(err); else resolve();
        });
      });
      if (fs.existsSync(thumbPath)) {
        db.setThumbnail(videoId, thumbPath, 320, 180);
        return thumbPath;
      }
    } catch (err) {
      console.warn('[cache] ffmpeg thumbnail failed:', err.message);
    }
  }

  // Fallback: generate a placeholder thumbnail with sharp + play icon
  try {
    const sharp = require('sharp');
    const palette = [
      { bg: '#1a1a1a', fg: '#1ed760' },
      { bg: '#0f0f0f', fg: '#1ed760' },
      { bg: '#181818', fg: '#1ed760' },
      { bg: '#222222', fg: '#1ed760' }
    ];
    const pick = palette[_hashPath(filePath).charCodeAt(0) % palette.length];
    const svg = `
      <svg width="320" height="180" xmlns="http://www.w3.org/2000/svg">
        <rect width="320" height="180" fill="${pick.bg}"/>
        <circle cx="160" cy="90" r="32" fill="none" stroke="${pick.fg}" stroke-width="1.5" opacity="0.4"/>
        <polygon points="152,76 152,104 178,90" fill="${pick.fg}"/>
      </svg>`;
    await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toFile(thumbPath);
    db.setThumbnail(videoId, thumbPath, 320, 180);
    return thumbPath;
  } catch (err) {
    console.error('[cache] placeholder thumbnail failed:', err.message);
    return null;
  }
}

/**
 * Extract full metadata (duration, codec, dimensions) via ffprobe.
 * Returns null if ffprobe isn't available.
 */
async function probeMetadata(filePath) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return null;
  const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/, m => m.replace('ffmpeg', 'ffprobe'));
  try {
    const { execFile } = require('child_process');
    return await new Promise((resolve, reject) => {
      execFile(ffprobe, [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath
      ], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
        if (err) return reject(err);
        try {
          const data = JSON.parse(stdout);
          const v = (data.streams || []).find(s => s.codec_type === 'video');
          const a = (data.streams || []).find(s => s.codec_type === 'audio');
          resolve({
            duration: parseFloat(data.format?.duration || 0),
            width: v ? parseInt(v.width) : 0,
            height: v ? parseInt(v.height) : 0,
            codec: v?.codec_name || '',
            fps: _parseFps(v?.avg_frame_rate || v?.r_frame_rate),
            bitrate: parseInt(data.format?.bit_rate || 0),
            audioCodec: a?.codec_name || '',
            audioChannels: a ? parseInt(a.channels) : 0
          });
        } catch (e) { reject(e); }
      });
    });
  } catch (err) {
    console.warn('[cache] ffprobe failed:', err.message);
    return null;
  }
}

function _parseFps(rateStr) {
  if (!rateStr) return 0;
  const [n, d] = rateStr.split('/').map(Number);
  if (!n || (!d && d !== 0)) return 0;
  return d ? Math.round((n / d) * 100) / 100 : 0;
}

module.exports = {
  getThumbnail,
  probeMetadata,
  getCacheDir
};
