import { z } from "zod";

export const dateSchema = z
  .string()
  .refine(
    (s) =>
      /^\d{4}-\d{2}-\d{2}$/.test(s) &&
      Number.isFinite(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "Enter a valid date.",
  );
export const optionalDate = z.union([dateSchema, z.literal("")]).default("");
export const text = z.string().trim().max(300).default("");
export const long = z.string().trim().max(12000).default("");
export const id = z
  .string()
  .max(64)
  .regex(/^[A-Za-z0-9_-]*$/)
  .default("");
export const amount = z.number().int().min(0).max(2147483647);
