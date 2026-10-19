import "server-only";
import type { Prisma, WorkspaceRole } from "@prisma/client";
import { dispatch } from "@/lib/notify/dispatch";
import { startAutoChecklists } from "./checklists";
/** Called in the membership-creation transaction; the caller runs the callback after commit. */
export async function joinedFromInvitation(tx: Prisma.TransactionClient, input: { workspace: { id: string; slug: string }; userId: string; role: WorkspaceRole; invitedById: string | null }) {
  if (input.role === "MEMBER") await startAutoChecklists(tx, { workspace: input.workspace, subjectUserId: input.userId, trigger: { membershipType: "MEMBER" }, actorId: input.userId });
  if (input.role !== "MEMBER") {
    const templates = await tx.checklistTemplate.findMany({ where: { workspaceId: input.workspace.id, kind: "ONBOARDING", autoStartFor: input.role } });
    const { startTemplateRun } = await import("./checklists");
    for (const template of templates) await startTemplateRun(tx, { workspaceId: input.workspace.id, template, subjectUserId: input.userId, subjectName: null, actorId: input.userId });
  }
  const result = await dispatch(input.workspace.id, { type: "member.joined", title: "A new member joined Space Works", actorId: input.userId, recipients: input.invitedById ? [input.invitedById] : [], resource: { type: "member", id: input.userId }, url: `/w/${input.workspace.slug}/members/${input.userId}`, data: { userId: input.userId } }, { tx });
  return result.afterCommit;
}
