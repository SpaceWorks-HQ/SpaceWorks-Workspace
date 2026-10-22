import { it, expect } from "vitest";
import {
  saveGrant,
  saveEnvironment,
  changeSecrets,
  readSecrets,
} from "@/lib/secrets/service";
import { environmentAccess } from "@/lib/secrets/access";
import { loadSecrets } from "@/lib/secrets/queries";
import {
  owner,
  member,
  guest,
  other,
  project,
  proof,
} from "./fixtures";

export function registerEnvironmentAccessTests() {
  it("enforces tenant isolation, keys-only/read/write grants and production admin defaults", async () => {
    const p = await project();
    await changeSecrets(owner, p.dev.id, [
      { key: "KEY", path: "/", value: "private" },
    ]);
    await expect(readSecrets(other, p.dev.id, "/")).rejects.toThrow();
    await expect(readSecrets(guest, p.dev.id, "/")).rejects.toThrow();
    await expect(
      changeSecrets(member, p.dev.id, [{ key: "KEY", path: "/", value: "no" }]),
    ).rejects.toThrow();
    await saveGrant(owner, {
      projectId: p.id,
      userId: member.user.id,
      role: "KEYS",
    });
    expect((await loadSecrets(member, p.id, p.dev.id)).rows[0].key).toBe("KEY");
    await expect(readSecrets(member, p.dev.id, "/")).rejects.toThrow();
    await saveGrant(owner, {
      projectId: p.id,
      userId: member.user.id,
      role: "READ",
    });
    expect(await readSecrets(member, p.dev.id, "/", { key: "KEY" })).toEqual({
      KEY: "private",
    });
    await expect(
      changeSecrets(member, p.dev.id, [{ key: "KEY", path: "/", value: "no" }]),
    ).rejects.toThrow();
    await expect(
      environmentAccess(member, p.production.id, "KEYS"),
    ).rejects.toThrow();
    await saveGrant(owner, {
      projectId: p.id,
      environmentId: p.dev.id,
      userId: member.user.id,
      role: "NONE",
    });
    await expect(readSecrets(member, p.dev.id, "/")).rejects.toThrow();
    await expect(
      saveGrant(other, {
        projectId: p.id,
        userId: member.user.id,
        role: "READ",
      }),
    ).rejects.toThrow();
  });
  it("blocks production reveals and every member export without fresh MFA", async () => {
    const p = await project();
    await saveEnvironment(owner, { ...p.production, protected: false });
    await changeSecrets(owner, p.production.id, [
      { key: "PROD", path: "/", value: "protected-value" },
    ]);
    await expect(
      readSecrets(owner, p.production.id, "/", { key: "PROD" }),
    ).rejects.toThrow("two-step");
    const verified = { ...owner, proof: await proof(owner) };
    expect(
      await readSecrets(verified, p.production.id, "/", { key: "PROD" }),
    ).toEqual({ PROD: "protected-value" });
    await expect(
      readSecrets(owner, p.dev.id, "/", { exporting: true }),
    ).rejects.toThrow("two-step");
    await expect(
      readSecrets(
        { ...owner, cliMfaAt: new Date(Date.now() - 301000) },
        p.production.id,
        "/",
        { key: "PROD" },
      ),
    ).rejects.toThrow("two-step");
    await expect(
      readSecrets(
        { ...owner, proof: verified.proof + "x" },
        p.production.id,
        "/",
      ),
    ).rejects.toThrow("two-step");
  });
}
