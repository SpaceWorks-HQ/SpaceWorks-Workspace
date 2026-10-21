import { it, expect } from "vitest";
import {
  saveGrant,
  changeSecrets,
  readSecrets,
} from "@/lib/secrets/service";
import { owner, member, project } from "./fixtures";

export function registerReferenceTests() {
  it("resolves references only within project and permitted environment/folder; detects cycles and missing keys", async () => {
    const p = await project();
    await changeSecrets(owner, p.dev.id, [
      { key: "BASE", path: "/", value: "https://example.org" },
      { key: "URL", path: "/", value: "${BASE}/${staging.api.VERSION}" },
    ]);
    await changeSecrets(owner, p.staging.id, [
      { key: "VERSION", path: "/api", value: "v1" },
    ]);
    expect(await readSecrets(owner, p.dev.id, "/", { key: "URL" })).toEqual({
      URL: "https://example.org/v1",
    });
    await saveGrant(owner, {
      projectId: p.id,
      environmentId: p.dev.id,
      userId: member.user.id,
      role: "READ",
    });
    await expect(
      readSecrets(member, p.dev.id, "/", { key: "URL" }),
    ).rejects.toThrow("access");
    await changeSecrets(owner, p.dev.id, [
      { key: "CYCLE", path: "/", value: "${CYCLE}" },
      { key: "MISSING", path: "/", value: "${NOWHERE}" },
    ]);
    await expect(
      readSecrets(owner, p.dev.id, "/", { key: "CYCLE" }),
    ).rejects.toThrow("cycle");
    await expect(
      readSecrets(owner, p.dev.id, "/", { key: "MISSING" }),
    ).rejects.toThrow("unavailable");
  });
}
