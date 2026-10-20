import { z } from "zod";
import { currencySchema, minorSchema } from "@/lib/finance/tools-rules";
import { isoDateSchema } from "@/lib/finance/schemas";
export const costKinds = [
  "RENT",
  "ELECTRICITY",
  "WATER",
  "INTERNET",
  "MAINTENANCE",
  "SECURITY",
  "CLEANING",
  "SOFTWARE",
  "EMI",
  "INSURANCE",
  "OTHER",
] as const;
export const frequencies = ["MONTHLY", "QUARTERLY", "YEARLY"] as const;
export type Frequency = (typeof frequencies)[number];
const id = z.string().trim().min(1).max(128);
const optionalId = z
  .string()
  .trim()
  .max(128)
  .nullish()
  .transform((v) => v || null);
const percent = z.coerce.number().min(0).max(100);
const integer = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max);
const optionalDay = z
  .string()
  .nullish()
  .transform((v) => v || null)
  .pipe(isoDateSchema.nullable());
export const scheduleSchema = z
  .object({
    id: optionalId,
    requestKey: id,
    title: z.string().trim().min(1).max(120),
    kind: z.enum(costKinds),
    payee: z.string().trim().min(1).max(120),
    contactId: optionalId,
    organisationId: optionalId,
    amountMinor: minorSchema.positive(),
    currency: currencySchema,
    estimated: z.boolean().default(false),
    frequency: z.enum(frequencies),
    dueDay: integer(1, 31),
    startsOn: isoDateSchema,
    endsOn: optionalDay,
    leadDays: integer(0, 90).default(14),
    reminderDays: integer(0, 90).default(7),
    categoryId: optionalId,
    fundId: optionalId,
    costCentreId: optionalId,
    accountId: optionalId,
    ownerId: optionalId,
    gstPercent: percent.default(0),
    tdsSection: z.string().trim().max(40).default(""),
    tdsPercent: percent.default(0),
    leaseId: optionalId,
    subscriptionId: optionalId,
    insuranceId: optionalId,
    depositId: optionalId,
    escalationPercent: percent.default(0),
    renewalOn: optionalDay,
    renewalReminderDays: integer(0, 365).default(30),
    principalMinor: minorSchema.default(0),
    annualRatePercent: percent.default(0),
    tenure: integer(0, 600).default(0),
    status: z.enum(["ACTIVE", "PAUSED", "ENDED"]).default("ACTIVE"),
    notes: z.string().trim().max(4000).default(""),
  })
  .superRefine((v, c) => {
    if (v.endsOn && v.endsOn < v.startsOn)
      c.addIssue({
        code: "custom",
        message: "End after the start date.",
        path: ["endsOn"],
      });
    if (v.kind === "EMI" && (!v.principalMinor || !v.tenure))
      c.addIssue({
        code: "custom",
        message: "Enter principal and number of instalments.",
        path: ["principalMinor"],
      });
    if (v.tdsPercent && !v.tdsSection)
      c.addIssue({
        code: "custom",
        message: "Enter the withholding section.",
        path: ["tdsSection"],
      });
  });
export type ScheduleInput = z.infer<typeof scheduleSchema>;
export const actualSchema = z.object({
  billId: id,
  amountMinor: minorSchema.positive(),
  gstMinor: minorSchema.default(0),
  cgstMinor: minorSchema.default(0),
  sgstMinor: minorSchema.default(0),
  igstMinor: minorSchema.default(0),
  tdsMinor: minorSchema.default(0),
  principalMinor: minorSchema.default(0),
  interestMinor: minorSchema.default(0),
});
export const advanceSchema = z.object({
  requestKey: id,
  profileId: id,
  reason: z.string().trim().min(1).max(2000),
  amountMinor: minorSchema.positive(),
  instalments: integer(1, 120),
  startsOn: isoDateSchema,
  accountId: id,
  fundId: optionalId,
  costCentreId: optionalId,
});
export const recoverySchema = z.object({
  id,
  amountMinor: minorSchema.positive(),
  paidOn: isoDateSchema,
  reference: z.string().trim().min(1).max(120),
  operationKey: z.uuid(),
  payRunId: optionalId,
});
export function monthStep(frequency: string) {
  return frequency === "YEARLY" ? 12 : frequency === "QUARTERLY" ? 3 : 1;
}
export function dueInMonth(year: number, month: number, day: number) {
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate()),
    ),
  );
}
export function firstDue(startsOn: Date, day: number) {
  const d = dueInMonth(startsOn.getUTCFullYear(), startsOn.getUTCMonth(), day);
  return d < startsOn
    ? dueInMonth(startsOn.getUTCFullYear(), startsOn.getUTCMonth() + 1, day)
    : d;
}
export function nextDue(date: Date, frequency: string, day: number) {
  return dueInMonth(
    date.getUTCFullYear(),
    date.getUTCMonth() + monthStep(frequency),
    day,
  );
}
export function monthlyEquivalent(amount: number, frequency: string) {
  return Math.round(amount / monthStep(frequency));
}
export function taxAmounts(
  base: number,
  gstPercent: number,
  tdsPercent: number,
) {
  const gstMinor = Math.round((base * gstPercent) / 100),
    tdsMinor = Math.round((base * tdsPercent) / 100),
    cashMinor = base + gstMinor - tdsMinor;
  if (
    !Number.isSafeInteger(cashMinor) ||
    cashMinor <= 0 ||
    cashMinor > 2147483647 ||
    base + gstMinor > 2147483647 ||
    tdsMinor > cashMinor
  )
    throw new Error("Check the amount and tax rates.");
  return { gstMinor, tdsMinor, cashMinor };
}
export function instalmentAmounts(total: number, count: number) {
  const base = Math.floor(total / count);
  return Array.from(
    { length: count },
    (_, i) => base + (i < total % count ? 1 : 0),
  );
}
export function remittanceDate(month: string, kind: string, ptDay = 15) {
  const [y, m] = month.split("-").map(Number);
  return dueInMonth(
    y!,
    m!,
    kind === "SALARY_TDS" ? 7 : kind === "PT" ? ptDay : 15,
  );
}
export function csvCell(v: unknown) {
  const s = String(v ?? "");
  return `"${(/^[\s]*[=+@-]/.test(s) ? "'" : "") + s.replaceAll('"', '""')}"`;
}
export function csv(rows: unknown[][]) {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
