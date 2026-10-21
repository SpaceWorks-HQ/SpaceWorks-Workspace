import { it, expect } from "vitest";
import { uploadFinanceFiles } from "@/lib/finance/tools/files";
import { findDownloadableFile } from "@/lib/files";
import { canAccessResource } from "@/lib/search/query";
import { owner, person, pdf, records } from "./fixtures";

export function registerEvidenceAccessTests() {
  it("enforces live search and download permissions for schedule evidence", async () => {
    const [file] = await uploadFinanceFiles(owner, "RECURRING", records.scheduleId, [
      pdf(),
    ]);
    expect(await findDownloadableFile(file!.id, person.user.id)).toBeNull();
    expect(
      await canAccessResource(
        {
          workspaceId: owner.workspace.id,
          userId: person.user.id,
          role: "MEMBER",
        },
        "recurring_cost",
        records.scheduleId,
      ),
    ).toBe(false);
    expect(
      await canAccessResource(
        {
          workspaceId: owner.workspace.id,
          userId: owner.user.id,
          role: "OWNER",
        },
        "recurring_cost",
        records.scheduleId,
      ),
    ).toBe(true);
  });
}
