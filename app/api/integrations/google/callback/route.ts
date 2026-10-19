import { getCurrentUser } from "@/lib/permissions";
import { consumeOAuthState, completeGoogle, integrationBaseUrl } from "@/lib/integrations/google/oauth";
import { recordAuditEvent } from "@/lib/audit";
export async function GET(request: Request) {
  const user = await getCurrentUser(); if (!user) return new Response("Sign in before connecting Google.", { status: 401 });
  const url = new URL(request.url); const state = await consumeOAuthState(url.searchParams.get("state") ?? "", user.id, "GOOGLE");
  if (!state) return new Response("This connection attempt expired. Start again in integration settings.", { status: 400 });
  if (url.searchParams.has("error") || !url.searchParams.get("code")) return new Response("Google access was not granted. Start again in integration settings.", { status: 400 });
  try { const path = await completeGoogle(state, url.searchParams.get("code")!); await recordAuditEvent({ workspaceId: state.workspaceId, actorId: user.id, action: "integrations.google_connected" }); return Response.redirect(new URL(path, integrationBaseUrl()), 303); }
  catch { return new Response("Google could not complete the connection. Start again in integration settings.", { status: 400 }); }
}
