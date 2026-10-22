import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { buildWorkspaceExport } from "@/lib/shell/export";
import { memberId, workspaceId, publicDoc } from "./fixtures";

export function registerExportRedactionTests() {
  it("exports content while excluding every credential and vault table", async () => {
    await prisma.monitor.create({
      data: {
        workspaceId,
        name: "Maker monitor",
        type: "HTTP",
        secretEnc: "NEVER_EXPORT_SECRET",
        config: { password: "NEVER_EXPORT_PASSWORD" },
        heartbeatTokenHash: "NEVER_EXPORT_HASH",
      },
    });
    await prisma.memberProfile.create({
      data: {
        workspaceId,
        userId: memberId,
        emergencyContactEnc: "NEVER_EXPORT_EMERGENCY",
      },
    });
    const bundle = await buildWorkspaceExport(workspaceId);
    const json = JSON.stringify(bundle);
    expect(json).toContain(publicDoc);
    expect(json).not.toContain("NEVER_EXPORT");
    expect(bundle.entities).not.toHaveProperty("Account");
    expect(bundle.entities).not.toHaveProperty("VaultItem");
    expect(bundle.entities).not.toHaveProperty("Message");
  });
}
