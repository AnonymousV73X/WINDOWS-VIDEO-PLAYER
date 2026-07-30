/**
 * NovaPlay — File Scanner
 *
 * Walks a folder tree on the local disk looking for video files.
 * Reuses NovaTune's chokidar-based scanning pattern, adapted for video
 * extensions instead of audio. Purely synchronous directory walk — fast
 * enough for tens of thousands of files in seconds.
 */

const fs = require('fs');
const path = require('path');

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v',
  '.mpg', '.mpeg', '.ts', '.m2ts', '.vob', '.ogv', '.3gp', '.mts',
  '.m4v', '.f4v', '.asf', '.rm', '.rmvb', '.divx', '.m2v', '.m1v'
]);

function isVideo(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

/**
 * Walk a folder tree, yielding video file paths.
 * Returns a flat array of absolute paths. Skips hidden folders, the
 * app's own cache folder, system folders, and follows symlinks safely
 * (no infinite loops via a visited-inode Set).
 *
 * @param {string} rootDir
 * @param {{ onProgress?: (count:number, current:string) => void, signal?: { cancelled:boolean } }} opts
 * @returns {Promise<string[]>}
 */
function scanFolder(rootDir, opts = {}) {
  return new Promise((resolve, reject) => {
    const results = [];
    const visitedInodes = new Set();

    function walk(dir, depth) {
      if (opts.signal?.cancelled) return;
      if (depth > 25) return; // safety net
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (err) {
        // Permission errors / locked files: skip silently
        return;
      }
      for (const entry of entries) {
        if (opts.signal?.cancelled) return;
        if (entry.name.startsWith('.') && entry.name !== '..') continue;
        if (entry.name === '$RECYCLE.BIN' || entry.name === 'System Volume Information') continue;
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) {
          try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              const inode = stat.ino + ':' + stat.dev;
              if (visitedInodes.has(inode)) continue;
              visitedInodes.add(inode);
              walk(fullPath, depth + 1);
            } else if (stat.isFile() && isVideo(fullPath)) {
              results.push(fullPath);
              opts.onProgress?.(results.length, fullPath);
            }
          } catch (_) { /* broken symlink */ }
        } else if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (entry.isFile() && isVideo(fullPath)) {
          results.push(fullPath);
          opts.onProgress?.(results.length, fullPath);
        }
      }
    }

    try {
      walk(rootDir, 0);
      resolve(results);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Extract minimal metadata from a file path for the library row.
 * Heavy metadata (duration, codec, dimensions) is filled in by Thumbnailer
 * / ffprobe later — this is the fast first-pass that lets the library
 * show up instantly after a scan.
 */
function quickMetadata(filePath) {
  let stat;
  try { stat = fs.statSync(filePath); } catch (_) { return null; }
  const baseName = path.basename(filePath);
  const title = baseName.replace(/\.[^.]+$/, '').replace(/[._]/g, ' ').trim();
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(path.resolve(filePath).toLowerCase()).digest('hex').slice(0, 24);
  return {
    id: 'vid_' + hash,
    title,
    filePath,
    size: stat.size,
    dateAdded: stat.mtimeMs || Date.now(),
    folder: path.dirname(filePath)
  };
}

module.exports = {
  VIDEO_EXTENSIONS,
  isVideo,
  scanFolder,
  quickMetadata
};
