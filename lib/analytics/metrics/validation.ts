import { z } from "zod";
export const dateSchema = z.iso
  .date()
  .refine((v) => v >= "1900-01-01" && v <= "9998-12-31");
export const querySchema = z.object({
  section: z
    .enum([
      "home",
      "finance",
      "funding",
      "people",
      "work",
      "operations",
      "marketing",
    ])
    .default("home"),
  period: z
    .enum(["month", "last-month", "quarter", "fy", "custom"])
    .default("month"),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  fund: z.string().max(64).optional(),
  centre: z.string().max(64).optional(),
  team: z.string().max(64).optional(),
  project: z.string().max(64).optional(),
  programme: z.string().max(64).optional(),
  threshold: z
    .string()
    .regex(/^\d{1,12}$/)
    .optional(),
  group: z.string().max(200).optional(),
  page: z
    .string()
    .regex(/^\d{1,5}$/)
    .optional(),
  bucket: z
    .string()
    .regex(/^\d{4}-\d{2}(-\d{2})?$/)
    .optional(),
  cadence: z.enum(["week", "month"]).optional(),
  monthlyEmail: z.boolean().default(false),
  emailTo: z.array(z.string().min(1).max(64)).max(20).default([]),
});
