/** RFC 4180 CSV with bounded input, strict quoting and spreadsheet-safe exports. */
export function parseCsv(text: string): string[][] {
  if (text.length > 2_000_000) throw new Error("Keep CSV files under 2 MB.");
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false; let closed = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) { if (c === '"') { if (input[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } } else cell += c; if (cell.length > 20000) throw new Error("Keep each CSV cell under 20,000 characters."); continue; }
    if (c === ',' || c === '\n' || c === '\r') {
      row.push(cell); cell = ""; closed = false;
      if (c !== ',') { if (c === '\r' && input[i + 1] === '\n') i++; if (row.some(v => v.length)) rows.push(row); row = []; }
    } else if (c === '"') { if (cell || closed) throw new Error("Fix the CSV quotes and try again."); quoted = true; }
    else { if (closed) throw new Error("Fix the CSV quotes and try again."); cell += c; }
    if (rows.length > 2000 || row.length > 40 || cell.length > 20000) throw new Error("Keep CSV imports under 2,000 rows and 40 columns.");
  }
  if (quoted) throw new Error("Close the CSV quotes and try again.");
  row.push(cell); if (row.length > 40 || cell.length > 20000) throw new Error("Keep CSV imports under 40 columns and 20,000 characters per cell."); if (row.some(v => v.length)) rows.push(row);
  if (rows.length > 2001) throw new Error("Keep CSV imports under 2,000 rows.");
  return rows;
}
const safeCell = (value: unknown) => { const text = String(value ?? ""); return /^[\s]*[=+@\-\t\r]/.test(text) ? `'${text}` : text; };
export function exportCsv(rows: readonly (readonly unknown[])[]) { return rows.map(r => r.map(v => `"${safeCell(v).replace(/"/g, '""')}"`).join(",")).join("\r\n") + "\r\n"; }
export function normalizeEmail(value: string) { return value.trim().toLowerCase(); }
export function normalizeDomain(value: string) {
  try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}
export function duplicateOrganisations(candidate: { name: string; website?: string | null }, existing: readonly { id: string; name: string; domain: string | null }[]) {
  const domain = candidate.website ? normalizeDomain(candidate.website) : "";
  const name = candidate.name.trim().toLowerCase();
  return existing.filter(o => (domain && o.domain && normalizeDomain(o.domain) === domain) || o.name.trim().toLowerCase() === name);
}
export function normalizePhone(value: string) { return value.replace(/[^0-9]/g, ""); }
export type DedupeContact = { id: string; displayName: string; email?: string | null; phone?: string | null };
export function duplicateContacts(candidate: Omit<DedupeContact, "id">, existing: readonly DedupeContact[]) {
  const name = candidate.displayName.trim().toLowerCase().replace(/\s+/g, " ");
  return existing.filter(c => (candidate.email && c.email && normalizeEmail(candidate.email) === normalizeEmail(c.email)) || (candidate.phone && c.phone && normalizePhone(candidate.phone).length >= 7 && normalizePhone(candidate.phone) === normalizePhone(c.phone)) || (name.length >= 3 && c.displayName.trim().toLowerCase().replace(/\s+/g, " ") === name));
}
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
function fold(line: string) {
  const lines: string[] = []; let out = ""; let bytes = 0;
  for (const c of line) { const n = new TextEncoder().encode(c).length; if (bytes + n > 75) { lines.push(out); out = " "; bytes = 1; } out += c; bytes += n; }
  lines.push(out); return lines.join("\r\n");
}
export function exportVCard(contact: { id: string; displayName: string; email?: string | null; phone?: string | null; organisation?: string | null }) {
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `UID:${esc(contact.id)}`, `FN:${esc(contact.displayName)}`, `N:;${esc(contact.displayName)};;;`, ...(contact.email ? [`EMAIL;TYPE=INTERNET:${esc(contact.email)}`] : []), ...(contact.phone ? [`TEL:${esc(contact.phone)}`] : []), ...(contact.organisation ? [`ORG:${esc(contact.organisation)}`] : []), "END:VCARD"];
  return lines.map(fold).join("\r\n") + "\r\n";
}
