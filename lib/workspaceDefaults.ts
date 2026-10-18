import type { ColumnCategory, LabelTone, LedgerKind } from "@prisma/client";

/** Channels every new workspace starts with; members join them automatically. */
export const DEFAULT_CHANNELS: ReadonlyArray<{ slug: string; name: string; topic: string }> = [
  { slug: "general", name: "general", topic: "Everything the crew needs to know." },
  { slug: "announcements", name: "announcements", topic: "News from the organisers." },
  { slug: "random", name: "random", topic: "Show-and-tell, links and everything else." },
];

/** Board columns template for new projects. */
export const DEFAULT_BOARD_COLUMNS: ReadonlyArray<{ name: string; category: ColumnCategory }> = [
  { name: "To do", category: "TODO" },
  { name: "In progress", category: "IN_PROGRESS" },
  { name: "Review", category: "IN_PROGRESS" },
  { name: "Done", category: "DONE" },
];

export const DEFAULT_LABELS: ReadonlyArray<{ name: string; tone: LabelTone }> = [
  { name: "Bug", tone: "DANGER" },
  { name: "Idea", tone: "INFO" },
  { name: "Help wanted", tone: "WARNING" },
  { name: "Hardware", tone: "ACCENT" },
  { name: "Software", tone: "SUCCESS" },
];

export const DEFAULT_FINANCE_CATEGORIES: ReadonlyArray<{ name: string; kind: LedgerKind }> = [
  { name: "Member contributions", kind: "INCOME" },
  { name: "Sponsorship", kind: "INCOME" },
  { name: "Workshop fees", kind: "INCOME" },
  { name: "Space rent", kind: "EXPENSE" },
  { name: "Components and tools", kind: "EXPENSE" },
  { name: "Food and snacks", kind: "EXPENSE" },
];
