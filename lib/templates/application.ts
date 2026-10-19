import { z } from "zod";
import { sanitizeDocHtml } from "@/lib/docs/sanitize";
import { applyTemplateVariables } from "@/lib/docs/templates";

export const templateContentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().max(50_000).default(""),
  html: z.string().max(100_000).optional(),
});

export function applyTemplate(
  content: unknown,
  variables: { date: string; author: string; workspace: string },
) {
  const parsed = templateContentSchema.parse(content);
  return {
    title: applyTemplateVariables(parsed.title, variables, false),
    text: applyTemplateVariables(parsed.text, variables, false),
    html: sanitizeDocHtml(applyTemplateVariables(parsed.html ?? "", variables)),
  };
}
