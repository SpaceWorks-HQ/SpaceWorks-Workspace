export type DiffLine = { kind: "add" | "remove" | "same"; text: string };
/** Bounded line comparison; large values use a complete before/after representation. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n"), b = after.split("\n");
  if (a.length * b.length > 90000) return [...a.map(text => ({ kind: "remove" as const, text })), ...b.map(text => ({ kind: "add" as const, text }))];
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
  const result: DiffLine[] = []; let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { result.push({ kind: "same", text: a[i++] }); j++; }
    else if (j < b.length && (i === a.length || lengths[i][j + 1] > lengths[i + 1][j])) result.push({ kind: "add", text: b[j++] });
    else result.push({ kind: "remove", text: a[i++] });
  }
  return result;
}
