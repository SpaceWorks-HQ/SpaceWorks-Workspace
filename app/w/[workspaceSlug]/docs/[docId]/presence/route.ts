import { z } from "zod";
import { prisma } from "@/lib/db";
import { canEditDoc, canSeeDoc } from "@/lib/docs/rules";
import { adminUserIds } from "@/lib/docs/service";
import { isTrustedMutation, jsonResponse, notFoundResponse, routeActor } from "@/lib/files/request";
import { checkRateLimitById } from "@/lib/rateLimit";
import { publish } from "@/lib/realtime";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ state: z.enum(["viewing", "editing", "left"]) });

/**
 * Presence ping for a doc ("Meera is editing"). The page sends one every
 * 20 seconds while open and "left" when it closes; viewers expire entries
 * they have not heard from in 50 seconds. Publishes ids and a state only.
 */
export async function POST(request: Request, ctx: RouteContext<"/w/[workspaceSlug]/docs/[docId]/presence">) {
  const { workspaceSlug, docId } = await ctx.params;
  if (!isTrustedMutation(request)) return jsonResponse({ ok: false }, 403);
  const actor = await routeActor(workspaceSlug);
  if (!actor) return notFoundResponse();
  if (!(await checkRateLimitById("action", `presence:${actor.user.id}`))) return jsonResponse({ ok: false }, 429);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonResponse({ ok: false }, 400);
  const doc = await prisma.doc.findFirst({ where: { id: docId, workspaceId: actor.workspace.id, archivedAt: null }, select: { id: true, visibility: true } });
  if (!doc || !canSeeDoc(actor.membership, doc)) return notFoundResponse();
  const state = parsed.data.state === "editing" && !canEditDoc(actor.membership, doc) ? "viewing" : parsed.data.state;
  const audience = doc.visibility === "ADMINS" ? await adminUserIds(actor.workspace.id) : undefined;
  await publish(actor.workspace.id, `doc:${doc.id}`, { type: "doc.presence", data: { docId: doc.id, userId: actor.user.id, state }, actorId: actor.user.id, ...(audience ? { audience } : {}) });
  return jsonResponse({ ok: true });
}
