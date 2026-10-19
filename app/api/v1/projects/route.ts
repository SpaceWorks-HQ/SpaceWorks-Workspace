import { listEndpoint } from "@/lib/apiTokens/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/projects (read:tasks). Query: status, limit, cursor. */
export function GET(request: Request) {
  return listEndpoint(request, "sw_list_projects", "projects");
}
