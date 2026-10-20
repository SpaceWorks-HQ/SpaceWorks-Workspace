/** Deterministic README artwork, rendered by sharp without launching a browser. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createRequire } from "node:module";
const fontkit = createRequire(import.meta.url)("fontkit");
const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "docs/readme");
const brand = { "deep-ink": "#142C2A", "warm-cream": "#FFF4E8", "maker-teal": "#006E63", "workshop-orange": "#FF7447", citron: "#DFFF8F", "sky-blue": "#B5CDFF", "warm-yellow": "#FFD447" };
await mkdir(out, { recursive: true });
// Convert shipped font glyphs to SVG paths: consistent on hosts without system fonts.
const text = async (value: string, size: number, colour: string, accent = false) => {
  const font = fontkit.openSync(path.join(root,"public/brand/fonts",accent ? "Unbounded-Variable.woff2" : "Gilroy-SemiBold.woff"));
  const run = font.layout(value), scale = size / font.unitsPerEm;
  let x = 0, paths = "";
  for (let i = 0; i < run.glyphs.length; i++) {
    const position = run.positions[i];
    paths += `<path d="${run.glyphs[i].path.toSVG()}" transform="translate(${(x+position.xOffset)*scale} ${font.ascent*scale-position.yOffset*scale}) scale(${scale} ${-scale})"/>`;
    x += position.xAdvance;
  }
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(x*scale)+2}" height="${Math.ceil((font.ascent-font.descent)*scale)+2}"><g fill="${colour}">${paths}</g></svg>`)).png().toBuffer();
};
for (const dark of [false, true]) {
  const field = dark ? brand["deep-ink"] : brand["warm-cream"], ink = dark ? brand["warm-cream"] : brand["deep-ink"];
  const logo = await sharp(await readFile(path.join(root, "public/brand/logo", dark ? "lockup-horizontal-reversed.svg" : "lockup-horizontal.svg"))).resize(300,48,{fit:"contain"}).png().toBuffer();
  const shapes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="400"><circle cx="940" cy="430" r="150" fill="${brand.citron}"/><rect x="970" y="60" width="150" height="150" rx="32" fill="${brand["sky-blue"]}"/><path d="M1280 150 A250 250 0 0 0 1030 400 L1280 400Z" fill="${brand["maker-teal"]}"/><circle cx="1196" cy="84" r="34" fill="${brand["workshop-orange"]}"/></svg>`);
  await sharp({create:{width:1280,height:400,channels:4,background:field}}).composite([
    {input:shapes,left:0,top:0},{input:logo,left:72,top:48},
    {input:await text("Workspace",29,ink),left:400,top:57},
    {input:await text("Make room.",56,ink,true),left:72,top:148},
    {input:await text("Build together.",56,ink,true),left:72,top:218},
    {input:await text("A private home for your community’s work.",22,ink),left:72,top:320},
  ]).png({compressionLevel:9}).toFile(path.join(out,dark?"banner-dark.png":"banner.png"));
}
for(const [name,hex] of Object.entries(brand)) await writeFile(path.join(out,`swatch-${name}.svg`),`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24"><rect x=".5" y=".5" width="47" height="23" rx="6" fill="${hex}" stroke="#7F8C89"/></svg>\n`);
console.log("Generated light/dark banners and seven brand swatches.");
