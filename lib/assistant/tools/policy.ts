import type { WorkspaceRole } from "@prisma/client";
import { hasRoleAtLeast } from "@/lib/roles";
import { hasScope, type ApiScope } from "@/lib/apiTokens/scopes";
import type { Principal } from "@/lib/assistant/principal";

/**
 * Pure tool-access rules (unit-tested). A tool is usable when:
 * - the principal's role reaches the tool's minimum (writes need MEMBER+),
 * - for tokens: the tool has a scope and the token holds it (MCP also needs `mcp`),
 * - jobs never write,
 * - the tool's own `available` gate passes (finance visibility, services, web search).
 */
export type ToolMeta = {
  name: string;
  write: boolean;
  scope: ApiScope | readonly ApiScope[] | null;
  minRole: WorkspaceRole;
  available?: (principal: Principal) => boolean;
};

export type AccessDecision = { ok: true } | { ok: false; reason: string };

export function tokenHasToolScope(scopes: readonly string[], scope: ToolMeta["scope"]): boolean {
  if (scope === null) return false;
  const needed = typeof scope === "string" ? [scope] : scope;
  return needed.some((s) => hasScope(scopes, s));
}

export function toolAccess(tool: ToolMeta, principal: Principal, options: { requireMcp?: boolean } = {}): AccessDecision {
  const minRole: WorkspaceRole = tool.write && !hasRoleAtLeast(tool.minRole, "MEMBER") ? "MEMBER" : tool.minRole;
  if (!hasRoleAtLeast(principal.role, minRole)) return { ok: false, reason: "Your role in this workspace can't use this." };
  if (principal.kind === "job" && tool.write) return { ok: false, reason: "Scheduled jobs can only read." };
  if (principal.kind === "token") {
    const scopes = principal.scopes ?? [];
    if (options.requireMcp && !hasScope(scopes, "mcp")) return { ok: false, reason: "This token is missing the mcp scope." };
    if (!tokenHasToolScope(scopes, tool.scope)) return { ok: false, reason: "This token is missing the scope for this tool." };
  }
  if (tool.available && !tool.available(principal)) return { ok: false, reason: "This isn't available in this workspace." };
  return { ok: true };
}
