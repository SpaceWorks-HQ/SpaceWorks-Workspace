import { getCurrentUser } from "@/lib/permissions";
import { consumeOAuthState, integrationBaseUrl } from "@/lib/integrations/google/oauth";
import { githubRequest, githubAppJwt } from "@/lib/integrations/github/api";
import { prisma } from "@/lib/db";
import { requestJson } from "@/lib/integrations/http";
import { recordAuditEvent } from "@/lib/audit";
export async function GET(request: Request) {
  const user = await getCurrentUser(); if (!user) return new Response("Sign in before connecting GitHub.", { status: 401 });
  const url = new URL(request.url); const state = await consumeOAuthState(url.searchParams.get("state") ?? "", user.id, "GITHUB"); const installationId = url.searchParams.get("installation_id") ?? "";
  if (!state || !/^\d+$/.test(installationId)) return new Response("This installation attempt expired. Start again in integration settings.", { status: 400 });
  try {
    const code = url.searchParams.get("code");
    if (!code || !process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) throw new Error("GitHub user authorisation is required.");
    const grant = await requestJson<{ access_token?: string }>("https://github.com/login/oauth/access_token", { method: "POST", label: "GitHub", headers: { Accept: "application/json" }, body: { client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code } });
    if (!grant.ok || !grant.data.access_token) throw new Error("GitHub authorisation failed.");
    let allowed = false;
    for (let page = 1; page <= 10; page++) {
      const visible = await githubRequest<{ installations: { id: number }[] }>(`/user/installations?per_page=100&page=${page}`, grant.data.access_token);
      if (visible.installations.some(i => String(i.id) === installationId)) { allowed = true; break; }
      if (visible.installations.length < 100) break;
    }
    if (!allowed) throw new Error("This GitHub user cannot access that installation.");
    const allowedRepos: string[] = [];
    for (let page = 1; page <= 10; page++) {
      const visible = await githubRequest<{ repositories: { full_name: string }[] }>(`/user/installations/${installationId}/repositories?per_page=100&page=${page}`, grant.data.access_token);
      allowedRepos.push(...visible.repositories.map(repo => repo.full_name));
      if (visible.repositories.length < 100) break;
    }
    const installation = await githubRequest<{ id: number; account: { login: string }; suspended_at: string | null }>(`/app/installations/${installationId}`, await githubAppJwt());
    if (installation.suspended_at) throw new Error("Suspended installation");
    await prisma.integrationConnection.upsert({ where: { workspaceId_provider_externalId: { workspaceId: state.workspaceId, provider: "GITHUB", externalId: installationId } }, create: { workspaceId: state.workspaceId, provider: "GITHUB", externalId: installationId, accountLabel: installation.account.login, connectedById: user.id, metadata: { allowedRepos } }, update: { status: "ACTIVE", accountLabel: installation.account.login, connectedById: user.id, metadata: { allowedRepos } } });
    await recordAuditEvent({ workspaceId: state.workspaceId, actorId: user.id, action: "integrations.github_connected" });
    return Response.redirect(new URL(state.redirectPath, integrationBaseUrl()), 303);
  } catch { return new Response("GitHub could not verify this installation. Start again in integration settings.", { status: 400 }); }
}
