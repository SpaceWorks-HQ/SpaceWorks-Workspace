import { inboundRequest } from "@/lib/messaging/inbound";
export const runtime = "nodejs";
export async function POST(request: Request, context: RouteContext<"/api/integrations/[provider]/[connectionId]/[...endpoint]">) {
  const { provider, connectionId } = await context.params;
  return inboundRequest(request, provider, connectionId);
}
export async function GET(request: Request, context: RouteContext<"/api/integrations/[provider]/[connectionId]/[...endpoint]">) {
  const { provider, connectionId } = await context.params;
  return inboundRequest(request, provider, connectionId);
}
