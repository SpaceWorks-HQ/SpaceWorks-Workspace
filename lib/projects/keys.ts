import type { ColumnCategory } from "@prisma/client";

/** Project keys and board templates (pure, client-safe). */

export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

export function isValidProjectKey(value: string): boolean {
  return PROJECT_KEY_PATTERN.test(value);
}

/** "Line-follower robot" → "LFR"; "Website" → "WEB". Always a valid key. */
export function suggestProjectKey(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
  let key = words.length >= 2 ? words.slice(0, 4).map((word) => word[0]).join("") : (words[0] ?? "").slice(0, 3);
  key = key.toUpperCase().replace(/^[^A-Z]+/, "");
  if (key.length < 2) key = `${key}PRJ`.slice(0, 3);
  return key.slice(0, 10);
}

export type ColumnTemplateKey = "standard" | "simple" | "build";

export const COLUMN_TEMPLATES: Record<ColumnTemplateKey, { label: string; description: string; columns: ReadonlyArray<{ name: string; category: ColumnCategory }> }> = {
  standard: {
    label: "Standard",
    description: "To do, In progress, Review, Done",
    columns: [
      { name: "To do", category: "TODO" },
      { name: "In progress", category: "IN_PROGRESS" },
      { name: "Review", category: "IN_PROGRESS" },
      { name: "Done", category: "DONE" },
    ],
  },
  simple: {
    label: "Simple",
    description: "To do, Doing, Done",
    columns: [
      { name: "To do", category: "TODO" },
      { name: "Doing", category: "IN_PROGRESS" },
      { name: "Done", category: "DONE" },
    ],
  },
  build: {
    label: "Build",
    description: "Ideas, Parts needed, Building, Testing, Shipped",
    columns: [
      { name: "Ideas", category: "TODO" },
      { name: "Parts needed", category: "TODO" },
      { name: "Building", category: "IN_PROGRESS" },
      { name: "Testing", category: "IN_PROGRESS" },
      { name: "Shipped", category: "DONE" },
    ],
  },
};

export const COLUMN_CATEGORY_LABELS: Record<ColumnCategory, string> = { TODO: "Not started", IN_PROGRESS: "In progress", DONE: "Done" };
