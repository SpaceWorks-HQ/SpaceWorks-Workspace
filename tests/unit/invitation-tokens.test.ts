import { describe, expect, it } from "vitest";
import {
  createInvitationToken,
  hashInvitationToken,
  invitationExpiry,
  invitationState,
  invitationUrl,
  isPlausibleInvitationToken,
  INVITATION_TTL_DAYS,
} from "@/lib/invitationTokens";

describe("invitation tokens", () => {
  it("stores only a hash of a high-entropy token", () => {
    const { token, tokenHash } = createInvitationToken();
    expect(isPlausibleInvitationToken(token)).toBe(true);
    expect(tokenHash).toBe(hashInvitationToken(token));
    expect(tokenHash).not.toContain(token);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different tokens and domain-separated hashes", () => {
    const a = createInvitationToken();
    const b = createInvitationToken();
    expect(a.token).not.toBe(b.token);
    expect(hashInvitationToken("x")).not.toBe(hashInvitationToken("y"));
  });

  it("rejects implausible token shapes before any lookup", () => {
    expect(isPlausibleInvitationToken("short")).toBe(false);
    expect(isPlausibleInvitationToken("a".repeat(43) + "/")).toBe(false);
    expect(isPlausibleInvitationToken(undefined)).toBe(false);
  });

  it("expires after the TTL and reports state", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    const expires = invitationExpiry(now);
    expect(expires.getTime() - now.getTime()).toBe(INVITATION_TTL_DAYS * 86_400_000);
    expect(invitationState({ acceptedAt: null, revokedAt: null, expiresAt: expires }, now)).toBe("PENDING");
    expect(invitationState({ acceptedAt: null, revokedAt: null, expiresAt: now }, now)).toBe("EXPIRED");
    expect(invitationState({ acceptedAt: null, revokedAt: now, expiresAt: expires }, now)).toBe("REVOKED");
    expect(invitationState({ acceptedAt: now, revokedAt: null, expiresAt: expires }, now)).toBe("ACCEPTED");
  });

  it("builds absolute links from the base URL", () => {
    expect(invitationUrl("abc", "https://work.example.org/")).toBe("https://work.example.org/invite/abc");
  });
});
