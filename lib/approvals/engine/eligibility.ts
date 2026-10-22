import "server-only";

import type { WorkspaceRole } from "@prisma/client";
import type { DbClient } from "@/lib/db";
import { hasRoleAtLeast } from "@/lib/roles";
import { REQUESTER_TEAMS, type ApprovalStep } from "@/lib/approvals/machine";

/* ───────────── Eligibility ───────────── */

/**
 * Who may decide `step` of a request by `requesterId`. The requester is never
 * eligible. Missing people or empty teams leave the step pending until
 * an eligible approver is available; authority never silently broadens.
 */
export async function eligibleApproverIds(client: DbClient, workspaceId: string, step: ApprovalStep, requesterId: string): Promise<string[]> {
  const members = await client.membership.findMany({ where: { workspaceId, status: "ACTIVE", user: { disabledAt: null } }, select: { userId: true, role: true } });
  const active = new Map(members.map((row) => [row.userId, row.role] as const));
  let ids: string[] = [];
  switch (step.approverType) {
    case "ROLE":
      ids = members.filter((row) => hasRoleAtLeast(row.role, step.ref as WorkspaceRole)).map((row) => row.userId);
      break;
    case "USER":
      ids = active.has(step.ref) ? [step.ref] : [];
      break;
    case "TEAM":
    case "TEAM_LEAD": {
      const teamIds =
        step.ref === REQUESTER_TEAMS
          ? (await client.teamMember.findMany({ where: { userId: requesterId, team: { workspaceId, archivedAt: null } }, select: { teamId: true } })).map((row) => row.teamId)
          : [step.ref];
      const rows = await client.teamMember.findMany({
        where: { teamId: { in: teamIds }, team: { workspaceId, archivedAt: null }, ...(step.approverType === "TEAM_LEAD" ? { role: "LEAD" } : {}) },
        select: { userId: true },
      });
      ids = rows.map((row) => row.userId).filter((id) => active.has(id));
      break;
    }
  }
  const eligible = [...new Set(ids)].filter((id) => id !== requesterId && active.get(id) !== "GUEST");
  return eligible;
}
