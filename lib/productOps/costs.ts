import { CATEGORIES, estimateSchema, type EstimateDetails } from "./schema";
/** All intermediate arithmetic is integer-based; round half up per line, then GST per line. */
const rounded = (value: bigint, divisor: bigint) => Number((value + divisor / BigInt(2)) / divisor);
export function estimateTotals(raw: EstimateDetails) {
 const data = estimateSchema.parse(raw);
 const lines = data.lines.map(line => {
  const baseMinor = rounded(BigInt(line.quantityMilli) * BigInt(line.unitCostMinor), BigInt(1000));
  const taxMinor = rounded(BigInt(baseMinor) * BigInt(line.gstBps), BigInt(10000));
  return { ...line, baseMinor, taxMinor, totalMinor: baseMinor + taxMinor };
 });
 const baseMinor = lines.reduce((sum, line) => sum + line.baseMinor, 0);
 const taxMinor = lines.reduce((sum, line) => sum + line.taxMinor, 0);
 const contingencyMinor = rounded(BigInt(baseMinor + taxMinor) * BigInt(data.contingencyBps), BigInt(10000));
 const totalMinor = baseMinor + taxMinor + contingencyMinor;
 if (!Number.isSafeInteger(totalMinor) || totalMinor > 100000000000000) throw new Error("This estimate is too large. Split it into smaller estimates.");
 const categories = CATEGORIES.map(category => ({ category, baseMinor: lines.filter(l => l.category === category).reduce((sum, l) => sum + l.baseMinor, 0), taxMinor: lines.filter(l => l.category === category).reduce((sum, l) => sum + l.taxMinor, 0) })).filter(c => lines.some(l => l.category === c.category));
 return { lines, categories, baseMinor, taxMinor, contingencyMinor, totalMinor };
}
