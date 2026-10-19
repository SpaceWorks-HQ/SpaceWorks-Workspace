import { findPublicCover } from "@/lib/blog/public";
import { getObject } from "@/lib/storage";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * Public cover image of a published post. This is the only public path to a
 * stored file: it resolves the post (published, blog on, workspace active)
 * and serves only that post's raster cover. Everything else stays behind
 * /api/files, which needs a session.
 */
export async function GET(_request: Request, ctx: RouteContext<"/blog/[workspaceSlug]/[postSlug]/cover">) {
  const { workspaceSlug, postSlug } = await ctx.params;
  const file = await findPublicCover(workspaceSlug, postSlug);
  if (!file) return notFound();
  const object = await getObject(file.storageKey);
  if (!object) return notFound();
  return new Response(Buffer.from(object.body), {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(object.body.byteLength),
      "Content-Disposition": "inline",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
}
