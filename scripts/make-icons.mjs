// Draws the app icon (yellow bolt on a dark gradient) and writes PNGs. No dependencies.
// Usage: node scripts/make-icons.mjs

import { writeFile, mkdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../site/icons/', import.meta.url));

const BOLT = [[0.57, 0.15], [0.29, 0.56], [0.47, 0.56], [0.40, 0.86], [0.71, 0.42], [0.53, 0.42], [0.63, 0.15]];

function inside(x, y, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// Same bolt, grown around its centre, for the dark outline.
const grow = (poly, k) => {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return poly.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
};
const OUTLINE = grow(BOLT, 1.12);

function pixel(u, v) {
  // Background: diagonal navy-to-purple gradient with a soft glow behind the bolt.
  const t = (u + v) / 2;
  let r = 30 + (14 - 30) * t, g = 36 + (17 - 36) * t, b = 92 + (34 - 92) * t;
  const d = Math.hypot(u - 0.5, v - 0.5);
  const glow = Math.max(0, 1 - d / 0.45) ** 2 * 0.55;
  r += (255 - r) * glow * 0.35; g += (201 - g) * glow * 0.35; b += (60 - b) * glow * 0.2;
  if (inside(u, v, OUTLINE)) { r = 26; g = 18; b = 0; }
  if (inside(u, v, BOLT)) {
    const s = 1 - (v - 0.15) * 0.35; // light top, warmer bottom
    r = 255; g = 214 * s + 160 * (1 - s); b = 70 * s;
  }
  return [r, g, b];
}

function render(size) {
  const SS = 4;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const [pr, pg, pb] = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
        r += pr; g += pg; b += pb;
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r / SS / SS; raw[o + 1] = g / SS / SS; raw[o + 2] = b / SS / SS;
    }
  }
  return png(size, size, raw);
}

function png(w, h, raw) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = buf => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(OUT, { recursive: true });
for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await writeFile(OUT + file, render(size));
  console.log(`${file} ${size}x${size}`);
}
