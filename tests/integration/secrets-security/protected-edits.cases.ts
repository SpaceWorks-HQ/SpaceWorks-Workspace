import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import {
  changeSecrets,
} from "@/lib/secrets/service";
import { decide } from "@/lib/approvals/engine";
import { openValue } from "@/lib/secrets/encryption";
import { owner, admin, project } from "./fixtures";

export function registerProtectedEditTests() {
  it("keeps protected edits pending until an independent admin approves; rejects stale revisions", async () => {
    const p = await project();
    const first = await changeSecrets(owner, p.production.id, [
      { key: "TOKEN", path: "/", value: "first" },
    ]);
    expect(first.pending).toBe(true);
    expect(
      await prisma.applicationSecret.count({
        where: {
          workspaceId: owner.workspace.id,
          environmentId: p.production.id,
        },
      }),
    ).toBe(0);
    const request = await prisma.approvalRequest.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, subjectId: first.changeId },
    });
    expect(request.title).toContain("production");
    expect(
      (await decide(owner, { requestId: request.id, decision: "APPROVED" })).ok,
    ).toBe(false);
    expect(
      (await decide(admin, { requestId: request.id, decision: "APPROVED" })).ok,
    ).toBe(true);
    const a = await changeSecrets(owner, p.production.id, [
      { key: "TOKEN", path: "/", value: "second" },
    ]);
    const b = await changeSecrets(owner, p.production.id, [
      { key: "TOKEN", path: "/", value: "stale" },
    ]);
    const requests = await prisma.approvalRequest.findMany({
      where: {
        workspaceId: owner.workspace.id,
        subjectId: { in: [a.changeId!, b.changeId!] },
      },
    });
    expect(
      (
        await decide(admin, {
          requestId: requests.find((r) => r.subjectId === a.changeId)!.id,
          decision: "APPROVED",
        })
      ).ok,
    ).toBe(true);
    await expect(
      decide(admin, {
        requestId: requests.find((r) => r.subjectId === b.changeId)!.id,
        decision: "APPROVED",
      }),
    ).rejects.toThrow("changed");
    expect(
      await openValue(
        await prisma.applicationSecret.findFirstOrThrow({
          where: {
            workspaceId: owner.workspace.id,
            environmentId: p.production.id,
          },
        }),
      ),
    ).toBe("second");
  });
}
