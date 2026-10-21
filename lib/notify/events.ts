type AppReviewPayload = { app: string; platform: "APPLE" | "GOOGLE"; rating: number; author: string; excerpt: string; link: string };

import type { PersonalChannel, WorkspaceRole } from "@prisma/client";

/**
 * Event catalogue for `dispatch()` (pure and client-safe, so routing UIs can
 * list event types). Every area that notifies anyone adds nothing here at
 * runtime: the full catalogue ships now so later phases only call
 * `dispatch(workspaceId, { type, ..., data })` with a typed payload.
 *
 * Naming: lowercase dot-separated segments, `<area>.<subject>[.<verb>]`.
 * Rules match exact types, `<prefix>.*` or `*`.
 *
 * Payloads carry ids and small facts only (they are stored on the event and
 * sent to webhook destinations). Never put secrets or private message
 * bodies in `data`; human text goes in the event's title/body.
 */

export type Severity = "info" | "warning" | "critical";

/** BROADCAST = routed by workspace/scoped rules; PERSONAL = sent to `recipients`. */
export type EventAudience = "broadcast" | "personal" | "both";

export const NOTIFY_CATEGORIES = {
  services: { label: "Services", defaultChannels: ["IN_APP"] },
  incidents: { label: "Incidents", defaultChannels: ["IN_APP", "EMAIL"] },
  tasks: { label: "Tasks", defaultChannels: ["IN_APP"] },
  mentions: { label: "Mentions and messages", defaultChannels: ["IN_APP"] },
  announcements: { label: "Announcements", defaultChannels: ["IN_APP"] },
  digests: { label: "Digests", defaultChannels: ["IN_APP", "EMAIL"] },
  finance: { label: "Money and approvals", defaultChannels: ["IN_APP", "EMAIL"] },
  github: { label: "GitHub", defaultChannels: ["IN_APP"] },
  people: { label: "People and rota", defaultChannels: ["IN_APP"] },
  operations: { label: "Operations", defaultChannels: ["IN_APP", "EMAIL"] },
  collaboration: { label: "Meetings, polls and goals", defaultChannels: ["IN_APP"] },
  assistant: { label: "Assistant", defaultChannels: ["IN_APP"] },
  security: { label: "Security", defaultChannels: ["IN_APP", "EMAIL"] },
} as const satisfies Record<string, { label: string; defaultChannels: readonly PersonalChannel[] }>;

export type NotifyCategory = keyof typeof NOTIFY_CATEGORIES;

type Id = string;
type Iso = string;
type IncidentRef = { incidentId: Id; number: number; status: string; monitorIds: Id[] };
type TaskRef = { taskId: Id; taskNumber: number; projectId: Id | null };
type ApprovalRef = { approvalRequestId: Id; subjectType: string; subjectId: Id };
type Decision = "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";
type MaintenanceRef = { maintenanceWindowId: Id; startsAt: Iso | null; endsAt: Iso | null };
type PollRef = { pollId: Id; closesAt: Iso | null };
type GithubRef = { repoId: Id; number: number; url: string };

/** Typed `data` payload per event type. */
export interface EventPayloads {
  "analytics.assumption_due": { adjustmentId: Id; dueOn: Iso };
  "people.responsibility_review_due": { responsibilityId: Id; reviewOn: Iso };
  "marketing.publish_due": { recordId: Id; dueOn: Iso };
  "marketing.follow_up_due": { recordId: Id; dueOn: Iso };
  "it.review_due": { recordId: Id; dueOn: Iso };
  "it.restore_due": { recordId: Id; dueOn: Iso };

  "product_ops.reminder": { recordId: Id; dueOn: Iso };
  "product_ops.estimate_due": { recordId: Id; dueOn: Iso };
  "finance.recurring.due": { recordId: Id; dueOn: Iso };
  "project.update_due": { projectId: Id; dueAt: Iso };
  "moneycontrols.reminder": { recordId: Id; dueOn: Iso };
  "documents.receivable.due": { documentId: Id };
  "ops.people_changed": { recordId: Id };
  "ops.reminder": { recordId: Id };
  "ops.ticket_changed": { recordId: Id };
  "ops.ticket_due": { recordId: Id };
  "ops.safety_changed": { recordId: Id };
  "ops.hours_submitted": { recordId: Id };
  "ops.hours_reviewed": { recordId: Id };

