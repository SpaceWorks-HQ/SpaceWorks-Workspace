import { z } from "zod";

/**
 * Checklist templates and run items (pure and client-safe): template item
 * parsing, item generation for a run, offboarding items generated from what
 * a leaving member holds, and progress.
 */

export const ASSIGNEE_RULES = ["SUBJECT", "ROLE", "TEAM_LEAD", "USER"] as const;
export type AssigneeRule = (typeof ASSIGNEE_RULES)[number];

export const ASSIGNEE_RULE_LABELS: Record<AssigneeRule, string> = {
  SUBJECT: "The person joining or leaving",
  ROLE: "Someone with a role",
  TEAM_LEAD: "A team lead",
  USER: "A specific member",
};

export const templateItemSchema = z.object({
  title: z.string().trim().min(1, "Give every item a title.").max(160, "Keep item titles under 160 characters."),
  descriptionMd: z.string().trim().max(2000).nullish().transform((value) => value || null),
  assigneeRule: z.enum(ASSIGNEE_RULES).default("SUBJECT"),
  assigneeRef: z.string().trim().max(64).nullish().transform((value) => value || null),
  dueOffsetDays: z.coerce.number().int().min(0, "Due days can't be negative.").max(365, "Keep due dates within a year.").default(0),
  required: z.boolean().default(true),
  link: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((value) => value || null)
    .refine((value) => value === null || /^(https?:\/\/|\/(?!\/))/.test(value), "Links start with https:// or /."),
});
export type TemplateItem = z.output<typeof templateItemSchema>;

export const templateItemsSchema = z.array(templateItemSchema).min(1, "Add at least one item.").max(80, "Keep a checklist under 80 items.");

