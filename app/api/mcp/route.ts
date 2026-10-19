import { authenticateApiToken } from "@/lib/apiTokens";
import { hasScope } from "@/lib/apiTokens/scopes";
import { checkRateLimitById } from "@/lib/rateLimit";
import { handleMcpRequest } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

function jsonRpcError(status: number, message: string, extra: Record<string, string> = {}) {
  return Response.json({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }, { status, headers: { ...HEADERS, ...extra } });
}

/**
 * MCP Streamable HTTP endpoint (stateless, JSON responses). Bearer API token
 * with the `mcp` scope; each tool additionally needs its own scope. See
 * docs/MCP.md for client configuration.
 */
export async function POST(request: Request) {
  const token = await authenticateApiToken(request.headers.get("authorization"));
  if (!token) return jsonRpcError(401, "Send a valid Space Works API token as a Bearer token.", { "WWW-Authenticate": 'Bearer realm="space-works"' });
  if (!hasScope(token.scopes, "mcp")) return jsonRpcError(403, "This token is missing the mcp scope.");
  if (!(await checkRateLimitById("apiRead", `token:${token.principal.tokenId}`))) return jsonRpcError(429, "Too many requests. Try again later.", { "Retry-After": "60" });
  const response = await handleMcpRequest(token.principal, request);
  for (const [key, value] of Object.entries(HEADERS)) response.headers.set(key, value);
  return response;
}

/** Stateless server: no standalone SSE stream and no sessions to delete. */
export function GET() {
  return new Response("Method not allowed", { status: 405, headers: { ...HEADERS, Allow: "POST" } });
}

export const DELETE = GET;
