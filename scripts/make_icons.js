/**
 * NovaPlay — Icon Generator
 *
 * Generates a 1024x1024 PNG app icon and converts it to .ico for Windows.
 * Uses sharp (already in deps) — no external image editor required.
 *
 * Output: assets/icons/icon.png + assets/icons/icon.ico
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const iconsDir = path.join(__dirname, '..', 'assets', 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

async function makeIcon() {
  // NovaPlay logo: a play triangle on accent-green background, with glow
  // We draw an SVG, then rasterise via sharp.
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#1ed760" stop-opacity="0.4"/>
      <stop offset="65%" stop-color="#1ed760" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0a0a0a"/>
      <stop offset="100%" stop-color="#000000"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="224" fill="url(#bg)"/>
  <circle cx="512" cy="512" r="380" fill="url(#glow)"/>
  <circle cx="512" cy="512" r="180" fill="#1ed760"/>
  <polygon points="470,400 470,624 632,512" fill="#000000"/>
</svg>`;

  const pngPath = path.join(iconsDir, 'icon.png');
  await sharp(Buffer.from(svg)).png().toFile(pngPath);
  console.log('  Wrote', pngPath);

  // For .ico, we write a multi-resolution PNG-packed .ico (sharp can't make .ico directly,
  // but Windows accepts PNG-embedded .ico files since Vista). We construct a minimal .ico
  // wrapper around a single 256x256 PNG.
  const png256 = await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer();
  const png128 = await sharp(Buffer.from(svg)).resize(128, 128).png().toBuffer();
  const png64 = await sharp(Buffer.from(svg)).resize(64, 64).png().toBuffer();
  const png48 = await sharp(Buffer.from(svg)).resize(48, 48).png().toBuffer();
  const png32 = await sharp(Buffer.from(svg)).resize(32, 32).png().toBuffer();
  const png16 = await sharp(Buffer.from(svg)).resize(16, 16).png().toBuffer();

  const images = [
    { size: 256, data: png256 },
    { size: 128, data: png128 },
    { size: 64,  data: png64  },
    { size: 48,  data: png48  },
    { size: 32,  data: png32  },
    { size: 16,  data: png16  }
  ];

  const icoPath = path.join(iconsDir, 'icon.ico');

  // ICO header (6 bytes) + directory entries (16 bytes each) + image data
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * images.length;
  let offset = headerSize + dirSize;

  // Build directory entries
  const dirEntries = [];
  for (const img of images) {
    const w = img.size === 256 ? 0 : img.size;  // 0 = 256 in ICO format
    const h = w;
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(w, 0);
    entry.writeUInt8(h, 1);
    entry.writeUInt8(0, 2);   // 0 colours
    entry.writeUInt8(0, 3);   // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(img.data.length, 8); // size of image data
    entry.writeUInt32LE(offset, 12);          // offset to image data
    dirEntries.push(entry);
    offset += img.data.length;
  }

  // Header
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);  // reserved
  header.writeUInt16LE(1, 2);  // type = 1 (icon)
  header.writeUInt16LE(images.length, 4);

  const ico = Buffer.concat([header, ...dirEntries, ...images.map(i => i.data)]);
  fs.writeFileSync(icoPath, ico);
  console.log('  Wrote', icoPath);
}

makeIcon().catch(err => {
  console.error('Failed to make icons:', err);
  process.exit(1);
});
