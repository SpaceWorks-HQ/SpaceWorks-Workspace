import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SecretsActor } from "@/lib/secrets/access";
import type { SecretMetadata } from "@/lib/secrets/types";

const mocks = vi.hoisted(() => ({ rows: vi.fn(), cursor: vi.fn(), presence: vi.fn() }));
vi.mock("@/lib/approvals/ops", () => ({ guard: vi.fn() }));
vi.mock("@/lib/vault/hierarchy", () => ({ encryptionSummary: vi.fn() }));
vi.mock("@/lib/secrets/access", () => ({
  environmentAccess: async () => ({ accessRole: "KEYS" }),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  secretProject: { findMany: async () => [{ id: "project", name: "Project", slug: "project", environments: [{ id: "environment", name: "Dev", slug: "dev", production: false, protected: false, position: 0, revision: 1 }, { id: "staging", name: "Staging", slug: "staging", production: false, protected: false, position: 1, revision: 1 }] }] },
  membership: { findMany: async () => [] },
  applicationSecret: { findMany: mocks.rows, findFirst: mocks.cursor, groupBy: mocks.presence },
  secretFolder: { findMany: async () => [] },
  secretSnapshot: { findMany: async () => [] },
  secretChange: { findMany: async () => [] },
} }));
import { loadSecrets } from "@/lib/secrets/queries";

const actor = { workspace: { id: "workspace" }, user: { id: "member" }, membership: { role: "MEMBER" } } as SecretsActor;
const rows: SecretMetadata[] = Array.from({ length: 2001 }, (_, i) => ({
  id: `key-${i}`, key: `KEY_${String(i).padStart(4, "0")}`, path: "/app", deletedAt: null,
  comment: "", tags: [], ownerId: "member", rotateEveryDays: null, rotatedAt: new Date(0), updatedAt: new Date(0),
}));
beforeEach(() => { vi.resetAllMocks(); mocks.presence.mockResolvedValue([]); });

describe("Secrets active key pagination", () => {
  it("filters deleted keys before the limit and pages active metadata with a scoped cursor", async () => {
    mocks.rows.mockResolvedValueOnce(rows);
    const first = await loadSecrets(actor, "project", "environment", "/app");
    expect(mocks.rows).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { workspaceId: "workspace", environmentId: "environment", path: "/app", deletedAt: null },
      orderBy: [{ key: "asc" }, { id: "asc" }], take: 2001,
    }));
    expect(first.rows).toEqual(rows.slice(0, 2000));
    expect(first.nextKeysCursor).toBe(rows[1999].id);
    mocks.cursor.mockResolvedValue({ id: first.nextKeysCursor });
    mocks.rows.mockResolvedValueOnce(rows.slice(2000));
    const next = await loadSecrets(actor, "project", "environment", "/app", undefined, first.nextKeysCursor);
    expect(mocks.cursor).toHaveBeenCalledWith({
      where: { workspaceId: "workspace", environmentId: "environment", path: "/app", deletedAt: null, id: rows[1999].id },
      select: { id: true },
    });
    expect(mocks.rows).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: { id: rows[1999].id }, skip: 1 }));
    expect(next.rows).toEqual(rows.slice(2000));
    expect(next.keysCursor).toBe(first.nextKeysCursor);
    expect(next.nextKeysCursor).toBeUndefined();
  });
  it("compares every key/environment pair beyond 10,000 rows without a listing cap", async () => {
    const presence = Array.from({ length: 10001 }, (_, i) => ({ key: `KEY_${String(i).padStart(5, "0")}`, environmentId: "environment" }));
    // The second environment is beyond the former cap for a key already seen.
    presence.push({ key: "KEY_00000", environmentId: "staging" });
    mocks.rows.mockResolvedValue([]);
    mocks.presence.mockResolvedValue(presence);
    const view = await loadSecrets(actor, "project", "environment", "/app");
    expect(mocks.presence).toHaveBeenCalledWith({
      by: ["key", "environmentId"],
      where: { workspaceId: "workspace", environmentId: { in: ["environment", "staging"] }, path: "/app", deletedAt: null },
    });
    expect(view.comparison).toHaveLength(10001);
    expect(view.comparison[0]).toEqual({ key: "KEY_00000", environmentIds: ["environment", "staging"] });
    expect(view.comparison.at(-1)).toEqual({ key: "KEY_10000", environmentIds: ["environment"] });
    expect(mocks.rows).toHaveBeenCalledTimes(1);
  });
  it("does not offer another page for exactly 2000 active keys", async () => {
    mocks.rows.mockResolvedValueOnce(rows.slice(0, 2000));
    expect((await loadSecrets(actor)).nextKeysCursor).toBeUndefined();
  });
  it("rejects a cursor outside the active workspace, environment or folder before listing keys", async () => {
    mocks.cursor.mockResolvedValue(null);
    await expect(loadSecrets(actor, "project", "environment", "/app", undefined, "unavailable")).rejects.toThrow("keys page");
    expect(mocks.cursor).toHaveBeenCalledWith({
      where: { workspaceId: "workspace", environmentId: "environment", path: "/app", deletedAt: null, id: "unavailable" },
      select: { id: true },
    });
    expect(mocks.rows).not.toHaveBeenCalled();
  });
});
