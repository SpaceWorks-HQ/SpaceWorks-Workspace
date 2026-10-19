import { randomToken, sha256Hex } from "@/lib/crypto";

export const INVITATION_TTL_DAYS = 7;

/** A fresh bearer token for an invitation link, plus the hash that is stored. */
export function createInvitationToken() {
  const token = randomToken(32);
  return { token, tokenHash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string) {
  return sha256Hex(`invitation:${token}`);
}

/** Shape check before any database lookup (43 base64url chars for 32 bytes). */
export function isPlausibleInvitationToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function invitationExpiry(now = new Date()) {
  return new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function invitationUrl(token: string, baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "") {
  return `${baseUrl.replace(/\/$/, "")}/invite/${token}`;
}

export function invitationState(invitation: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now = new Date()) {
  if (invitation.acceptedAt) return "ACCEPTED" as const;
  if (invitation.revokedAt) return "REVOKED" as const;
  if (invitation.expiresAt <= now) return "EXPIRED" as const;
  return "PENDING" as const;
}
