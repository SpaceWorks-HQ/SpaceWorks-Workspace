import "server-only";
import { z } from "zod";
import { KEY_PATTERN, normalisePath, SecretsError } from "@/lib/secrets/values";

export const slug = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z][a-z0-9_-]*$/);
export const name = z.string().trim().min(1).max(100);
export const changeSchema = z
  .object({
    key: z.string().regex(KEY_PATTERN),
    path: z.string().transform(normalisePath),
    value: z.string().max(20000).optional(),
    delete: z.boolean().optional(),
    comment: z.string().max(2000).optional(),
    tags: z.array(z.string().max(40)).max(15).optional(),
    ownerId: z.string().max(64).optional(),
    rotateEveryDays: z.number().int().min(1).max(3650).nullable().optional(),
  })
  .refine((v) => v.delete || v.value !== undefined, "Enter a value.");
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new SecretsError("Check the fields and try again.");
  return result.data;
}
