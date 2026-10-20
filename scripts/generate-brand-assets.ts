/**
 * Rasterises the Space Works logo masters in public/brand/logo into the PNG/ICO files browsers,
 * PWAs, social cards and email need. Run after changing a master and commit
 * the outputs:
 *
 *   node scripts/generate-brand-assets.ts
 *
 * (Node 22.18+ runs TypeScript directly; only erasable types are used.)
 */
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const CREAM = "#FFF4E8";

const root = path.resolve(import.meta.dirname, "..");
const brand = (file: string) => path.join(root, "public", "brand", file);
const logo = (file: string) => path.join(root, "public", "brand", "logo", file);
const appFile = (file: string) => path.join(root, "app", file);

/** Renders a master SVG at `width` px wide (height follows its aspect ratio). */
async function rasterise(master: string, width: number): Promise<Buffer> {
  const svg = await readFile(logo(master));
  const viewBoxWidth = Number(/viewBox="0 0 ([\d.]+)/.exec(svg.toString())?.[1] ?? width);
  // Render at a density that gives at least the target size, then downsample for crisp edges.
  return sharp(svg, { density: Math.max(72, Math.ceil((72 * width * 2) / viewBoxWidth)) })
    .resize({ width })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** A solid Warm Cream square or rectangle with `artwork` centred on it. */
async function onCream(width: number, height: number, artwork: Buffer): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: CREAM } })
    .composite([{ input: artwork, gravity: "centre" }])
    .flatten({ background: CREAM })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Maskable icon: the symbol on a full-bleed cream square, scaled so every
 * point stays inside the 80% safe-zone circle that platforms may crop to.
 */
async function maskable(size: number): Promise<Buffer> {
  return onCream(size, size, await rasterise("symbol.svg", Math.round(size * 0.54)));
}

/** Minimal ICO container holding PNG images (supported by every current browser). */
function ico(images: Array<{ size: number; png: Buffer }>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

async function main() {
  const outputs: Array<[string, Buffer]> = [
    // Web app manifest: the app tile (symbol at 62% on a rounded Warm Cream tile).
    [brand("icon-192.png"), await rasterise("app-icon.svg", 192)],
    [brand("icon-512.png"), await rasterise("app-icon.svg", 512)],
    [brand("maskable-192.png"), await maskable(192)],
    [brand("maskable-512.png"), await maskable(512)],
    // iOS home screen: no transparency (iOS rounds the corners itself).
    [appFile("apple-icon.png"), await onCream(180, 180, await rasterise("app-icon.svg", 180))],
    // Default social card: Warm Cream 1200×630, primary lockup 600px wide, centred.
    [brand("og-default.png"), await onCream(1200, 630, await rasterise("lockup-stacked.svg", 600))],
    // Email header: hosted PNG (never inline SVG in email), primary lockup @2x for 180px wide.
    [brand("email-lockup.png"), await rasterise("lockup-stacked.svg", 360)],
  ];

  // favicon.ico: below 48px the app tile is the brand's small-size asset.
  const favicon = ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await rasterise("app-icon.svg", size) }))));

  for (const [file, data] of outputs) {
    await writeFile(file, data);
    console.log("wrote", path.relative(root, file), `${data.length} bytes`);
  }
  await writeFile(appFile("favicon.ico"), favicon);
  console.log("wrote app/favicon.ico", `${favicon.length} bytes`);
  // Next.js file convention: /icon.svg for modern browsers (the app tile is the small-size asset).
  await copyFile(logo("app-icon.svg"), appFile("icon.svg"));
  console.log("copied app/icon.svg");
}

await main();
