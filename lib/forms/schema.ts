import { z } from "zod";
export const formFieldSchema = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).refine(v => !["__proto__", "constructor", "prototype"].includes(v), "Choose a different field key."), label: z.string().trim().min(1).max(120), type: z.enum(["text", "textarea", "email", "number", "select", "checkbox", "date"]), required: z.boolean().default(false), options: z.array(z.string().trim().min(1).max(150)).max(30).optional() }).superRefine((v, ctx) => { if (v.type === "select" && (!v.options?.length || new Set(v.options).size !== v.options.length)) ctx.addIssue({ code: "custom", message: "Choice fields need distinct options.", path: ["options"] }); });
export const fieldsSchema = z.array(formFieldSchema).min(1).max(40).refine(v => new Set(v.map(f => f.key)).size === v.length, "Field keys must be unique.");
export type FormField = z.infer<typeof formFieldSchema>;
export function answerSchema(fields: FormField[]) {
 const shape: Record<string, z.ZodType> = {};
 for (const f of fields) {
  let s: z.ZodType = f.type === "checkbox" ? (f.required ? z.literal(true, { error: "Please confirm this field." }) : z.boolean()) : f.type === "number" ? z.number().finite().min(-1e12).max(1e12) : f.type === "email" ? z.email().max(254) : f.type === "date" ? z.iso.date() : f.type === "select" ? z.string().refine(v => f.options?.includes(v), "Choose a listed option.") : z.string().trim().min(1).max(f.type === "textarea" ? 5000 : 500);
  if (!f.required) s = z.preprocess(v => v === "" || v === null ? undefined : v, s.optional());
  shape[f.key] = s;
 }
 return z.strictObject(shape);
}
export function csvCell(value: unknown) {
 const s = typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
 // Spreadsheet formula injection: prefix formula-like values before quoting.
 return '"' + (/^[\s]*[=+@-]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"';
}
