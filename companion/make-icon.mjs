// Draws the Medley mark (public/favicon.svg) into icon.png without any image library:
// supersampled shapes → RGBA → a minimal PNG encoder.   node make-icon.mjs [size]
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZE = Number(process.argv[2] ?? 256);
const SS = 4; // supersamples per axis

// Same geometry as the favicon, in its 32-unit viewBox.
const BARS = [2, 8, 14, 20, 26].map((x, i) => ({ x, h: [24, 17, 10, 17, 24][i] }));
const STOPS = [
  [0, [0xff, 0x7a, 0x59]],
  [0.55, [0xf0, 0x46, 0x8f]],
  [1, [0x8f, 0x6b, 0xff]],
];
const BG = [0x14, 0x11, 0x1d];

const inRoundRect = (x, y, x0, y0, w, h, r) => {
  if (x < x0 || y < y0 || x > x0 + w || y > y0 + h) return false;
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r);
  const cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const gradient = (t) => {
  t = Math.min(1, Math.max(0, t));
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    const [t0, c0] = STOPS[i - 1];
    if (t <= t1) return c0.map((v, k) => v + ((c1[k] - v) * (t - t0)) / (t1 - t0));
  }
  return STOPS.at(-1)[1];
};

/** Colour (with alpha) at a point of the 32-unit canvas. */
function sample(u, v) {
  if (!inRoundRect(u, v, 0, 0, 32, 32, 8)) return [0, 0, 0, 0];
  // The bars sit in a group scaled 0.8 and moved (3.2, 3), like the favicon.
  const bx = (u - 3.2) / 0.8;
  const by = (v - 3) / 0.8;
  for (const b of BARS) {
    if (inRoundRect(bx, by, b.x, 29 - b.h, 4, b.h, 2)) return [...gradient((bx - 2 + (by - 5)) / 51), 255];
  }
  return [...BG, 255];
}

const px = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  px[y * (SIZE * 4 + 1)] = 0; // PNG filter: none
  for (let x = 0; x < SIZE; x++) {
    const acc = [0, 0, 0, 0];
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const c = sample(((x + (sx + 0.5) / SS) * 32) / SIZE, ((y + (sy + 0.5) / SS) * 32) / SIZE);
        const a = c[3] / 255;
        for (let k = 0; k < 3; k++) acc[k] += c[k] * a;
        acc[3] += c[3];
      }
    const alpha = acc[3] / (SS * SS);
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    for (let k = 0; k < 3; k++) px[o + k] = alpha ? Math.round(acc[k] / (SS * SS) / (alpha / 255)) : 0;
    px[o + 3] = Math.round(alpha);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
writeFileSync(
  new URL('icon.png', import.meta.url),
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(px)), chunk('IEND', Buffer.alloc(0))]),
);
console.log(`icon.png (${SIZE}×${SIZE})`);
