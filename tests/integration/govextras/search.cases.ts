import { it, expect } from "vitest";
import { saveRecord, type Actor } from "@/lib/governance/service";
import { searchDocuments } from "@/lib/search/query";
import { suffix, owner, handler, other } from "./fixtures";

export function registerSearchTests() {
  it("indexes ordinary extras privately with live governance role checks", async () => {
    const risk = await saveRecord(owner, {
      kind: "RISK",
      title: `Risk searchable ${suffix}`,
      status: "OPEN",
      dueOn: "2027-01-01",
      details: { likelihood: 1, impact: 1, controls: "Check" },
    });
    const search = (a: Actor) =>
      searchDocuments(
        {
          workspaceId: a.workspace.id,
          userId: a.user.id,
          role: a.membership.role,
        },
        suffix,
        "governance",
      );
    expect((await search(owner)).some((r) => r.entityId === risk.id)).toBe(
      true,
    );
    expect(await search(handler)).toHaveLength(0);
    expect(await search(other)).toHaveLength(0);
  });
}
