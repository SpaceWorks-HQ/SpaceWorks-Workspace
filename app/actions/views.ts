"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { shellContext } from "@/lib/shell/context";
import { canContribute } from "@/lib/roles";
import { recordAuditEvent } from "@/lib/audit";
import { actionError, type ActionResult } from "@/lib/actionResult";
const schema = z.object({
  id: z.string().max(64).optional(),
  entityType: z.string().regex(/^[a-z_]{1,40}$/),
  name: z.string().trim().min(1).max(80),
  query: z.object({
    filters: z
      .record(
        z.string().max(40),
        z.union([z.string().max(200), z.boolean(), z.number()]),
      )
      .default({}),
    sort: z.string().max(40).optional(),
    groupBy: z.string().max(40).optional(),
    columns: z.array(z.string().max(40)).max(20).optional(),
  }),
  layout: z.enum(["LIST", "BOARD", "TABLE", "CALENDAR"]).default("LIST"),
  shared: z.enum(["PRIVATE", "WORKSPACE", "TEAM"]).default("PRIVATE"),
  teamId: z.string().max(64).nullable().default(null),
  pinned: z.boolean().default(false),
});
export async function saveView(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await shellContext(slug);
  const parsed = schema.safeParse(input);
  if (!ctx || !parsed.success)
    return actionError("Check the view name and filters, then try again.");
  const { id, ...data } = parsed.data;
  if (data.shared !== "PRIVATE" && !canContribute(ctx.membership))
    return actionError("Guests can save personal views.");
  if (data.shared === "TEAM" && !data.teamId)
    return actionError("Choose a team for this view.");
  if (
    data.teamId &&
    !(await prisma.team.findFirst({
      where: {
        id: data.teamId,
        workspaceId: ctx.workspace.id,
        archivedAt: null,
        members: { some: { userId: ctx.user.id } },
      },
      select: { id: true },
    }))
  )
    return actionError("Choose a team you belong to.");
  try {
    await prisma.$transaction(async (tx) => {
      if (id) {
        const changed = await tx.savedView.updateMany({
          where: { id, workspaceId: ctx.workspace.id, ownerId: ctx.user.id },
          data,
        });
        if (!changed.count) throw new Error("unavailable");
      } else
        await tx.savedView.create({
          data: {
            ...data,
            workspaceId: ctx.workspace.id,
            ownerId: ctx.user.id,
          },
        });
      await recordAuditEvent({
        workspaceId: ctx.workspace.id,
        actorId: ctx.user.id,
        action: "shell.view_saved",
        client: tx,
      });
    });
    revalidatePath(`/w/${slug}`, "layout");
    return { ok: true };
  } catch {
    return actionError("Couldn't save this view. Try again.");
  }
}
export async function deleteView(
  slug: string,
  id: string,
): Promise<ActionResult> {
  const ctx = await shellContext(slug);
  if (!ctx || !z.string().min(1).max(64).safeParse(id).success)
    return actionError("Couldn't remove this view. Try again.");
  await prisma.savedView.deleteMany({
    where: { id, workspaceId: ctx.workspace.id, ownerId: ctx.user.id },
  });
  await recordAuditEvent({
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    action: "shell.view_deleted",
    targetId: id,
  });
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true };
}
