/**
 * NovaPlay — Font Downloader (offline-friendly)
 *
 * Downloads Outfit TTFs from Google Fonts and saves them under
 * assets/fonts/. Run this once on a machine with internet access:
 *
 *   node scripts/download-fonts.js
 *
 * The fonts are then bundled with the app — no runtime network calls
 * of any kind. This mirrors NovaTune's download-fonts.js exactly.
 *
 * If the fonts are already present, this script is a no-op.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const fontsDir = path.join(__dirname, '..', 'assets', 'fonts');

const fonts = {
  'outfit-300.ttf': 'https://fonts.gstatic.com/s/outfit/v15/QGYyz_MVcBeNP4NjuGObqx1XmO1I4W61C4E.ttf',
  'outfit-400.ttf': 'https://fonts.gstatic.com/s/outfit/v15/QGYyz_MVcBeNP4NjuGObqx1XmO1I4TC1C4E.ttf',
  'outfit-500.ttf': 'https://fonts.gstatic.com/s/outfit/v15/QGYyz_MVcBeNP4NjuGObqx1XmO1I4QK1C4E.ttf',
  'outfit-600.ttf': 'https://fonts.gstatic.com/s/outfit/v15/QGYyz_MVcBeNP4NjuGObqx1XmO1I4e6yC4E.ttf',
  'outfit-700.ttf': 'https://fonts.gstatic.com/s/outfit/v15/QGYyz_MVcBeNP4NjuGObqx1XmO1I4deyC4E.ttf'
};

async function downloadFont(name, url) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(path.join(fontsDir, name));
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Follow redirect
        return downloadFont(name, response.headers.location).then(resolve).catch(reject);
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log('  Downloaded', name);
        resolve();
      });
    }).on('error', reject);
  });
}

async function downloadAll() {
  try {
    if (!fs.existsSync(fontsDir)) {
      fs.mkdirSync(fontsDir, { recursive: true });
    }

    let allPresent = true;
    for (const name of Object.keys(fonts)) {
      const p = path.join(fontsDir, name);
      if (!fs.existsSync(p) || fs.statSync(p).size < 1000) {
        allPresent = false;
        break;
      }
    }
    if (allPresent) {
      console.log('All Outfit fonts already present. Nothing to do.');
      return;
    }

    console.log('Downloading Outfit fonts to', fontsDir);
    for (const [name, url] of Object.entries(fonts)) {
      const p = path.join(fontsDir, name);
      if (fs.existsSync(p) && fs.statSync(p).size > 1000) {
        console.log('  Skipping', name, '(already present)');
        continue;
      }
      await downloadFont(name, url);
    }
    console.log('All Outfit fonts downloaded.');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

downloadAll();
