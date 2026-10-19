import { getEndpoint } from "@/lib/apiTokens/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/docs/{docId} (read:docs). */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/docs/[docId]">) {
  const { docId } = await ctx.params;
  return getEndpoint(request, "sw_get_doc", { id: docId });
}
