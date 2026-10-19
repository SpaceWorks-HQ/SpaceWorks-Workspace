import type { RuleScopeType } from "@prisma/client";
import type { EventPayloads, EventType, Severity } from "@/lib/notify/events";

export type { EventPayloads, EventType, Severity } from "@/lib/notify/events";

/**
 * Scope ids an event carries. Rule filters read them, and a scoped rule
 * (an entity's "Send to" picker) matches when the event carries its entity id
 * under the key from `SCOPE_KEYS`.
 */
export type NotifyScope = {
  monitorId?: string;
  incidentId?: string;
  projectId?: string;
  channelId?: string;
  teamId?: string;
  digestId?: string;
  announcementId?: string;
  formId?: string;
  calendarId?: string;
  subscriptionId?: string;
  costBudgetId?: string;
  cloudConnectionId?: string;
  githubRepoId?: string;
  serviceId?: string;
  boardroomSessionId?: string;
  budgetId?: string;
  meetingId?: string;
  taskId?: string;
  tags?: string[];
};

type ScopeIdKey = Exclude<keyof NotifyScope, "tags">;

/** Event scope key for each scoped rule type. */
export const SCOPE_KEYS: Record<Exclude<RuleScopeType, "WORKSPACE">, ScopeIdKey> = {
  MONITOR: "monitorId",
  INCIDENT: "incidentId",
  PROJECT: "projectId",
  DIGEST: "digestId",
  ANNOUNCEMENT: "announcementId",
  FORM: "formId",
  CALENDAR: "calendarId",
  SUBSCRIPTION: "subscriptionId",
  COST_BUDGET: "costBudgetId",
  CLOUD_CONNECTION: "cloudConnectionId",
  GITHUB_REPO: "githubRepoId",
  SERVICE_CATALOG_ITEM: "serviceId",
  BOARDROOM: "boardroomSessionId",
  BUDGET: "budgetId",
  MEETING: "meetingId",
};

export type NotifyAction = { id: "ack" | "resolve" | "approve" | "reject" | "open"; label: string; url?: string };

/** What a producer passes to `dispatch()`. */
export type NotificationEvent<T extends EventType = EventType> = {
  type: T;
  /** Defaults from the catalogue. */
  severity?: Severity;
  /** Plain text, at most 150 characters. */
  title: string;
  /** Short plain text (markdown subset allowed: bold, italic, code, links, lists). */
  body?: string;
  /** App-relative deep link ("/w/<slug>/..."); adapters make it absolute. */
  url?: string;
  /** Who caused it; never notified about their own action. */
  actorId?: string | null;
  /** User ids for personal delivery. The producer must only list people who may see the resource. */
  recipients?: string[];
  resource?: { type: string; id: string };
  scope?: NotifyScope;
  /** Key facts (status code, amount…), shown by rich adapters. */
  fields?: { label: string; value: string }[];
  actions?: NotifyAction[];
  /** Repeat events with the same key inside a rule's dedupe window are dropped. */
  dedupeKey?: string;
  /** Dedupe window for personal deliveries (default 300 s); rules carry their own. */
  dedupeWindowSec?: number;
  /** Groups related messages (an incident id) into one thread where the adapter supports it. */
  threadKey?: string;
  /** Id of the original NotificationEventRecord when this is a reminder (bypasses dedupe). */
  reminderOf?: string;
  occurredAt?: Date;
  /** False when the entity's "use workspace rules" toggle is off: only its scoped rule applies. */
  useWorkspaceRules?: boolean;
  data: EventPayloads[T];
};

/** Any event, discriminated by `type`. */
export type AnyNotificationEvent = { [K in EventType]: NotificationEvent<K> }[EventType];

export type DispatchOptions = {
  /** Commit the event with the caller's domain change. Then call `result.afterCommit()` once the transaction commits. */
  tx?: import("@prisma/client").Prisma.TransactionClient;
  /** Test send / explicit targeting: only these destinations; bypasses rules, quiet hours and dedupe. */
  onlyDestinationIds?: string[];
  /** Marks deliveries `isTest` (delivery log). */
  test?: boolean;
  /** Clock override for tests. */
  now?: Date;
};

export type DispatchDelivery = {
  id: string | null;
  /** "destination:<id>" or "user:<userId>:<channel>". */
  target: string;
  status: "PENDING" | "SENT" | "SKIPPED";
  reason?: string;
};

export type DispatchResult = {
  /** The stored NotificationEventRecord (or, when deduped, the earlier one). */
  eventId: string;
  deduped: boolean;
  deliveries: DispatchDelivery[];
  /** Realtime nudges for in-app notifications. Already run when dispatch owned the transaction. */
  afterCommit: () => Promise<void>;
};

/** Channel-neutral message every adapter maps to its platform format. */
export type RenderedMessage = {
  title: string;
  /** Plain text rendering (title line excluded). */
  text: string;
  /** Absolute deep link, when the event has one. */
  url: string | null;
  severity: Severity;
  /** "Critical" / "Warning" / "Info": always shown as a word, never colour alone. */
  severityLabel: string;
  fields: { label: string; value: string }[];
  actions: { id: string; label: string; url: string | null }[];
  eventType: EventType;
  workspace: { id: string; slug: string; name: string };
};
