import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { controlRecord } from "@/lib/moneyControls/access";
import { controlsSummary } from "@/lib/moneyControls/queries";
import { offboardingSources } from "@/lib/people/onboarding";
import { suffix, actor, member, asset, save, transition, attach } from "./fixtures";

export function registerAssetsTests() {
  it("tracks asset issue, acknowledgement, offboarding and return before disposal", async () => {
    const id = await save("ASSIGNMENT", {
      assetId: asset,
      ownerId: member.user.id,
      details: { condition: "Good" },
    });
    await transition(id);
    await transition(id, "ACKNOWLEDGE", {}, member);
    const sources = await prisma.$transaction((tx) =>
      offboardingSources(tx, actor.workspace.id, member.user.id),
    );
    expect(sources.assetsOwned.some((a) => a.id === asset)).toBe(true);
    const disposal = await save("DISPOSAL", {
      assetId: asset,
      amountMinor: 0,
      details: { method: "DONATION", counterparty: "Partner NGO" },
    });
    await attach(disposal);
    await expect(transition(disposal)).rejects.toThrow(/Return assigned/);
    await transition(id, "RETURN", { notes: "Good; charger received." });
    expect(
      (await prisma.asset.findUniqueOrThrow({ where: { id: asset } }))
        .ownerUserId,
    ).toBeNull();
    await transition(disposal);
    expect(
      (await prisma.asset.findUniqueOrThrow({ where: { id: asset } })).status,
    ).toBe("RETIRED");
  });
  it("snapshots depreciation policy and records verification evidence", async () => {
    const equipment = (
      await prisma.asset.create({
        data: {
          workspaceId: actor.workspace.id,
          name: "Office projector",
          category: "Equipment",
          tag: `projector-${suffix}`,
        },
      })
    ).id;
    const cat = await save("ASSET_CATEGORY", {
      details: {
        method: "SLM",
        lifeYears: 5,
        rateBps: 2000,
        residualMinor: 0,
        taxBlockNote: "Reviewed book policy",
      },
    });
    const id = await save("SCHEDULE", {
      assetId: equipment,
      amountMinor: 100000,
      occurredOn: "2026-04-01",
      details: { categoryRecordId: cat, fundingSource: "Unrestricted kitty" },
    });
    await attach(id);
    await transition(id);
    await save("ASSET_CATEGORY", {
      id: cat,
      details: { method: "WDV", lifeYears: 3, rateBps: 4000, residualMinor: 0 },
    });
    const summary = await controlsSummary(actor, "assets", 2026);
    expect(summary.schedules.find((s) => s.id === id)?.depreciationMinor).toBe(
      20000,
    );
    const verify = await save("VERIFICATION", {
      assetId: equipment,
      details: { condition: "Good" },
    });
    await attach(verify);
    await transition(verify);
    expect((await controlRecord(actor, verify)).status).toBe("RECORDED");
  });
}
