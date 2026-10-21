import "server-only";
import {
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

/** Printable assets use the same Gilroy font and Space Works brand as the app. */
export const ink = rgb(20 / 255, 44 / 255, 42 / 255),
  teal = rgb(0, 110 / 255, 99 / 255),
  cream = rgb(1, 244 / 255, 232 / 255);
const characterSets = new WeakMap<PDFFont, Set<number>>();
export function clean(font: PDFFont, text: string) {
  const supported = characterSets.get(font) ?? new Set(font.getCharacterSet());
  characterSets.set(font, supported);
  return [...text.replace(/[\r\n\t]/g, " ")]
    .map((c) => (supported.has(c.codePointAt(0)!) ? c : "?"))
    .join("");
}
export function textLines(font: PDFFont, text: string, width: number, size: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of clean(font, text).split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > width && line) {
      lines.push(line);
      line = word;
    } else line = candidate;
    while (font.widthOfTextAtSize(line, size) > width) {
      let n = line.length - 1;
      while (n > 1 && font.widthOfTextAtSize(line.slice(0, n), size) > width)
        n--;
      lines.push(line.slice(0, n));
      line = line.slice(n);
    }
  }
  if (line) lines.push(line);
  return lines;
}
export function wrapped(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  width: number,
  size = 12,
) {
  for (const line of textLines(font, text, width, size)) {
    page.drawText(line, { x, y, font, size, color: ink });
    y -= 18;
  }
  return y - 4;
}