/** Stored template JSON → items; bad rows are dropped instead of breaking a run. */
export function parseTemplateItems(value: unknown): TemplateItem[] {
  if (!Array.isArray(value)) return [];
  const items: TemplateItem[] = [];
  for (const raw of value) {
    const parsed = templateItemSchema.safeParse(raw);
    if (parsed.success) items.push(parsed.data);
  }
  return items;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type RunItemDraft = {
  title: string;
  descriptionMd: string | null;
  assigneeId: string | null;
  dueAt: Date | null;
  required: boolean;
  sourceType: string | null;
  sourceId: string | null;
  sortOrder: number;
};

/**
 * Items for a new run. `resolve` maps a rule (and its ref) to a member id,
 * or null when nobody fits (the item stays unassigned for an admin). The due
 * date is `startAt` plus the offset (offset 0 = due the day it starts).
 */
export function buildRunItems(items: readonly TemplateItem[], options: { startAt: Date; resolve: (rule: AssigneeRule, ref: string | null) => string | null; sortStart?: number }): RunItemDraft[] {
  return items.map((item, index) => ({
    title: item.title,
    descriptionMd: [item.descriptionMd, item.link ? `Link: ${item.link}` : null].filter(Boolean).join("\n\n") || null,
    assigneeId: options.resolve(item.assigneeRule, item.assigneeRef),
    dueAt: new Date(options.startAt.getTime() + item.dueOffsetDays * DAY_MS),
    required: item.required,
    sourceType: null,
    sourceId: null,
    sortOrder: (options.sortStart ?? 0) + index,
  }));
}

/** What a leaving member holds, read from other areas (read-only). */
export type OffboardingSources = {
  vaultItemsOwned: Array<{ id: string; title: string }>;
  /** Items they could reveal through a direct grant or did reveal: rotate these. */
  vaultItemsToRotate: Array<{ id: string; title: string }>;
  servicesOwned: Array<{ id: string; name: string; backup: boolean }>;
  assetsOwned: Array<{ id: string; name: string; tag: string }>;
  accessCredentials: Array<{ id: string; label: string; type: string }>;
  itAssignments?: Array<{ id: string; title: string; kind: string }>;
  toolAccounts?: Array<{ id: string; title: string; identity: string }>;
  subscriptionsOwned: Array<{ id: string; name: string }>;
  identityLinks: Array<{ id: string; provider: string; username: string | null }>;
  teams: Array<{ id: string; name: string; lead: boolean }>;
  openTasks: Array<{ id: string; ref: string; title: string }>;
};

export const emptyOffboardingSources = (): OffboardingSources => ({
  vaultItemsOwned: [],
  vaultItemsToRotate: [],
  servicesOwned: [],
  assetsOwned: [],
  accessCredentials: [],
  subscriptionsOwned: [],
  identityLinks: [],
  teams: [],
  openTasks: [],
});

const CREDENTIAL_WORDS: Record<string, string> = { KEY: "key", FOB: "fob", CARD: "access card", CODE: "door code" };

/**
 * Offboarding items generated from what the member holds. Each points back
 * at its record (`sourceType`/`sourceId`). Rotations and returns are
 * required; reassignments too, except backup ownership and task handover.
 * Items are assigned to `adminId` (whoever started offboarding).
 */
export function offboardingItems(sources: OffboardingSources, options: { adminId: string | null; dueAt: Date | null; sortStart?: number }): RunItemDraft[] {
  const drafts: Array<Omit<RunItemDraft, "sortOrder" | "assigneeId" | "dueAt">> = [];
  const add = (title: string, sourceType: string, sourceId: string, required = true, descriptionMd: string | null = null) =>
    drafts.push({ title: title.slice(0, 200), descriptionMd, required, sourceType, sourceId });

  const rotate = new Map(sources.vaultItemsToRotate.map((item) => [item.id, item]));
  for (const item of sources.vaultItemsOwned) {
    add(`Reassign vault item "${item.title}" to a new owner`, "vault_item", item.id);

  }
  for (const item of rotate.values()) add(`Rotate the secret in "${item.title}"`, "vault_item", item.id, true, "They could reveal this secret. Change it and save the new value in the vault.");
  for (const service of sources.servicesOwned) add(`${service.backup ? "Pick a new backup owner" : "Reassign ownership"} of the ${service.name} service`, "service", service.id, !service.backup);
  for (const asset of sources.assetsOwned) add(`Reassign ${asset.name} (${asset.tag}) to a new owner`, "asset", asset.id, false);
  for (const credential of sources.accessCredentials) add(`Collect the ${CREDENTIAL_WORDS[credential.type] ?? "credential"} "${credential.label}"`, "access_credential", credential.id);
  for (const record of sources.itAssignments ?? []) add(`${record.kind === "DEVICE" ? "Collect and return" : "Release the licence seat for"} ${record.title}`, "marketing_it", record.id, true, "Open IT administration, record the handover or release the seat, then complete this item.");
  for (const account of sources.toolAccounts ?? []) add(`Revoke ${account.title} (${account.identity})`, "funding", account.id, true, "Remove access in the tool, then mark the account Removed in Funding and impact.");
  for (const subscription of sources.subscriptionsOwned) add(`Reassign the ${subscription.name} subscription`, "subscription", subscription.id);
  for (const link of sources.identityLinks) add(`Unlink their ${providerLabel(link.provider)} account${link.username ? ` (${link.username})` : ""}`, "identity_link", link.id);
  for (const team of sources.teams) add(team.lead ? `Hand over leading ${team.name} and remove them from the team` : `Remove them from ${team.name}`, "team", team.id, team.lead);
  for (const task of sources.openTasks) add(`Reassign ${task.ref}: ${task.title}`, "task", task.id, false);

  const start = options.sortStart ?? 0;
  return drafts.map((draft, index) => ({ ...draft, assigneeId: options.adminId, dueAt: options.dueAt, sortOrder: start + index }));
}

function providerLabel(provider: string) {
  const known: Record<string, string> = { SLACK: "Slack", DISCORD: "Discord", MATTERMOST: "Mattermost", TELEGRAM: "Telegram", WHATSAPP: "WhatsApp" };
  return known[provider] ?? provider.charAt(0) + provider.slice(1).toLowerCase();
}

export type ProgressItem = { doneAt: Date | null; required: boolean };

export function runProgress(items: readonly ProgressItem[]) {
  const done = items.filter((item) => item.doneAt !== null).length;
  const requiredLeft = items.filter((item) => item.required && item.doneAt === null).length;
  return { done, total: items.length, requiredLeft, complete: requiredLeft === 0 };
}

/** Is an item overdue at `now`? Done items never are. */
export function isOverdue(item: { dueAt: Date | null; doneAt: Date | null }, now: Date) {
  return item.doneAt === null && item.dueAt !== null && item.dueAt.getTime() < now.getTime();
}