  "social.comment.received": { accountId: string; commentId: string };
  "social.reply.failed": { accountId: string; commentId: string };
  "social.token.expiring": { accountId: string };
  "funding.reminder": { recordId: Id; dueOn: Iso; reason: string };
  "funding.pledge_due": { recordId: Id; dueOn: Iso; reason: string };
  "funding.thank_you_due": { recordId: Id; dueOn: Iso; reason: string };
  "governance.review_due": { recordId: Id; dueOn: Iso; kind: string };
  "doc.review_due": { docId: Id; dueOn: Iso };
  "safeguarding.review_due": { caseId: Id; dueOn: Iso };
  "governance.reminder": { recordId: Id; dueOn: Iso; kind: string };
  "app_review.received": AppReviewPayload;
  "app_review.replied": AppReviewPayload;
  "app_review.reply_failed": AppReviewPayload;
  // Services
  "monitor.down": { monitorId: Id; incidentId: Id | null; statusCode: number | null; error: string | null };
  "monitor.degraded": { monitorId: Id; latencyMs: number | null };
  "monitor.up": { monitorId: Id; incidentId: Id | null; downtimeSec: number | null };
  "monitor.test": { monitorId: Id };
  "heartbeat.missed": { monitorId: Id; lastPingAt: Iso | null; expectedAt: Iso };
  "cert.expiring": { monitorId: Id; host: string; daysLeft: number; validTo: Iso };
  "domain.expiring": { monitorId: Id; domain: string; daysLeft: number; expiresAt: Iso };
  "cloud.resource_unhealthy": { connectionId: Id; resourceId: Id; status: string };
  "cloud.alarm": { connectionId: Id; alarmName: string; state: string };
  "cost.threshold_exceeded": { costBudgetId: Id; connectionId: Id | null; thresholdPct: number; spentMinor: number; limitMinor: number; currency: string };
  "checker.offline": { lastHeartbeatAt: Iso | null };
  // Incidents and maintenance
  "incident.opened": IncidentRef;
  "incident.updated": IncidentRef;
  "incident.acknowledged": IncidentRef & { acknowledgedById: Id };
  "incident.escalated": IncidentRef & { step: number };
  "incident.resolved": IncidentRef & { durationSec: number | null };
  "oncall.page": { incidentId: Id; scheduleId: Id | null };
  "maintenance.scheduled": MaintenanceRef;
  "maintenance.started": MaintenanceRef;
  "maintenance.ended": MaintenanceRef;
  // Tasks
  "task.assigned": TaskRef;
  "task.due": TaskRef & { dueAt: Iso };
  "task.overdue": TaskRef & { dueAt: Iso };
  "task.commented": TaskRef & { commentId: Id };
  "task.status_changed": TaskRef & { fromColumnId: Id | null; toColumnId: Id | null };
  "task.unblocked": TaskRef & { blockerTaskId: Id };
  // Mentions and chat
  mention: { sourceType: "message" | "task_comment" | "doc" | "meeting"; sourceId: Id; channelId: Id | null };
  "message.dm": { channelId: Id; messageId: Id };
  "thread.reply": { channelId: Id; messageId: Id; parentId: Id };
  // Community
  "announcement.published": { announcementId: Id };
  "member.joined": { userId: Id };
  // Digests and assistant
  "digest.ready": { frequency: "hourly" | "daily" | "weekly" | "custom"; jobId: Id | null };
  "assistant.job.completed": { jobId: Id | null; conversationId: Id | null; status: "ok" | "failed" };
  "boardroom.summary_ready": { sessionId: Id };
  "seo.report_ready": { siteId: Id; auditId: Id | null };
  // Manual finance reminders carry record ids, never payroll data.
  "finance.bill.overdue": { billId: Id; dueOn: Iso };
  "finance.receipt.missing": { entryId: Id };
  "finance.month.review_due": { month: string };
  "finance.disbursement.due": { disbursementId: Id };
  // Money and approvals
  "finance.approval.requested": ApprovalRef & { amountMinor: number | null; currency: string | null };
  "finance.approval.decided": ApprovalRef & { decision: Decision };
  "finance.reimbursement.paid": { reimbursementId: Id; amountMinor: number; currency: string };
  "invoice.overdue": { invoiceId: Id; number: string; dueOn: Iso };
  "budget.threshold": { budgetId: Id; thresholdPct: number; spentMinor: number; amountMinor: number; currency: string };
  "approval.requested": ApprovalRef;
  "approval.decided": ApprovalRef & { decision: Decision };
  // GitHub
  "github.pr.opened": GithubRef;
  "github.review.requested": GithubRef;
  "github.ci.failed": { repoId: Id; runId: string; branch: string | null; url: string };
  "github.release.published": { repoId: Id; tag: string; url: string };
  "github.issue.opened": GithubRef;
  // People and rota
  "team.member_added": { teamId: Id; userId: Id };
  "onboarding.task_due": { runId: Id; itemId: Id; dueAt: Iso };
  "offboarding.started": { runId: Id; subjectUserId: Id };
  "availability.changed": { availabilityId: Id; userId: Id };
  "certification.expiring": { certificationId: Id; certTypeId: Id; expiresAt: Iso };
  "shift.reminder": { shiftId: Id; startsAt: Iso };
  "shift.unfilled": { shiftId: Id; startsAt: Iso; openSpots: number };
  "shift.swap_requested": { swapRequestId: Id; shiftId: Id };
  "shift.swap_accepted": { swapRequestId: Id; shiftId: Id };
  // Operations
  "renewal.due": { subscriptionId: Id; renewsAt: Iso; daysLeft: number };
  "asset.maintenance_due": { assetId: Id; dueAt: Iso };
  "form.submitted": { formId: Id; submissionId: Id };
  "vault.access.requested": { accessRequestId: Id; itemId: Id };
  "vault.item_revealed": { itemId: Id; byUserId: Id };
  "vault.rotation_due": { itemId: Id; dueAt: Iso };
  "catalogue.gap": { serviceIds: Id[] };
  "contact.follow_up_due": { contactId: Id; dueAt: Iso };
  "deal.stage_changed": { dealId: Id; organisationId: Id; stage: string };
  // Work and collaboration
  "cycle.started": { cycleId: Id; projectId: Id | null };
  "cycle.completed": { cycleId: Id; projectId: Id | null };
  "meeting.scheduled": { meetingId: Id; startsAt: Iso };
  "meeting.updated": { meetingId: Id; startsAt: Iso };
  "meeting.cancelled": { meetingId: Id; startsAt: Iso };
  "meeting.reminder": { meetingId: Id; startsAt: Iso };
  "calendar.reminder": { entryId: Id };
  "meeting.agenda_reminder": { meetingId: Id; startsAt: Iso };
  "meeting.summary_published": { meetingId: Id };
  "poll.opened": PollRef;
  "poll.closing_soon": PollRef;
  "poll.closed": PollRef;
  "signature.requested": { signatureRequestId: Id; docId: Id };
  "goal.check_in_due": { goalId: Id };
  // Platform and security
  "export.ready": { exportJobId: Id };
  "import.finished": { importJobId: Id; created: number; updated: number; skipped: number; errors: number };
  "security.new_login": { userId: Id };
  "destination.failing": { destinationId: Id; error: string };
  "notification.test": { destinationId: Id };
}

