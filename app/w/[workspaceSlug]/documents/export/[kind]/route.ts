import { NextRequest } from "next/server";
import { getWorkspaceForAction } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { DocumentsError } from "@/lib/documents/access";
import { evidenceBundle } from "@/lib/documents/bundle";
import { documentExport } from "@/lib/documents/export";
export async function GET(
  request: NextRequest,
  { params }: RouteContext<"/w/[workspaceSlug]/documents/export/[kind]">,
) {
  const { workspaceSlug, kind } = await params,
    actor = await getWorkspaceForAction(workspaceSlug, "ADMIN");
  if (!actor) return new Response("Not found", { status: 404 });
  if (await isActionRateLimited("apiWrite", `document-export:${actor.user.id}`))
    return new Response("Wait a minute and try again.", { status: 429 });
  try {
    if (kind === "bundle") {
      const bytes = await evidenceBundle(
        actor,
        request.nextUrl.searchParams.get("start") ?? "",
        request.nextUrl.searchParams.get("end") ?? "",
      );
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": "attachment; filename=documents-evidence.zip",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const out = await documentExport(
      actor,
      kind,
      request.nextUrl.searchParams.get("start") ?? "",
      request.nextUrl.searchParams.get("end") ?? "",
    );
    return new Response(out.body, {
      headers: {
        "Content-Type": out.type,
        "Content-Disposition": `attachment; filename="${out.name}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return new Response(
      error instanceof DocumentsError
        ? error.message
        : "Couldn't export. Check the period and your access, then try again.",
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
