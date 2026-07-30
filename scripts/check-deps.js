/**
 * NovaPlay — Dependency Check (postinstall hook)
 *
 * Checks for native module availability and prints friendly warnings
 * rather than cryptic stack traces. Does NOT block npm install.
 */

const fs = require('fs');
const path = require('path');

function check(name, isOptional = false) {
  try {
    require(name);
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    if (isOptional) {
      console.log(`  ⚠ ${name} (optional) — ${err.message}`);
    } else {
      console.error(`  ✗ ${name} — FAILED: ${err.message}`);
    }
    return false;
  }
}

console.log('\nChecking NovaPlay dependencies...\n');

// Critical (without these the app won't start)
check('electron');
check('better-sqlite3');
check('koffi');
check('sharp');
check('chokidar');

// Optional (without these the app degrades gracefully)
check('fluent-ffmpeg', true);

console.log('\nNote: koffi will load libvlc.dll / libvlc.so at runtime.');
console.log('If libVLC is not installed, NovaPlay will fall back to HTML5 <video>.');
console.log('Install VLC from https://www.videolan.org/ for full format support.\n');
