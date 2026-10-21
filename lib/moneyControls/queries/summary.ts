import "server-only";
import { prisma } from "@/lib/db";
import { controlsAccess, details, type ControlsActor } from "../access";
import { depreciation, detailsSchemas, type DepreciationBasis } from "../rules";
import { fundAssessment, utilisation } from "../funds";
import { accountBalance } from "@/lib/finance/tools/close";
import { localDate } from "@/lib/finance/dates";
import type { ControlSummary } from "../types";

export async function controlsSummary(
  actor: ControlsActor,
  section: string,
  year: number,
  fundId?: string,
): Promise<ControlSummary> {
  const a = await controlsAccess(actor),
    workspaceId = actor.workspace.id;
  if (!a.manage)
    return { balances: [], schedules: [], funds: [], utilisation: [] };
  const today = new Date(localDate(new Date(), actor.workspace.timezone));
  const balances =
    section === "cash"
      ? await Promise.all(
          (
            await prisma.financeAccount.findMany({
              where: { workspaceId, openingOn: { lte: today } },
            })
          ).map(async (account) => ({
            id: account.id,
            name: account.name,
            currency: account.currency,
            balanceMinor: (
              await accountBalance(prisma, workspaceId, account.id, today)
            ).balanceMinor,
          })),
        )
      : [];
  const schedules =
    section === "assets"
      ? await prisma.moneyControlRecord.findMany({
          where: { workspaceId, kind: "SCHEDULE", status: "ACTIVE" },
        })
      : [];
  const disposals = schedules.length
    ? await prisma.moneyControlRecord.findMany({
        where: {
          workspaceId,
          kind: "DISPOSAL",
          status: "POSTED",
          assetId: {
            in: schedules.flatMap((r) => (r.assetId ? [r.assetId] : [])),
          },
        },
      })
    : [];
  const funds =
    section === "funds"
      ? (await fundAssessment(prisma, workspaceId)).filter(
          (f) => !fundId || f.rule.fundId === fundId,
        )
      : [];
  return {
    balances,
    schedules: schedules.map((r) => ({
      id: r.id,
      title: r.title,
      currency: r.currency,
      costMinor: r.amountMinor,
      purchaseOn: r.occurredOn.toISOString().slice(0, 10),
      ...depreciation(
        r.amountMinor,
        r.occurredOn.toISOString().slice(0, 10),
        detailsSchemas.ASSET_CATEGORY.parse(
          details(r).basis,
        ) as DepreciationBasis,
        year,
        disposals
          .find((d) => d.assetId === r.assetId)
          ?.occurredOn.toISOString()
          .slice(0, 10),
      ),
    })),
    funds: funds.map((f) => ({
      id: f.rule.id,
      fundId: f.rule.fundId,
      title: f.rule.title,
      currency: f.rule.currency,
      budgetMinor: f.rule.amountMinor,
      committedMinor: f.committedMinor,
      remainingMinor: f.remainingMinor,
      issues: [
        ...new Set(f.evaluated.flatMap((e) => e.issues.map((i) => i.message))),
      ],
    })),
    utilisation:
      section === "funds"
        ? (await utilisation(workspaceId)).filter(
            (f) => !fundId || f.fundId === fundId,
          )
        : [],
  };
}
