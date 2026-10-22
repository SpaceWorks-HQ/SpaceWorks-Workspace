import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { saveDraft, issueDocument } from "@/lib/documents/service";
import { getDocument } from "@/lib/documents/access";
import type { DocumentSnapshot } from "@/lib/documents/service";
import { actor, draft } from "./fixtures";

export function registerUtilisationCertificatesTests() {
  it("issues a reviewed utilisation certificate from the existing fund", async () => {
    const fund = await prisma.financeFund.create({
      data: {
        workspaceId: actor.workspace.id,
        name: "Community programme",
        currency: "INR",
      },
    });
    await prisma.ledgerEntry.createMany({
      data: [
        {
          workspaceId: actor.workspace.id,
          fundId: fund.id,
          kind: "INCOME",
          description: "Grant received",
          amountMinor: 100000,
          currency: "INR",
          occurredOn: new Date("2026-04-01"),
        },
        {
          workspaceId: actor.workspace.id,
          fundId: fund.id,
          kind: "EXPENSE",
          description: "Programme materials",
          amountMinor: 80000,
          currency: "INR",
          occurredOn: new Date("2026-05-01"),
        },
      ],
    });
    await prisma.ledgerEntry.createMany({
      data: [
        {
          workspaceId: actor.workspace.id,
          fundId: fund.id,
          kind: "INCOME",
          description: "Bank interest",
          amountMinor: 1000,
          currency: "INR",
          occurredOn: new Date("2026-06-01"),
        },
        {
          workspaceId: actor.workspace.id,
          fundId: fund.id,
          kind: "EXPENSE",
          description: "Unused funds returned",
          amountMinor: 500,
          currency: "INR",
          occurredOn: new Date("2026-09-30"),
        },
      ],
    });
    const id = await saveDraft(
      actor,
      draft({
        type: "CSR_UC",
        registrationId: "",
        fundId: fund.id,
        sourceType: "FUND",
        sourceId: fund.id,
        periodStart: "2026-04-01",
        periodEnd: "2026-09-30",
        sanction: "Programme agreement dated 1 April 2026",
        schedules: "Equipment schedule checked against ledger",
        outcomes: "Three community workshops",
        receiptsMinor: 100000,
        interestMinor: 1000,
        refundsMinor: 500,
        expenditureMinor: 80000,
        lines: [],
      }),
    );
    await issueDocument(actor, id);
    const snapshot = (await getDocument(actor, id))
      .snapshot as unknown as DocumentSnapshot;
    expect(snapshot.source.fundId).toBe(fund.id);
    expect(snapshot.source.incomeMinor).toBe(101000);
    expect(snapshot.source.expenseMinor).toBe(80500);
    expect((await getDocument(actor, id)).status).toBe("ISSUED");
  });
}
