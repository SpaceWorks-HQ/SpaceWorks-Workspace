import { z } from "zod";
import { amount, id, text } from "./fields";
export const lineSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.string().regex(/^\d{1,6}(\.\d{1,3})?$/),
  unitMinor: amount,
  discountMinor: amount.default(0),
  hsn: text,
  unit: text,
  rateBps: z.number().int().min(0).max(10000),
  cessBps: z.number().int().min(0).max(10000).default(0),
  exempt: z.boolean().default(false),
  exemption: text,
  ruleId: id,
});
