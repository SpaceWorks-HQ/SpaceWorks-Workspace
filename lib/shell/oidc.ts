import "server-only";
import type { OIDCConfig } from "next-auth/providers";
import type { SsoProvider } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
export function verifiedOidcEmail(
  profile: unknown,
  allowedDomains: readonly string[],
) {
  if (!profile || typeof profile !== "object") return null;
  const p = profile as Record<string, unknown>;
  if (
    p.email_verified !== true ||
    typeof p.sub !== "string" ||
    !p.sub ||
    typeof p.email !== "string"
  )
    return null;
  const email = p.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    return null;
  if (
    allowedDomains.length &&
    !allowedDomains.some((d) => d.toLowerCase() === email.split("@")[1])
  )
    return null;
  return email;
}
export async function existingOidcMember(
  providerId: string,
  profile: unknown,
  client: DbClient = prisma,
) {
  if (!providerId.startsWith("oidc-")) return null;
  const provider = await client.ssoProvider.findFirst({
    where: { id: providerId.slice(5), workspaceId: null, enabled: true },
  });
  if (!provider) return null;
  const email = verifiedOidcEmail(profile, provider.allowedDomains);
  if (!email) return null;
  const user = await client.user.findFirst({
    where: {
      email,
      disabledAt: null,
      memberships: {
        some: { status: "ACTIVE", workspace: { archivedAt: null } },
      },
    },
    select: { id: true, email: true },
  });
  if (!user) return null;
  const subject = (profile as { sub: string }).sub;
  const linked = await client.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: providerId,
        providerAccountId: subject,
      },
    },
    select: { userId: true },
  });
  if (linked && linked.userId !== user.id) return null;
  const previous = await client.account.findFirst({
    where: { userId: user.id, provider: providerId },
    select: { providerAccountId: true },
  });
  if (previous && previous.providerAccountId !== subject) return null;
  return user;
}
export function oidcProvider(
  row: SsoProvider,
): OIDCConfig<Record<string, unknown>> {
  return {
    id: `oidc-${row.id}`,
    name: row.name,
    type: "oidc",
    issuer: row.issuer,
    clientId: row.clientId,
    clientSecret: decryptSecret("sso-secrets", row.clientSecretEnc),
    checks: ["pkce", "state", "nonce"],
    authorization: { params: { scope: "openid email profile" } },
    allowDangerousEmailAccountLinking: true,
    profile(profile) {
      const email = verifiedOidcEmail(profile, row.allowedDomains);
      if (!email) throw new Error("A verified email is required.");
      return {
        id: String(profile.sub),
        email,
        name:
          typeof profile.name === "string" ? profile.name.slice(0, 200) : null,
      };
    },
  };
}
export async function enabledOidcProviders() {
  return (
    await prisma.ssoProvider.findMany({
      where: { workspaceId: null, enabled: true },
      orderBy: { createdAt: "asc" },
      take: 10,
    })
  ).map(oidcProvider);
}
export async function publicOidcProviders() {
  return prisma.ssoProvider.findMany({
    where: { workspaceId: null, enabled: true },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
    take: 10,
  });
}
