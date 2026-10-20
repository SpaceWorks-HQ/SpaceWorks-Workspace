/**
 * API token scopes (pure and client-safe, so the token form can list them).
 * A token can only do what its scopes allow AND what its creator's current
 * membership allows (see lib/assistant/principal.ts).
 */
export const API_SCOPES = [
  { value: "read:app-reviews", label: "Read app reviews", description: "App review inbox and reply states. Never store credentials." },
  { value: "read:tasks", label: "Read tasks", description: "Projects, tasks and their comments." },
  { value: "write:tasks", label: "Write tasks", description: "Create tasks and update their title, status, priority and due date." },
  { value: "read:chat", label: "Read chat", description: "Channels and their messages. Never direct messages." },
  { value: "write:chat", label: "Post in chat", description: "Post messages in channels." },
  { value: "read:docs", label: "Read docs", description: "Docs, workspace memory and assistant skills." },
  { value: "write:docs", label: "Write docs", description: "Create docs and save workspace memory." },
  { value: "read:members", label: "Read members", description: "Member directory and announcements." },
  { value: "read:finance", label: "Read finance", description: "The kitty summary: income, expenses and balance." },
  { value: "mcp", label: "MCP", description: "Connect an AI client to /api/mcp. Tools follow the other scopes." },
] as const;

export type ApiScope = (typeof API_SCOPES)[number]["value"];

export const API_SCOPE_VALUES: readonly ApiScope[] = API_SCOPES.map((scope) => scope.value);

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === "string" && (API_SCOPE_VALUES as readonly string[]).includes(value);
}

export function scopeLabel(scope: string): string {
  return API_SCOPES.find((entry) => entry.value === scope)?.label ?? scope;
}

/** Normalise a stored scope list: known scopes only, de-duplicated, in catalogue order. */
export function normalizeScopes(scopes: readonly string[]): ApiScope[] {
  const set = new Set(scopes);
  return API_SCOPE_VALUES.filter((scope) => set.has(scope));
}

export function hasScope(scopes: readonly string[], scope: ApiScope): boolean {
  return scopes.includes(scope);
}

/** Plain-text token shape: `sww_<12 char prefix>_<secret>`. The prefix is public, the secret is not. */
export const TOKEN_PATTERN = /^(sww_[A-Za-z0-9]{12})_([A-Za-z0-9_-]{43})$/;

export function parseTokenString(raw: string): { prefix: string; secret: string } | null {
  const match = TOKEN_PATTERN.exec(raw.trim());
  return match ? { prefix: match[1]!, secret: match[2]! } : null;
}

/** Extract the token from an `Authorization: Bearer …` header. */
export function bearerToken(header: string | null): string | null {
  const match = header?.match(/^Bearer[ \t]+([^ \t]+)$/i);
  return match ? match[1]! : null;
}
