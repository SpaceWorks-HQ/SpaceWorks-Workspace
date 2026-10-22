import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { saveRecord } from "@/lib/governance/service";
import { linkConflict, loadConflictLinks } from "@/lib/govextras/conflicts";
import { owner, other, committee } from "./fixtures";

export function registerConflictsTests() {
  it("links declarations to tenant purchases, bills, contracts and decisions and flags payees", async () => {
    const organisation = await prisma.organisation.create({
      data: {
        workspaceId: owner.workspace.id,
        name: "Kochi Print Cooperative",
      },
    });
    const vendor = (
      await saveRecord(owner, {
        kind: "VENDOR",
        title: organisation.name,
        status: "ACTIVE",
        organisationId: organisation.id,
        details: {},
      })
    ).id;
    const declaration = (
      await saveRecord(owner, {
        kind: "CONFLICT",
        title: "Print interest",
        status: "DECLARED",
        parentId: committee,
        dueOn: "2026-10-20",
        details: {
          person: "Trustee",
          declaration: "Related party",
          partyOrgId: organisation.id,
          partyName: organisation.name,
        },
      })
    ).id;
    const purchase = await prisma.purchaseRequest.create({
      data: {
        workspaceId: owner.workspace.id,
        title: "Printing",
        requesterId: owner.user.id,
        items: [],
        totalMinor: 10000,
        vendorOrgId: organisation.id,
      },
    });
    const bill = await prisma.financeBill.create({
      data: {
        workspaceId: owner.workspace.id,
        vendor: "  KOCHI PRINT COOPERATIVE ",
        number: "BILL-1",
        issuedOn: new Date("2026-10-01"),
        dueOn: new Date("2026-10-31"),
        amountMinor: 10000,
        createdById: owner.user.id,
      },
    });
    const contract = await saveRecord(owner, {
      kind: "CONTRACT",
      title: "Printing agreement",
      status: "ACTIVE",
      startsOn: "2026-01-01",
      endsOn: "2027-01-01",
      details: {
        vendorId: vendor,
        amountMinor: 10000,
        currency: "INR",
        noticeDays: 30,
      },
    });
    const decision = await prisma.decision.create({
      data: {
        workspaceId: owner.workspace.id,
        title: "Approve print purchase",
        decisionMd: "Recusal recorded",
        createdById: owner.user.id,
      },
    });
    for (const [targetType, targetId] of [
      ["purchase", purchase.id],
      ["bill", bill.id],
      ["contract", contract.id],
      ["decision", decision.id],
    ])
      await linkConflict(owner, {
        declarationId: declaration,
        targetType,
        targetId,
        note: "Trustee recused",
      });
    const data = await loadConflictLinks(owner, declaration);
    expect(data.links).toHaveLength(4);
    expect(data.warnings).toHaveLength(3);
    await expect(
      linkConflict(other, {
        declarationId: declaration,
        targetType: "purchase",
        targetId: purchase.id,
      }),
    ).rejects.toThrow();
    const otherDecision = await prisma.decision.create({
      data: {
        workspaceId: other.workspace.id,
        title: "Private",
        decisionMd: "Private",
      },
    });
    await expect(
      linkConflict(owner, {
        declarationId: declaration,
        targetType: "decision",
        targetId: otherDecision.id,
      }),
    ).rejects.toThrow();
  });
}
