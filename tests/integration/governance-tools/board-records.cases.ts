import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { saveRecord, operate, attachFile } from "@/lib/governance/service";
import { actor, committeeId, meetingId, obligation } from "./fixtures";

export function registerBoardRecordsTests() {
  it("retains filing proof and creates the next occurrence once under retries", async () => {
    const first = await saveRecord(
      actor,
      obligation({
        status: "FILED",
        ownerId: actor.user.id,
        details: { recurrence: "ANNUALLY", acknowledgement: "ACK-2026" },
      }),
    );
    const results = await Promise.all([
      operate(actor, { op: "next", id: first.id }),
      operate(actor, { op: "next", id: first.id }),
    ]);
    expect(results[0].id).toBe(results[1].id);
    const original = await prisma.governanceRecord.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(original.details).toMatchObject({ acknowledgement: "ACK-2026" });
    expect(
      (
        await prisma.governanceRecord.findUniqueOrThrow({
          where: { id: results[0].id },
        })
      ).dueOn?.toISOString(),
    ).toContain("2027-12-31");
  });
  it("records terms, declarations and a repeat-safe AGM checklist", async () => {
    await saveRecord(actor, {
      kind: "TERM",
      title: "Chair term",
      status: "ACTIVE",
      parentId: committeeId,
      startsOn: "2026-01-01",
      endsOn: "2028-12-31",
      details: { person: "Anjali", position: "Chair" },
    });
    await saveRecord(actor, {
      kind: "CONFLICT",
      title: "Annual declaration",
      status: "DECLARED",
      parentId: committeeId,
      dueOn: "2026-10-20",
      details: { person: "Anjali", declaration: "No conflicts declared." },
    });
    await Promise.all(
      [1, 2].map(() =>
        operate(actor, {
          op: "agm",
          parentId: committeeId,
          year: "2026",
          dueOn: "2026-12-01",
        }),
      ),
    );
    expect(
      await prisma.governanceRecord.count({
        where: { workspaceId: actor.workspace.id, kind: "AGM_ITEM" },
      }),
    ).toBe(6);
  });
  it("approves minutes once and prevents subsequent text, proof or archive changes", async () => {
    const minutes = await saveRecord(actor, {
      kind: "MINUTES",
      title: "Annual minutes",
      status: "DRAFT",
      parentId: committeeId,
      meetingId,
      details: { content: "Accounts were reviewed." },
    });
    await operate(actor, { op: "approve", id: minutes.id });
    await expect(
      operate(actor, { op: "approve", id: minutes.id }),
    ).rejects.toThrow();
    await expect(
      operate(actor, { op: "archive", id: minutes.id }),
    ).rejects.toThrow();
    await expect(
      saveRecord(actor, {
        id: minutes.id,
        kind: "MINUTES",
        title: "Altered",
        status: "DRAFT",
        parentId: committeeId,
        meetingId,
        details: { content: "Changed." },
      }),
    ).rejects.toThrow();
    await expect(
      attachFile(
        actor,
        minutes.id,
        new File(["proof"], "proof.pdf", { type: "application/pdf" }),
      ),
    ).rejects.toThrow();
  });
  it("allocates distinct workspace resolution numbers concurrently", async () => {
    const rows = await Promise.all(
      ["One", "Two"].map((title) =>
        saveRecord(actor, {
          kind: "RESOLUTION",
          title,
          status: "PASSED",
          parentId: committeeId,
          details: { content: title },
        }),
      ),
    );
    const records = await prisma.governanceRecord.findMany({
      where: {
        workspaceId: actor.workspace.id,
        id: { in: rows.map((r) => r.id) },
      },
    });
    expect(new Set(records.map((r) => r.number)).size).toBe(2);
  });
}
