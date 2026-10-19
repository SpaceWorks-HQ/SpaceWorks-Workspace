import { escapeHtml } from "@/lib/docs/markdown";

/**
 * Doc templates: a few built-ins plus the workspace's own `Template` rows of
 * kind DOC (written by the templates area; docs only reads them). Template
 * HTML may use {{date}}, {{author}} and {{workspace}}; values are escaped and
 * the result is sanitised again when the doc is created.
 */

export type DocTemplate = { id: string; name: string; description: string; title: string; html: string };

export const BUILTIN_DOC_TEMPLATES: readonly DocTemplate[] = [
  {
    id: "builtin:meeting-notes",
    name: "Meeting notes",
    description: "Agenda, notes, decisions and action items.",
    title: "Meeting notes {{date}}",
    html: [
      "<p><strong>Date:</strong> {{date}}<br><strong>Notes by:</strong> {{author}}</p>",
      "<h2>Attendees</h2><ul><li><p></p></li></ul>",
      "<h2>Agenda</h2><ol><li><p></p></li></ol>",
      "<h2>Notes</h2><p></p>",
      "<h2>Decisions</h2><ul><li><p></p></li></ul>",
      '<h2>Action items</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>',
    ].join(""),
  },
  {
    id: "builtin:runbook",
    name: "Runbook",
    description: "Steps to run, check and recover a system or space.",
    title: "Runbook: ",
    html: [
      "<p><strong>Owner:</strong> {{author}} · <strong>Last checked:</strong> {{date}}</p>",
      "<h2>What this covers</h2><p></p>",
      "<h2>Before you start</h2><ul><li><p>Access you need</p></li><li><p>Tools you need</p></li></ul>",
      "<h2>Steps</h2><ol><li><p></p></li></ol>",
      "<h2>How to check it worked</h2><p></p>",
      "<h2>If something goes wrong</h2><p>Who to call, how to roll back.</p>",
    ].join(""),
  },
  {
    id: "builtin:how-to",
    name: "How-to guide",
    description: "Teach the crew one task, step by step.",
    title: "How to ",
    html: [
      "<p>A short guide for members. Written by {{author}} on {{date}}.</p>",
      "<h2>You will need</h2><ul><li><p></p></li></ul>",
      "<h2>Steps</h2><ol><li><p></p></li></ol>",
      "<h2>Tips</h2><p></p>",
      "<h2>Safety</h2><p></p>",
    ].join(""),
  },
  {
    id: "builtin:project-brief",
    name: "Project brief",
    description: "Why, what and who for a new build or project.",
    title: "Project brief: ",
    html: [
      "<p><strong>Author:</strong> {{author}} · <strong>Date:</strong> {{date}} · <strong>Workspace:</strong> {{workspace}}</p>",
      "<h2>Problem</h2><p></p>",
      "<h2>Goal</h2><p></p>",
      "<h2>Scope</h2><ul><li><p>In: </p></li><li><p>Out: </p></li></ul>",
      "<h2>Crew</h2><table><tbody><tr><th><p>Person</p></th><th><p>Role</p></th></tr><tr><td><p></p></td><td><p></p></td></tr></tbody></table>",
      "<h2>Milestones</h2><ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"false\"><p></p></li></ul>",
      "<h2>Budget and materials</h2><p></p>",
    ].join(""),
  },
];

export type TemplateVariables = { date: string; author: string; workspace: string };

/** Replace {{date}}, {{author}} and {{workspace}}; `escape` for HTML bodies, not for titles. */
export function applyTemplateVariables(text: string, vars: TemplateVariables, escape = true): string {
  return text.replace(/\{\{\s*(date|author|workspace)\s*\}\}/g, (_, key: keyof TemplateVariables) => (escape ? escapeHtml(vars[key]) : vars[key]));
}

/**
 * Body HTML from a workspace `Template.content` (shape owned by the templates
 * area): accepts `{ html }`, `{ body }`, `{ markdown | text }` (as paragraphs)
 * or a plain string. Returns null when nothing usable is there.
 */
export function templateBodyFromContent(content: unknown): string | null {
  if (typeof content === "string") return content.trim() ? `<p>${escapeHtml(content)}</p>` : null;
  if (!content || typeof content !== "object") return null;
  const record = content as Record<string, unknown>;
  for (const key of ["html", "body", "contentHtml"]) {
    if (typeof record[key] === "string" && (record[key] as string).trim()) return record[key] as string;
  }
  for (const key of ["markdown", "text"]) {
    if (typeof record[key] === "string" && (record[key] as string).trim()) {
      return (record[key] as string)
        .split(/\n{2,}/)
        .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
        .join("");
    }
  }
  return null;
}

export function templateTitleFromContent(content: unknown): string | null {
  if (!content || typeof content !== "object") return null;
  const title = (content as Record<string, unknown>).title;
  return typeof title === "string" && title.trim() ? title.trim() : null;
}
