import { z } from "zod";

/** bcrypt compares only the first 72 UTF-8 bytes. Never silently truncate new passwords. */
export const newPasswordSchema = z.string()
  .min(12, "Password must be at least 12 characters")
  .max(128, "Password must be at most 128 characters")
  .refine((value) => new TextEncoder().encode(value).length <= 72, "Password must be at most 72 UTF-8 bytes (use fewer characters).");
