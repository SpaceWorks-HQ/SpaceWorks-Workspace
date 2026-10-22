import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { saveDraft, issueDocument, saveReference } from "@/lib/documents/service";
import { getDocument } from "@/lib/documents/access";
import { saveFilingBatch } from "@/lib/documents/filings";
import { actor, draft, records } from "./fixtures";

export function registerLettersFilingsTests() {
  it("issues letters from approved merge wording and retains correction links", async () => {
    const templateId = await saveReference(
      actor,
      "TEMPLATE",
      "Volunteer completion",
      {
        type: "VOLUNTEER",
        body: "{{person}} served as {{role}} from {{start}} to {{end}} for {{hours}} hours.",
        version: "1",
      },
    );
    const id = await saveDraft(
      actor,
      draft({
        type: "VOLUNTEER",
        registrationId: "",
        templateId,
        partyName: "Meera",
        startsOn: "2026-04-01",
        endsOn: "2026-09-30",
        role: "Programme volunteer",
        hours: "40",
        lines: [],
      }),
    );
    await issueDocument(actor, id);
    expect((await getDocument(actor, id)).snapshot).toMatchObject({
      letter:
        "Meera served as Programme volunteer from 2026-04-01 to 2026-09-30 for 40 hours.",
    });
  });
  it("freezes accepted filing snapshots and prevents repeated originals", async () => {
    const invoice = await getDocument(actor, records.invoiceId);
    const input = {
      name: "October preparation",
      form: "GSTR1",
      start: "2026-10-01",
      end: "2026-10-31",
      status: "ACCEPTED",
      acknowledgement: "MANUAL-PORTAL-ACK",
      documentIds: invoice.number!,
    };
    const id = await saveFilingBatch(actor, input);
    await expect(saveFilingBatch(actor, { ...input, id })).rejects.toThrow(
      "frozen",
    );
    await expect(
      saveFilingBatch(actor, { ...input, name: "Repeated original" }),
    ).rejects.toThrow("already");
    await expect(
      prisma.documentReference.delete({ where: { id } }),
    ).rejects.toThrow("retained");
  });
}