export type EventType = keyof EventPayloads;

export type EventSpec = {
  category: NotifyCategory;
  severity: Severity;
  audience: EventAudience;
  /** Short label for rule editors and the preference matrix. */
  label: string;
  /** Recipients below this role never receive it (dispatch re-checks membership). */
  minRole?: WorkspaceRole;
};

const s = (category: NotifyCategory, label: string, audience: EventAudience, severity: Severity = "info", minRole?: WorkspaceRole): EventSpec =>
  minRole ? { category, label, audience, severity, minRole } : { category, label, audience, severity };

export const EVENT_CATALOG = {
  "analytics.assumption_due": s("finance", "Forecast assumption due", "personal", "info", "ADMIN"),
  "people.responsibility_review_due": s("people", "Responsibility review due", "personal", "info", "MEMBER"),
  "marketing.publish_due": s("operations", "Content publish date", "personal", "info", "MEMBER"),
  "marketing.follow_up_due": s("operations", "Outreach follow-up", "personal", "info", "ADMIN"),
  "it.review_due": s("security", "Access review due", "personal", "warning", "ADMIN"),
  "it.restore_due": s("security", "Restore test due", "personal", "warning", "ADMIN"),
  "product_ops.reminder": s("operations", "Product work due", "personal", "warning", "MEMBER"),
  "product_ops.estimate_due": s("finance", "Funding estimate due", "personal", "warning", "ADMIN"),
  "finance.recurring.due": s("finance", "Recurring cost due", "personal", "warning", "MEMBER"),
  "project.update_due": s("tasks", "Weekly project update due", "personal", "info", "MEMBER"),
  "moneycontrols.reminder": s("finance", "Internal control due", "personal", "warning", "MEMBER"),
  "ops.people_changed": s("operations", "People tool update", "personal", "info", "MEMBER"),
  "ops.reminder": s("operations", "People and service reminder", "personal", "info", "MEMBER"),
  "ops.ticket_changed": s("operations", "Help desk update", "personal", "info", "MEMBER"),
  "ops.ticket_due": s("operations", "Help desk target overdue", "personal", "warning", "MEMBER"),
  "ops.safety_changed": s("operations", "Confidential safety report update", "personal", "info", "MEMBER"),
  "ops.hours_submitted": s("operations", "Volunteer hours to review", "personal", "info", "MEMBER"),
  "ops.hours_reviewed": s("operations", "Volunteer hours reviewed", "personal", "info", "MEMBER"),

  "social.comment.received": s("operations", "Social comment received", "broadcast", "info", "MEMBER"),
  "social.reply.failed": s("operations", "Social reply failed", "broadcast", "warning", "MEMBER"),
  "social.token.expiring": s("operations", "Social connection expiring", "broadcast", "warning", "ADMIN"),
  "documents.receivable.due": s("finance", "Receivable follow-up", "personal", "warning", "ADMIN"),
  "funding.reminder": s("finance", "Funding deadline", "personal", "warning", "ADMIN"),
  "funding.pledge_due": s("finance", "Pledge instalment due", "personal", "warning", "ADMIN"),
  "funding.thank_you_due": s("finance", "Donation thank-you due", "personal", "info", "ADMIN"),
  "governance.review_due": s("operations", "Governance review", "personal", "warning", "ADMIN"),
  "doc.review_due": s("operations", "Document review", "personal", "warning", "MEMBER"),
  "safeguarding.review_due": s("operations", "Confidential case review", "personal", "warning", "MEMBER"),
  "governance.reminder": s("operations", "Governance deadline", "personal", "warning", "ADMIN"),
  "finance.bill.overdue": s("finance", "Supplier bill overdue", "personal", "warning", "ADMIN"),
  "finance.receipt.missing": s("finance", "Receipt needed", "personal", "warning", "ADMIN"),
  "finance.month.review_due": s("finance", "Monthly spending review due", "personal", "info", "ADMIN"),
  "finance.disbursement.due": s("finance", "Disbursement due", "personal", "warning", "ADMIN"),
  "app_review.received": s("operations", "App review received", "broadcast", "info", "MEMBER"),
  "app_review.replied": s("operations", "App review reply published", "broadcast", "info", "MEMBER"),
  "app_review.reply_failed": s("operations", "App review reply failed", "broadcast", "warning", "MEMBER"),
  "monitor.down": s("services", "Monitor down", "broadcast", "critical", "MEMBER"),
  "monitor.degraded": s("services", "Monitor degraded", "broadcast", "warning", "MEMBER"),
  "monitor.up": s("services", "Monitor recovered", "broadcast", "info", "MEMBER"),
  "monitor.test": s("services", "Test alert", "broadcast", "info", "MEMBER"),
  "heartbeat.missed": s("services", "Heartbeat missed", "broadcast", "critical", "MEMBER"),
  "cert.expiring": s("services", "Certificate expiring", "broadcast", "warning", "MEMBER"),
  "domain.expiring": s("services", "Domain expiring", "broadcast", "warning", "MEMBER"),
  "cloud.resource_unhealthy": s("services", "Cloud resource unhealthy", "broadcast", "warning", "MEMBER"),
  "cloud.alarm": s("services", "Cloud alarm", "broadcast", "warning", "MEMBER"),
  "cost.threshold_exceeded": s("services", "Cloud cost threshold", "broadcast", "warning", "ADMIN"),
  "checker.offline": s("services", "Checker offline", "broadcast", "critical", "ADMIN"),

  "incident.opened": s("incidents", "Incident opened", "both", "critical", "MEMBER"),
  "incident.updated": s("incidents", "Incident updated", "both", "info", "MEMBER"),
  "incident.acknowledged": s("incidents", "Incident acknowledged", "both", "info", "MEMBER"),
  "incident.escalated": s("incidents", "Incident escalated", "both", "critical", "MEMBER"),
  "incident.resolved": s("incidents", "Incident resolved", "both", "info", "MEMBER"),
  "oncall.page": s("incidents", "On-call page", "personal", "critical", "MEMBER"),
  "maintenance.scheduled": s("incidents", "Maintenance scheduled", "both", "info", "MEMBER"),
  "maintenance.started": s("incidents", "Maintenance started", "both", "info", "MEMBER"),
  "maintenance.ended": s("incidents", "Maintenance ended", "both", "info", "MEMBER"),

  "task.assigned": s("tasks", "Task assigned to you", "both"),
  "task.due": s("tasks", "Task due soon", "personal"),
  "task.overdue": s("tasks", "Task overdue", "personal", "warning"),
  "task.commented": s("tasks", "Comment on your task", "personal"),
  "task.status_changed": s("tasks", "Task moved", "both"),
  "task.unblocked": s("tasks", "Task unblocked", "personal"),

  mention: s("mentions", "Mentioned you", "personal"),
  "message.dm": s("mentions", "Direct message", "personal"),
  "thread.reply": s("mentions", "Reply in your thread", "personal"),

  "announcement.published": s("announcements", "Announcement published", "both"),
  "member.joined": s("people", "Member joined", "both"),

  "digest.ready": s("digests", "Digest ready", "both"),
  "assistant.job.completed": s("assistant", "Assistant job finished", "both", "info", "MEMBER"),
  "boardroom.summary_ready": s("assistant", "Boardroom summary ready", "both", "info", "MEMBER"),
  "seo.report_ready": s("assistant", "SEO report ready", "both", "info", "ADMIN"),

  "finance.approval.requested": s("finance", "Spend approval needed", "both", "info", "MEMBER"),
  "finance.approval.decided": s("finance", "Spend approval decided", "personal", "info", "MEMBER"),
  "finance.reimbursement.paid": s("finance", "Reimbursement paid", "personal", "info", "MEMBER"),
  "invoice.overdue": s("finance", "Invoice overdue", "broadcast", "warning", "ADMIN"),
  "budget.threshold": s("finance", "Budget threshold reached", "both", "warning", "MEMBER"),
  "approval.requested": s("operations", "Approval needed", "personal", "info", "MEMBER"),
  "approval.decided": s("operations", "Approval decided", "personal", "info", "MEMBER"),

  "github.pr.opened": s("github", "Pull request opened", "broadcast", "info", "MEMBER"),
  "github.review.requested": s("github", "Review requested", "personal", "info", "MEMBER"),
  "github.ci.failed": s("github", "CI failed", "both", "warning", "MEMBER"),
  "github.release.published": s("github", "Release published", "broadcast", "info", "MEMBER"),
  "github.issue.opened": s("github", "Issue opened", "broadcast", "info", "MEMBER"),

  "team.member_added": s("people", "Added to a team", "both"),
  "onboarding.task_due": s("people", "Checklist item due", "personal", "info", "MEMBER"),
  "offboarding.started": s("people", "Offboarding started", "both", "info", "ADMIN"),
  "availability.changed": s("people", "Teammate away", "both", "info", "MEMBER"),
  "certification.expiring": s("people", "Sign-off expiring", "personal", "info", "MEMBER"),
  "shift.reminder": s("people", "Shift reminder", "personal", "info", "MEMBER"),
  "shift.unfilled": s("people", "Shift unfilled", "both", "warning", "MEMBER"),
  "shift.swap_requested": s("people", "Shift swap requested", "both", "info", "MEMBER"),
  "shift.swap_accepted": s("people", "Shift swap accepted", "personal", "info", "MEMBER"),

  "renewal.due": s("operations", "Renewal due", "both", "warning", "MEMBER"),
  "asset.maintenance_due": s("operations", "Maintenance due", "both", "info", "MEMBER"),
  "form.submitted": s("operations", "Form submitted", "both", "info", "MEMBER"),
  "vault.access.requested": s("security", "Vault access requested", "personal", "info", "MEMBER"),
  "vault.item_revealed": s("security", "Vault secret revealed", "both", "warning", "ADMIN"),
  "vault.rotation_due": s("security", "Credential rotation due", "both", "warning", "MEMBER"),
  "catalogue.gap": s("operations", "Service catalogue gaps", "both", "info", "ADMIN"),
  "contact.follow_up_due": s("operations", "Contact follow-up due", "personal", "info", "MEMBER"),
  "deal.stage_changed": s("operations", "Sponsor deal moved", "both", "info", "MEMBER"),

  "cycle.started": s("collaboration", "Cycle started", "both", "info", "MEMBER"),
  "cycle.completed": s("collaboration", "Cycle completed", "both", "info", "MEMBER"),
  "meeting.scheduled": s("collaboration", "Meeting scheduled", "personal"),
  "meeting.updated": s("collaboration", "Meeting updated", "personal"),
  "meeting.cancelled": s("collaboration", "Meeting cancelled", "personal"),
  "meeting.reminder": s("collaboration", "Meeting reminder", "personal"),
  "calendar.reminder": s("collaboration", "Calendar reminder", "personal"),
  "meeting.agenda_reminder": s("collaboration", "Add agenda items", "personal"),
  "meeting.summary_published": s("collaboration", "Meeting summary", "both"),
  "poll.opened": s("collaboration", "Poll opened", "both"),
  "poll.closing_soon": s("collaboration", "Poll closing soon", "personal"),
  "poll.closed": s("collaboration", "Poll closed", "both"),
  "signature.requested": s("collaboration", "Signature requested", "personal"),
  "goal.check_in_due": s("collaboration", "Goal check-in due", "personal", "info", "MEMBER"),

  "export.ready": s("security", "Export ready", "personal", "info", "ADMIN"),
  "import.finished": s("operations", "Import finished", "personal", "info", "MEMBER"),
  "security.new_login": s("security", "New sign-in", "personal", "warning"),
  "destination.failing": s("security", "Notification destination failing", "personal", "warning", "ADMIN"),
  "notification.test": s("security", "Test notification", "broadcast"),
} as const satisfies Record<EventType, EventSpec>;

export const EVENT_TYPES = Object.keys(EVENT_CATALOG) as EventType[];

export function isEventType(value: string): value is EventType {
  return Object.prototype.hasOwnProperty.call(EVENT_CATALOG, value);
}

export function eventSpec(type: EventType): EventSpec {
  return EVENT_CATALOG[type];
}

/** Event types grouped by category, for rule editors and the preference matrix. */
export function eventTypesByCategory(): Record<NotifyCategory, EventType[]> {
  const grouped = Object.fromEntries(Object.keys(NOTIFY_CATEGORIES).map((key) => [key, [] as EventType[]])) as Record<NotifyCategory, EventType[]>;
  for (const type of EVENT_TYPES) grouped[EVENT_CATALOG[type].category].push(type);
  return grouped;
}

export const audienceIncludesBroadcast = (audience: EventAudience) => audience !== "personal";
export const audienceIncludesPersonal = (audience: EventAudience) => audience !== "broadcast";
