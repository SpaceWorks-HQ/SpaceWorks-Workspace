import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import {
  appointHandler,
  createCase,
  loadCases,
  addCaseEvent,
  updateCase,
  completeCaseAction,
  uploadCaseFile,
  caseAccess,
} from "@/lib/govextras/cases";
import { findDownloadableFile } from "@/lib/files";
import { owner, admin, handler, second, committee, proof, records } from "./fixtures";

export function registerCaseLifecycleTests() {
  it("maintains restricted append-only timelines and requires finished actions plus outcome", async () => {
    await addCaseEvent(handler, {
      caseId: records.caseId,
      kind: "ACTION",
      body: "Committee action",
      ownerId: handler.user.id,
      dueOn: "2026-10-31",
    });
    await expect(
      updateCase(handler, { caseId: records.caseId, status: "CLOSED" }),
    ).rejects.toThrow();
    const action = await prisma.safeguardingEvent.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, caseId: records.caseId, kind: "ACTION" },
    });
    expect(action.bodyEnc).not.toContain("Committee action");
    await expect(
      completeCaseAction(admin, records.caseId, action.id),
    ).rejects.toThrow();
    await completeCaseAction(handler, records.caseId, action.id);
    await expect(
      updateCase(handler, { caseId: records.caseId, status: "CLOSED" }),
    ).rejects.toThrow();
    await addCaseEvent(handler, {
      caseId: records.caseId,
      kind: "OUTCOME",
      body: "Committee outcome recorded",
    });
    await updateCase(handler, { caseId: records.caseId, status: "CLOSED" });
    await expect(
      addCaseEvent(handler, { caseId: records.caseId, kind: "NOTE", body: "Late edit" }),
    ).rejects.toThrow();
    await expect(uploadCaseFile(handler, records.caseId, proof())).rejects.toThrow();
  });
  it("revokes case and file access immediately after appointment revocation", async () => {
    const row = await createCase(second, {
      kind: "SAFEGUARDING",
      receivedOn: "2026-10-01",
      dueOn: "2026-10-31",
      handlerIds: [second.user.id],
      details: "Restricted",
    });
    const file = await uploadCaseFile(second, row.id, proof());
    await appointHandler(owner, {
      userId: second.user.id,
      committeeId: committee,
      endsOn: "2099-12-31",
      revoke: true,
    });
    await expect(caseAccess(second, row.id)).rejects.toThrow();
    expect(await findDownloadableFile(file.id, second.user.id)).toBeNull();
    expect((await loadCases(second, {})).rows).toHaveLength(0);
  });
}
