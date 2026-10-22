import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { recoverSuperAdmin } from "../../docker/vps/recover-super-admin-lib.mjs";
import { createUser, uniqueSuffix } from "../helpers/fixtures";
const email = `recovery-${uniqueSuffix()}@example.test`;
let id: string;
beforeAll(async () => { const user = await createUser(email, "Operator"); id = user.id; });
afterAll(async () => { await prisma.auditEvent.deleteMany({ where: { targetId: id } }); await prisma.user.deleteMany({ where: { id } }); });
describe("operator recovery", () => {
  it("revokes sessions/MFA, stores only a one-hour hash and audits no capability", async () => {
    await prisma.user.update({ where: { id }, data: { mfaSecretEncrypted: "encrypted-fixture", mfaEnabledAt: new Date() } });
    await prisma.mfaRecoveryCode.create({ data: { userId: id, codeHash: "fixture-hash" } });
    const previous = await prisma.user.findUniqueOrThrow({ where: { id } });
    const url = await recoverSuperAdmin(prisma, email, email, "https://workspace.example.test");
    const token = url!.split("/").at(-1)!;
    const [user, tokens, audit, codes] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { id } }), prisma.passwordResetToken.findMany({ where: { userId: id } }), prisma.auditEvent.findMany({ where: { targetId: id } }), prisma.mfaRecoveryCode.count({ where: { userId: id } })]);
    expect(user.sessionVersion).toBe(previous.sessionVersion + 1);
    expect(user.mfaSecretEncrypted).toBeNull(); expect(user.mfaEnabledAt).toBeNull(); expect(codes).toBe(0);
    expect(tokens).toHaveLength(1); expect(tokens[0].tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(tokens[0].expiresAt.getTime() - Date.now()).toBeGreaterThan(59 * 60_000);
    expect(JSON.stringify(audit)).not.toContain(token);
  });
  it("rejects another account and preserves an earlier account recovery state", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id } });
    await expect(recoverSuperAdmin(prisma, email, "different@example.test", "https://workspace.example.test")).rejects.toThrow();
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).sessionVersion).toBe(before.sessionVersion);
  });
});
