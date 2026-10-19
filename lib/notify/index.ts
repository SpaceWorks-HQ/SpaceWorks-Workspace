import "server-only";

/**
 * Notification routing. Producers only need `dispatch`:
 *
 *   await dispatch(workspace.id, {
 *     type: "task.assigned",
 *     title: `${actor.name} assigned you BOT-12`,
 *     url: `/w/${workspace.slug}/projects/BOT/tasks/12`,
 *     actorId: actor.id,
 *     recipients: [assigneeId],
 *     resource: { type: "task", id: task.id },
 *     scope: { projectId: task.projectId ?? undefined, taskId: task.id },
 *     data: { taskId: task.id, taskNumber: task.number, projectId: task.projectId },
 *   }, { tx });            // optional: commit with your change, then await result.afterCommit()
 */
export { dispatch, sendTest, NOTIFY_DELIVER_KIND } from "@/lib/notify/dispatch";
export { processNotifyDelivery } from "@/lib/notify/deliver";
export { getScopedDestinationIds, listPickableDestinations, setScopedDestinations } from "@/lib/notify/scopedRules";
export { EVENT_CATALOG, EVENT_TYPES, NOTIFY_CATEGORIES, eventSpec, eventTypesByCategory, isEventType } from "@/lib/notify/events";
export type { EventPayloads, EventSpec, EventType, NotifyCategory, Severity } from "@/lib/notify/events";
export type { AnyNotificationEvent, DispatchOptions, DispatchResult, NotificationEvent, NotifyScope, RenderedMessage } from "@/lib/notify/types";
