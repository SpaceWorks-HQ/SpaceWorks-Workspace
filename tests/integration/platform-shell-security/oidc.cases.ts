import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { existingOidcMember } from "@/lib/shell/oidc";
import { encryptSecret } from "@/lib/crypto";
import { emailSuffix, memberId, records } from "./fixtures";

export function registerOidcTests() {
  it("only authenticates verified, existing active members", async () => {
    const provider = await prisma.ssoProvider.create({
      data: {
        name: "Maker SSO",
        issuer: "https://id.example.org",
        clientId: "client",
        clientSecretEnc: encryptSecret("sso-secrets", "secret"),
        allowedDomains: [emailSuffix],
      },
    });
    records.providerId = provider.id;
    const profile = {
      sub: "subject",
      email: `member@${emailSuffix}`,
      email_verified: true,
    };
    const count = await prisma.user.count();
    expect((await existingOidcMember(`oidc-${records.providerId}`, profile))?.id).toBe(
      memberId,
    );
    expect(
      await existingOidcMember(`oidc-${records.providerId}`, {
        ...profile,
        email: `new@${emailSuffix}`,
      }),
    ).toBeNull();
    expect(
      await existingOidcMember(`oidc-${records.providerId}`, {
        ...profile,
        email: `outside@${emailSuffix}`,
      }),
    ).toBeNull();
    expect(
      await existingOidcMember(`oidc-${records.providerId}`, {
        ...profile,
        email_verified: false,
      }),
    ).toBeNull();
    expect(await prisma.user.count()).toBe(count);
  });
  it("rejects changed subjects, disabled users and disabled providers", async () => {
    const profile = {
      sub: "subject",
      email: `member@${emailSuffix}`,
      email_verified: true,
    };
    await prisma.account.create({
      data: {
        userId: memberId,
        provider: `oidc-${records.providerId}`,
        providerAccountId: "original",
        type: "oidc",
      },
    });
    expect(await existingOidcMember(`oidc-${records.providerId}`, profile)).toBeNull();
    await prisma.account.deleteMany({
      where: { provider: `oidc-${records.providerId}` },
    });
    await prisma.user.update({
      where: { id: memberId },
      data: { disabledAt: new Date() },
    });
    expect(await existingOidcMember(`oidc-${records.providerId}`, profile)).toBeNull();
    await prisma.user.update({
      where: { id: memberId },
      data: { disabledAt: null },
    });
    await prisma.ssoProvider.update({
      where: { id: records.providerId },
      data: { enabled: false },
    });
    expect(await existingOidcMember(`oidc-${records.providerId}`, profile)).toBeNull();
  });
}
