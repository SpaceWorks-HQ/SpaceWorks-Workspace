import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { saveDraft, issueDocument } from "@/lib/documents/service";
import { actor, other, member, draft } from "./fixtures";

export function registerAccessValidationTests() {
  it("rechecks membership instead of trusting a forged role", async () => {
    await expect(saveDraft(member, draft())).rejects.toThrow("access");
  });
  it("rejects cross-workspace registrations", async () => {
    const id = await saveDraft(other, draft());
    await expect(issueDocument(other, id)).rejects.toThrow();
  });
  it("requires INR preparation for GST tax records", async () => {
    const id = await saveDraft(actor, draft({ currency: "USD" }));
    await expect(issueDocument(actor, id)).rejects.toThrow("GST values in INR");
  });
  it("rejects cross-workspace CRM and sources", async () => {
    const c = await prisma.contact.create({
      data: { workspaceId: other.workspace.id, displayName: "Foreign contact" },
    });
    await expect(saveDraft(actor, draft({ contactId: c.id }))).rejects.toThrow(
      "workspace",
    );
    await expect(
      saveDraft(actor, draft({ sourceType: "LEDGER", sourceId: "foreign" })),
    ).rejects.toThrow("workspace");
  });
}
