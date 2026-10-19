import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { docToHtmlFile, docToMarkdown, exportFilename } from "@/lib/docs/markdown";
import { canSeeDoc } from "@/lib/docs/rules";
import { sanitizeDocHtml } from "@/lib/docs/sanitize";
import { notFoundResponse, routeActor } from "@/lib/files/request";
import { contentDisposition } from "@/lib/storage/policy";

export const dynamic = "force-dynamic";

/** Download a doc as Markdown (`?format=md`, default) or standalone HTML (`?format=html`). */
export async function GET(request: Request, ctx: RouteContext<"/w/[workspaceSlug]/docs/[docId]/export">) {
  const { workspaceSlug, docId } = await ctx.params;
  const actor = await routeActor(workspaceSlug);
  if (!actor) return notFoundResponse();
  const doc = await prisma.doc.findFirst({ where: { id: docId, workspaceId: actor.workspace.id }, select: { id: true, title: true, contentHtml: true, visibility: true } });
  if (!doc || !canSeeDoc(actor.membership, doc)) return notFoundResponse();
  const format = new URL(request.url).searchParams.get("format") === "html" ? "html" : "md";
  const html = sanitizeDocHtml(doc.contentHtml);
  const body = format === "html" ? docToHtmlFile(doc.title, html) : docToMarkdown(doc.title, html);
  await recordAuditEvent({ action: "doc.exported", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Doc", targetId: doc.id, metadata: { format } });
  return new Response(body, {
    headers: {
      "Content-Type": format === "html" ? "text/html; charset=utf-8" : "text/markdown; charset=utf-8",
      "Content-Disposition": contentDisposition(exportFilename(doc.title, format), false),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
