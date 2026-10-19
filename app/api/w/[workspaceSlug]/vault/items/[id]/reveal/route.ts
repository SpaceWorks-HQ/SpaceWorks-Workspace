import { cookies } from "next/headers";
import { getWorkspaceForAction } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { revealItem } from "@/lib/vault/service";
import { VAULT_MFA_COOKIE } from "@/lib/vault/mfa";
import { OpsError } from "@/lib/approvals/ops";
export async function POST(request: Request, { params }: RouteContext<"/api/w/[workspaceSlug]/vault/items/[id]/reveal">) {
 const privateHeaders = { "Cache-Control": "no-store, private", "Pragma": "no-cache", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };
 // Same-origin fetch only, with a non-simple header; no cross-origin preflight is enabled.
 const base = process.env.NEXT_PUBLIC_BASE_URL ?? new URL(request.url).origin;
 if (request.headers.get("origin") !== new URL(base).origin || request.headers.get("x-vault-action") !== "reveal") return Response.json({ error: "Request unavailable." }, { status: 403, headers: privateHeaders });
 const { workspaceSlug, id } = await params;
 const actor = await getWorkspaceForAction(workspaceSlug, "MEMBER");
 if (!actor) return Response.json({ error: "Item unavailable." }, { status: 404, headers: privateHeaders });
 if (await isActionRateLimited("apiWrite", actor.user.id)) return Response.json({ error: "Too many attempts. Try again shortly." }, { status: 429, headers: privateHeaders });
 let action: "COPY" | "REVEAL" = "REVEAL";
 try { const body = await request.json(); if (body.action === "COPY") action = "COPY"; } catch { /* Default reveal. */ }
 try {
  const secret = await revealItem(actor, id, (await cookies()).get(VAULT_MFA_COOKIE)?.value, action);
  return Response.json({ secret }, { headers: privateHeaders });
 } catch (e) { return Response.json({ error: e instanceof OpsError ? e.message : "Couldn't reveal. Try again." }, { status: 403, headers: privateHeaders }); }
}
