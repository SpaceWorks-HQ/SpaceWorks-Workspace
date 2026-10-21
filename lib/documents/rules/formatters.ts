import { parseMoneyToMinor } from "@/lib/format/money";

export function financialYear(date: string, start = 4) {
  const [year, month] = date.split("-").map(Number);
  const y = month < start ? year - 1 : year;
  return `${y}-${String(y + 1).slice(-2)}`;
}
export function serialNumber(
  prefix: string,
  fy: string,
  n: number,
  padding = 5,
  indianGst = true,
) {
  const number = `${prefix}/${fy.slice(2, 4)}${fy.slice(-2)}/${String(n).padStart(padding, "0")}`;
  if (
    !/^[A-Za-z0-9/-]+$/.test(number) ||
    (indianGst && number.length > 16) ||
    !Number.isSafeInteger(n) ||
    n < 1
  )
    throw new Error("Choose a shorter series prefix or padding.");
  return number;
}
export function ageing(dueOn: string, today: string) {
  const days = Math.max(
    0,
    Math.floor((Date.parse(today) - Date.parse(dueOn)) / 86400000),
  );
  return days <= 30
    ? "0–30"
    : days <= 60
      ? "31–60"
      : days <= 90
        ? "61–90"
        : "90+";
}
const small = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
function words(n: number): string {
  if (n < 20) return small[n];
  if (n < 100)
    return (
      [
        "",
        "",
        "Twenty",
        "Thirty",
        "Forty",
        "Fifty",
        "Sixty",
        "Seventy",
        "Eighty",
        "Ninety",
      ][Math.floor(n / 10)] + (n % 10 ? "-" + small[n % 10] : "")
    );
  for (const [size, name] of [
    [10000000, "Crore"],
    [100000, "Lakh"],
    [1000, "Thousand"],
    [100, "Hundred"],
  ] as const)
    if (n >= size)
      return (
        words(Math.floor(n / size)) +
        " " +
        name +
        (n % size ? " " + words(n % size) : "")
      );
  return "";
}
export function inrWords(minor: number) {
  return `Rupees ${words(Math.floor(minor / 100))}${minor % 100 ? ` and ${words(minor % 100)} Paise` : ""} Only`;
}
export function mergeLetter(body: string, fields: Record<string, string>) {
  return body.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, rawKey: string) => {
    const key = rawKey.trim();
    if (!Object.hasOwn(fields, key))
      throw new Error(`Unknown merge field: ${key}`);
    return fields[key];
  });
}
export function csvCell(v: unknown) {
  const s = String(v ?? "");
  return (
    '"' + (/^[\s]*[=+@-]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"'
  );
}
export function parseDocumentAmount(
  value: string,
  currency = "INR",
): number | null {
  if (!/^\s*\d[\d,]*(?:\.\d+)?\s*$/.test(value)) return null;
  return parseMoneyToMinor(value, currency);
}
