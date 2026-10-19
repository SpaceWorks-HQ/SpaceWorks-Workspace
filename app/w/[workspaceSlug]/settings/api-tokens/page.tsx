import { ApiTokensManager } from "@/components/assistant/ApiTokensManager";
import { canManageApiTokens, requireWorkspace } from "@/lib/permissions";
import { formatDate, formatRelativeTime } from "@/lib/format/datetime";
import { listApiTokens } from "@/lib/apiTokens";
import { notFound } from "next/navigation";

export const metadata = { title: "API tokens" };

export default async function ApiTokensPage({ params }: PageProps<"/w/[workspaceSlug]/settings/api-tokens">) {
  const { workspaceSlug } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
  if (!canManageApiTokens(membership)) notFound();
  const tokens = await listApiTokens(workspace.id);
  const now = new Date();
  return (
    <ApiTokensManager
      slug={workspace.slug}
      origin={process.env.NEXT_PUBLIC_BASE_URL ?? ""}
      tokens={tokens.map((token) => ({
        id: token.id,
        name: token.name,
        prefix: token.prefix,
        scopes: token.scopes,
        createdBy: token.createdBy?.name ?? token.createdBy?.email ?? "Former member",
        created: formatDate(token.createdAt, workspace.timezone),
        lastUsed: token.lastUsedAt ? formatRelativeTime(token.lastUsedAt, workspace.timezone, now) : null,
        expires: token.expiresAt ? formatDate(token.expiresAt, workspace.timezone) : null,
        status: token.revokedAt ? "revoked" : token.expiresAt && token.expiresAt <= now ? "expired" : "active",
      }))}
    />
  );
}
