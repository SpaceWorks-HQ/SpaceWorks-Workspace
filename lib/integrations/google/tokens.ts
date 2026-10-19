import "server-only";

import type { IntegrationConnection } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requestJson } from "@/lib/integrations/http";
import { decryptIntegrationToken, encryptIntegrationToken } from "@/lib/integrationSecrets";
import { getGoogleSsoSettings } from "@/lib/instanceSettings";

/**
 * Google OAuth client credentials and access tokens for
 * IntegrationConnection rows (provider GOOGLE). Tokens are encrypted with
 * lib/integrationSecrets.ts; an access token is refreshed one minute before
 * it expires. A refresh that Google rejects (invalid_grant: revoked or
 * expired) marks the connection ERROR so the settings page asks to reconnect.
 */

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Integration client: GOOGLE_CLIENT_ID/SECRET, else the Google sign-in client (instance settings / AUTH_GOOGLE_*). */
export async function googleClientCredentials(): Promise<{ clientId: string; clientSecret: string } | null> {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) return { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET };
  return getGoogleSsoSettings();
}

export type TokenResult = { ok: true; token: string } | { ok: false; error: string };

export async function getGoogleAccessToken(connection: Pick<IntegrationConnection, "id" | "provider" | "status" | "accessTokenEnc" | "refreshTokenEnc" | "expiresAt">, now = new Date()): Promise<TokenResult> {
  if (connection.provider !== "GOOGLE") return { ok: false, error: "Not a Google connection." };
  if (connection.status === "REVOKED") return { ok: false, error: "Google was disconnected. Connect it again in Settings › Integrations." };
  if (connection.accessTokenEnc && connection.expiresAt && connection.expiresAt.getTime() - now.getTime() > 60_000) {
    try {
      return { ok: true, token: decryptIntegrationToken(connection.accessTokenEnc) };
    } catch {
      // Fall through to a refresh.
    }
  }
  if (!connection.refreshTokenEnc) return { ok: false, error: "Google access expired. Connect Google again." };
  const client = await googleClientCredentials();
  if (!client) return { ok: false, error: "Google is not configured on this instance." };
  let refreshToken: string;
  try {
    refreshToken = decryptIntegrationToken(connection.refreshTokenEnc);
  } catch {
    return { ok: false, error: "The stored Google token could not be read. Connect Google again." };
  }
  const outcome = await requestJson<{ access_token: string; expires_in: number; scope?: string }>(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    label: "Google",
  });
  if (!outcome.ok) {
    const code = outcome.data && typeof outcome.data === "object" ? (outcome.data as { error?: unknown }).error : null;
    if (code === "invalid_grant") {
      await prisma.integrationConnection.updateMany({ where: { id: connection.id }, data: { status: "ERROR", lastError: "Google access was revoked or expired. Connect again." } });
      return { ok: false, error: "Google access was revoked or expired. Connect Google again." };
    }
    return { ok: false, error: outcome.error };
  }
  const expiresAt = new Date(now.getTime() + Math.max(60, outcome.data.expires_in) * 1000);
  await prisma.integrationConnection.updateMany({
    where: { id: connection.id },
    data: { accessTokenEnc: encryptIntegrationToken(outcome.data.access_token), expiresAt, status: "ACTIVE", lastError: null },
  });
  return { ok: true, token: outcome.data.access_token };
}

/** The workspace's active Google connection (the most recent one when several accounts are connected). */
export function findGoogleConnection(workspaceId: string, connectionId?: string) {
  return prisma.integrationConnection.findFirst({
    where: { workspaceId, provider: "GOOGLE", status: { not: "REVOKED" }, ...(connectionId ? { id: connectionId } : {}) },
    orderBy: { createdAt: "desc" },
  });
}
