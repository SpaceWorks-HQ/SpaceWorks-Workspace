import type { Calculation, DocumentLine } from "../types";
import { lineSchema } from "./line-schema";

const divRound = (a: bigint, b: bigint) => (a + b / BigInt(2)) / b;
const bounded = (n: bigint) => {
  if (n < BigInt(0) || n > BigInt(2147483647))
    throw new Error("This amount is above the supported document limit.");
  return Number(n);
};
export function calculate(
  lines: DocumentLine[],
  mode: "INTRA" | "INTER" | "VAT" | "NONE",
  roundRupee = false,
  reverseCharge = false,
): Calculation {
  const rows = lines.map((raw) => {
    const l = lineSchema.parse(raw);
    const q = BigInt(l.quantity.replace(".", ""));
    const scale = BigInt(10) ** BigInt((l.quantity.split(".")[1] ?? "").length);
    if (q === BigInt(0)) throw new Error("Quantity must be greater than zero.");
    const gross = divRound(q * BigInt(l.unitMinor), scale),
      taxable = gross - BigInt(l.discountMinor);
    if (taxable < BigInt(0))
      throw new Error("Discount cannot exceed the line value.");
    const taxed = !l.exempt && mode !== "NONE";
    const tax = taxed
      ? divRound(taxable * BigInt(l.rateBps), BigInt(10000))
      : BigInt(0);
    const cgst =
      mode === "INTRA"
        ? divRound(taxable * BigInt(taxed ? l.rateBps : 0), BigInt(20000))
        : BigInt(0);
    const sgst = mode === "INTRA" ? tax - cgst : BigInt(0);
    const cess = taxed
      ? divRound(taxable * BigInt(l.cessBps), BigInt(10000))
      : BigInt(0);
    return {
      ...l,
      grossMinor: bounded(gross),
      taxableMinor: bounded(taxable),
      cgstMinor: bounded(cgst),
      sgstMinor: bounded(sgst),
      igstMinor: mode === "INTER" ? bounded(tax) : 0,
      vatMinor: mode === "VAT" ? bounded(tax) : 0,
      cessMinor: bounded(cess),
    };
  });
  const sum = (
    key:
      | "taxableMinor"
      | "cgstMinor"
      | "sgstMinor"
      | "igstMinor"
      | "cessMinor"
      | "vatMinor",
  ) => bounded(rows.reduce((s, l) => s + BigInt(l[key]), BigInt(0)));
  const taxableMinor = sum("taxableMinor"),
    cgstMinor = sum("cgstMinor"),
    sgstMinor = sum("sgstMinor"),
    igstMinor = sum("igstMinor"),
    cessMinor = sum("cessMinor"),
    vatMinor = sum("vatMinor");
  const subtotal = bounded(
    BigInt(taxableMinor) +
      BigInt(
        reverseCharge
          ? 0
          : cgstMinor + sgstMinor + igstMinor + cessMinor + vatMinor,
      ),
  );
  const totalMinor = roundRupee
    ? bounded(divRound(BigInt(subtotal), BigInt(100)) * BigInt(100))
    : subtotal;
  return {
    policy: "minor-unit-half-up-v1",
    mode,
    rows,
    taxableMinor,
    cgstMinor,
    sgstMinor,
    igstMinor,
    cessMinor,
    vatMinor,
    roundOffMinor: totalMinor - subtotal,
    totalMinor,
  };
}
