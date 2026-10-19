"use server";

import { actionError, type ActionResult } from "@/lib/actionResult";
import { actionContext, isFailure, refreshArea } from "@/lib/people/actionContext";
import { addTeamMember, joinTeam, removeTeamMember, saveTeam, setTeamArchived, setTeamMemberRole } from "@/lib/teams/teams";
import { idSchema } from "@/lib/validation";

/**
 * Team mutations. Each action resolves the workspace from the slug
 * server-side and rate-limits; `lib/teams` checks the capability,
 * validates, writes in a transaction, audits and dispatches.
 */

export async function saveTeamAction(slug: string, teamId: string | null, input: unknown): Promise<ActionResult<{ id: string; slug: string }>> {
  const ctx = await actionContext(slug);
  if (isFailure(ctx)) return ctx;
  if (teamId !== null && !idSchema.safeParse(teamId).success) return actionError("That team no longer exists.");
  const result = await saveTeam(ctx, input, teamId);
  if (result.ok) refreshArea(ctx.workspace.slug, "teams", "members");
  return result;
}

export async function archiveTeamAction(slug: string, input: unknown): Promise<ActionResult<{ slug: string }>> {
  const ctx = await actionContext(slug);
  if (isFailure(ctx)) return ctx;
  const result = await setTeamArchived(ctx, input);
  if (result.ok) refreshArea(ctx.workspace.slug, "teams", "members");
  return result;
}

export async function addTeamMemberAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await actionContext(slug);
  if (isFailure(ctx)) return ctx;
  const result = await addTeamMember(ctx, input);
  if (result.ok) refreshArea(ctx.workspace.slug, "teams", "members", "onboarding");
  return result;
}

export async function removeTeamMemberAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await actionContext(slug);
  if (isFailure(ctx)) return ctx;
  const result = await removeTeamMember(ctx, input);
  if (result.ok) refreshArea(ctx.workspace.slug, "teams", "members");
  return result;
}

export async function setTeamMemberRoleAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await actionContext(slug);
  if (isFailure(ctx)) return ctx;
  const result = await setTeamMemberRole(ctx, input);
  if (result.ok) refreshArea(ctx.workspace.slug, "teams");
  return result;
}

export async function joinTeamAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await actionContext(slug);
  if (isFailure(ctx)) return ctx;
  const result = await joinTeam(ctx, input);
  if (result.ok) refreshArea(ctx.workspace.slug, "teams", "members", "onboarding");
  return result;
}
