// scripts/compress-category-images.mjs
// One-off image squeeze: recompresses every /static/categories/*.jpg to
// 600×450 (matches the 4:3 card aspect ratio at ~1.5x retina for a 400px
// card) at quality 80 + progressive. Cuts payload from ~2MB across all
// 13 thumbnails to ~150–250KB total.
//
// Also generates static/og-default.jpg (1200×630) from the best LED
// sign photo so social shares get a branded preview.
//
// Run: node scripts/compress-category-images.mjs
// Idempotent — safe to re-run; just re-encodes from the source pixels.

import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';

const CATEGORY_DIR = path.resolve('static/categories');
const STATIC_DIR   = path.resolve('static');

async function squeezeCategory(file) {
  const abs = path.join(CATEGORY_DIR, file);
  const before = (await fs.stat(abs)).size;
  const buf = await fs.readFile(abs);
  const out = await sharp(buf)
    .resize(600, 450, { fit: 'cover', position: 'center' })
    .jpeg({ quality: 80, progressive: true, mozjpeg: true })
    .toBuffer();
  await fs.writeFile(abs, out);
  console.log(`  ${file.padEnd(22)} ${(before/1024).toFixed(0).padStart(4)}KB → ${(out.length/1024).toFixed(0).padStart(4)}KB`);
}

async function makeOgDefault() {
  // Pick a striking real-job photo as the default social-share preview.
  // The Walkerton hospital LED sign is brand-recognizable in the area.
  const source = path.join(STATIC_DIR, 'LED_Sign_HHWalkerton.jpg');
  const target = path.join(STATIC_DIR, 'og-default.jpg');
  const buf = await fs.readFile(source);
  const out = await sharp(buf)
    .resize(1200, 630, { fit: 'cover', position: 'center' })
    .jpeg({ quality: 82, progressive: true, mozjpeg: true })
    .toBuffer();
  await fs.writeFile(target, out);
  const before = (await fs.stat(source)).size;
  console.log(`\nog-default.jpg     ${(before/1024).toFixed(0).padStart(4)}KB (source) → ${(out.length/1024).toFixed(0).padStart(4)}KB (1200×630)`);
}

async function main() {
  console.log('Category cards (600×450 @ q80):');
  const files = (await fs.readdir(CATEGORY_DIR)).filter(f => /\.jpg$/i.test(f));
  for (const f of files) await squeezeCategory(f);
  await makeOgDefault();
}

main().catch(e => { console.error(e); process.exit(1); });
