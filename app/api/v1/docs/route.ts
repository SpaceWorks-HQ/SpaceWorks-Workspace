import { listEndpoint } from "@/lib/apiTokens/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/docs (read:docs). Query: query, parentId, limit, cursor. */
export function GET(request: Request) {
  return listEndpoint(request, "sw_list_docs", "docs");
}
