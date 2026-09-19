const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Ensure assets dir exists
const assetsDir = path.join(__dirname, 'src', 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

function crc32(buf) {
  let table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

function createChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createPNG(width, height, drawFn) {
  // Signature
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // 8 bits per channel
  ihdrData.writeUInt8(6, 9); // RGBA
  ihdrData.writeUInt8(0, 10); // Deflate
  ihdrData.writeUInt8(0, 11); // Filter standard
  ihdrData.writeUInt8(0, 12); // No interlace
  const ihdrChunk = createChunk('IHDR', ihdrData);

  // Scanlines with filter byte 0
  const rowBytes = width * 4;
  const rawData = Buffer.alloc(height * (rowBytes + 1));

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (rowBytes + 1);
    rawData.writeUInt8(0, rowOffset); // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;
      const [r, g, b, a] = drawFn(x, y, width, height);
      rawData.writeUInt8(r, pixelOffset);
      rawData.writeUInt8(g, pixelOffset + 1);
      rawData.writeUInt8(b, pixelOffset + 2);
      rawData.writeUInt8(a, pixelOffset + 3);
    }
  }

  const idatChunk = createChunk('IDAT', zlib.deflateSync(rawData));
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

// Icon design: Material Design 3 rounded squircle with phone outline and reverse tethering signals
function generateIcon(isActive = false) {
  const size = 256;
  return createPNG(size, size, (x, y) => {
    const cx = 128, cy = 128;
    const dx = x - cx, dy = y - cy;
    const distSq = dx * dx + dy * dy;

    // Outer MD3 squircle background (radius ~ 116)
    // Formula: (x/r)^4 + (y/r)^4 <= 1
    const r = 110;
    const p = Math.pow(Math.abs(dx) / r, 3.4) + Math.pow(Math.abs(dy) / r, 3.4);

    if (p > 1.05) {
      return [0, 0, 0, 0]; // Transparent outside
    }

    // Border antialiasing
    let alpha = 255;
    if (p > 0.95) {
      alpha = Math.round(255 * (1.05 - p) / 0.1);
    }

    // Base background gradient: Primary container
    // Active: Teal/Green gradient, Inactive: Deep Blue/Cobalt gradient
    let bgR, bgG, bgB;
    const gradFactor = (y / size);

    if (isActive) {
      // Emerald / Green active theme
      bgR = Math.round(15 + gradFactor * 20);
      bgG = Math.round(120 + gradFactor * 40);
      bgB = Math.round(80 + gradFactor * 20);
    } else {
      // MD3 Deep Azure Blue theme
      bgR = Math.round(10 + gradFactor * 15);
      bgG = Math.round(85 + gradFactor * 40);
      bgB = Math.round(160 + gradFactor * 45);
    }

    // Phone outline in center: rect from x: 80 to 176 (width 96), y: 48 to 208 (height 160), corner radius 20
    const px = x - 128;
    const py = y - 128;

    // Inner Phone Body
    const inPhone = Math.abs(px) <= 44 && Math.abs(py) <= 72;
    const inScreen = Math.abs(px) <= 36 && Math.abs(py) <= 56;

    // Signal waves / tethering arrows
    // Let's render a crisp stylized wifi / reverse sync graphic
    // Wave 1: arc around center
    const waveDist = Math.sqrt(px * px + (py + 10) * (py + 10));
    const isWave1 = waveDist >= 18 && waveDist <= 24 && py <= -5 && Math.abs(px) <= (waveDist * 0.75);
    const isWave2 = waveDist >= 30 && waveDist <= 36 && py <= -8 && Math.abs(px) <= (waveDist * 0.75);
    const isDot = waveDist <= 6 && py >= -12 && py <= -2;

    // Up/down reverse tether arrows at center-bottom of phone screen
    const isArrowUp = (px >= -8 && px <= 8 && py >= 15 && py <= 35) ||
                      (py >= 15 && py <= 23 && Math.abs(px) <= (23 - py));

    if (inScreen) {
      if (isWave2 || isWave1 || isDot) {
        return [255, 255, 255, alpha]; // Bright white wave
      }
      if (isArrowUp) {
        return isActive ? [115, 218, 136, alpha] : [142, 206, 255, alpha]; // Cyan / Green glow
      }
      // Screen background (Dark tone)
      return [18, 24, 32, alpha];
    }

    if (inPhone) {
      // Phone bezel / frame
      return [240, 245, 250, alpha];
    }

    return [bgR, bgG, bgB, alpha];
  });
}

function createICO(pngBuffer) {
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0); // Reserved
  icoHeader.writeUInt16LE(1, 2); // ICO type = 1
  icoHeader.writeUInt16LE(1, 4); // 1 image

  const dirEntry = Buffer.alloc(16);
  dirEntry.writeUInt8(0, 0); // 0 means 256px
  dirEntry.writeUInt8(0, 1); // 0 means 256px
  dirEntry.writeUInt8(0, 2); // color count
  dirEntry.writeUInt8(0, 3); // reserved
  dirEntry.writeUInt16LE(1, 4); // planes
  dirEntry.writeUInt16LE(32, 6); // bit count
  dirEntry.writeUInt32LE(pngBuffer.length, 8); // image size
  dirEntry.writeUInt32LE(22, 12); // image offset

  return Buffer.concat([icoHeader, dirEntry, pngBuffer]);
}

const iconNormal = generateIcon(false);
const iconActive = generateIcon(true);
const iconIco = createICO(iconNormal);

fs.writeFileSync(path.join(assetsDir, 'icon.png'), iconNormal);
fs.writeFileSync(path.join(assetsDir, 'icon-active.png'), iconActive);
fs.writeFileSync(path.join(assetsDir, 'icon.ico'), iconIco);

console.log('Successfully generated icon.png, icon-active.png, icon.ico');
