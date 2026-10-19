import { z } from "zod";
/** RFC 4180 records with quoted commas, escaped quotes and embedded line breaks. */
export function parseCsv(text: string): string[][] {
  if (new TextEncoder().encode(text).byteLength > 1_000_000)
    throw new Error("Use a CSV smaller than 1 MB.");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else cell += c;
    } else if (c === '"') {
      if (cell || closed)
        throw new Error("Check the quoted fields in your CSV.");
      quoted = true;
    } else if (c === "," || c === "\n" || c === "\r") {
      row.push(cell);
      cell = "";
      closed = false;
      if (c !== ",") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        rows.push(row);
        row = [];
      }
    } else {
      if (closed) throw new Error("Remove characters after a closing quote.");
      cell += c;
    }
    if (rows.length > 1001 || row.length > 50 || cell.length > 10000)
      throw new Error("Use at most 1,000 rows and 50 columns.");
  }
  if (quoted) throw new Error("Close the quoted field in your CSV.");
  if (cell || row.length || closed) {
    row.push(cell);
    rows.push(row);
  }
  if (!rows.length) throw new Error("Add a header row to your CSV.");
  rows[0][0] = rows[0][0].replace(/^\uFEFF/, "");
  const headers = rows[0].map((h) => h.trim());
  if (headers.some((h) => !h) || new Set(headers).size !== headers.length)
    throw new Error("Give every column a different name.");
  rows[0] = headers;
  if (rows.slice(1).some((r) => r.length !== headers.length))
    throw new Error("Give every row the same number of columns.");
  return rows;
}
export const csvMappingSchema = z.object({
  title: z.string().min(1).max(100),
  url: z.string().min(1).max(100),
  description: z.string().max(100).optional(),
  tags: z.string().max(100).optional(),
});
export type CsvMapping = z.infer<typeof csvMappingSchema>;
export function mapLinkRows(rows: string[][], mapping: CsvMapping) {
  const [headers, ...records] = rows;
  const take = (row: string[], field: string | undefined) =>
    field ? (row[headers.indexOf(field)] ?? "") : "";
  if (Object.values(mapping).some((value) => value && !headers.includes(value)))
    throw new Error("Choose columns present in your CSV.");
  return records
    .filter((r) => r.some(Boolean))
    .map((row, index) => {
      const data = {
        title: take(row, mapping.title).trim(),
        url: take(row, mapping.url).trim(),
        description: take(row, mapping.description).trim(),
        tags: take(row, mapping.tags)
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      const valid = z
        .object({
          title: z.string().min(1).max(200),
          url: z
            .url()
            .max(2000)
            .refine((s) => {
              const u = new URL(s);
              return (
                ["http:", "https:"].includes(u.protocol) &&
                !u.username &&
                !u.password
              );
            }),
          description: z.string().max(1000),
          tags: z.array(z.string().max(40)).max(12),
        })
        .safeParse(data);
      return valid.success
        ? { row: index + 2, data: valid.data, error: null }
        : {
            row: index + 2,
            data: null,
            error:
              "Add a title and a valid http or https link; keep tags under 40 characters.",
          };
    });
}
