import { listEndpoint } from "@/lib/apiTokens/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/channels (read:chat). Public channels only, never DMs. Query: limit, cursor. */
export function GET(request: Request) {
  return listEndpoint(request, "sw_list_channels", "channels");
}
