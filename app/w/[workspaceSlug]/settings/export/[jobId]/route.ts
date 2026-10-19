import { getCurrentUser, findWorkspaceForUser } from "@/lib/permissions";
import { hasRoleAtLeast } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { getObject } from "@/lib/storage";
import { recordAuditEvent } from "@/lib/audit";
const missing = () =>
  new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(
  _request: Request,
  { params }: RouteContext<"/w/[workspaceSlug]/settings/export/[jobId]">,
) {
  const { workspaceSlug, jobId } = await params;
  const user = await getCurrentUser();
  if (!user) return missing();
  const ctx = await findWorkspaceForUser(workspaceSlug, user.id);
  if (!ctx || !hasRoleAtLeast(ctx.membership.role, "ADMIN")) return missing();
  const job = await prisma.exportJob.findFirst({
    where: {
      id: jobId,
      workspaceId: ctx.workspace.id,
      status: "SUCCEEDED",
      expiresAt: { gt: new Date() },
    },
  });
  if (!job?.storageKey) return missing();
  const object = await getObject(job.storageKey);
  if (!object) return missing();
  await recordAuditEvent({
    workspaceId: ctx.workspace.id,
    actorId: user.id,
    action: "shell.export_downloaded",
    targetId: job.id,
  });
  return new Response(Buffer.from(object.body), {
    headers: {
      "Content-Type":
        job.format === "JSON" ? "application/json" : "application/zip",
      "Content-Disposition": `attachment; filename="space-works-export.${job.format === "JSON" ? "json" : "zip"}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
