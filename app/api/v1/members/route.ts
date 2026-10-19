import { listEndpoint } from "@/lib/apiTokens/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/members (read:members). Query: query, limit, cursor. No contact details. */
export function GET(request: Request) {
  return listEndpoint(request, "sw_list_members", "members");
}
