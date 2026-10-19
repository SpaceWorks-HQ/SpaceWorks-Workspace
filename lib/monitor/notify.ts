import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { dispatch, type DispatchResult, type NotificationEvent } from "@/lib/notify";
import type { EventType } from "@/lib/notify/events";

/**
 * Event helpers for the monitor: every alert goes through `dispatch()` with
 * `scope.monitorId` / `incidentId` (so the monitor's "Send to" rule
 * matches), the monitor's `useWorkspaceRules`, a `dedupeKey` and a
 * `threadKey` of `incident:<id>` for incident conversations.
 */

export type WorkspaceRef = { id: string; slug: string };
export type MonitorRef = { id: string; name: string; tags: string[]; useWorkspaceRules: boolean };

export const monitorUrl = (ws: WorkspaceRef, monitorId: string) => `/w/${ws.slug}/services/monitors/${monitorId}`;
export const incidentUrl = (ws: WorkspaceRef, number: number) => `/w/${ws.slug}/services/incidents/${number}`;

/** Admins and owners get incident events personally (in-app at least) even without rules. */
export async function incidentResponders(workspaceId: string, client: DbClient = prisma): Promise<string[]> {
  const rows = await client.membership.findMany({ where: { workspaceId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } }, select: { userId: true } });
  return rows.map((row) => row.userId);
}

/** Collects dispatch results inside a transaction and runs their realtime nudges after commit. */
export class EventBatch {
  private results: DispatchResult[] = [];
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async send<T extends EventType>(workspaceId: string, event: NotificationEvent<T>) {
    const result = await dispatch(workspaceId, event, { tx: this.tx });
    this.results.push(result);
    return result;
  }

  async afterCommit() {
    for (const result of this.results) await result.afterCommit().catch(() => undefined);
  }
}

export function monitorScope(monitor: MonitorRef, incidentId?: string) {
  return { monitorId: monitor.id, ...(incidentId ? { incidentId } : {}), tags: monitor.tags };
}
