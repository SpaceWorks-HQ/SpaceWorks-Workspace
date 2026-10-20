import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import {
  controlsAccess,
  controlRecord,
  details,
  type ControlsActor,
} from "./access";
import {
  querySchema,
  SECTIONS,
  depreciation,
  detailsSchemas,
  type ControlsQuery,
  type DepreciationBasis,
} from "./rules";
import { fundAssessment, utilisation } from "./funds";
import { accountBalance } from "@/lib/finance/tools/close";
import { localDate } from "@/lib/finance/dates";
import type {
  ControlRow,
  ControlList,
  ControlPickers,
  ControlSummary,
  ControlsView,
} from "./types";
const CONTROL_INCLUDE = {
  attachments: {
    where: { file: { deletedAt: null } },
    select: {
      file: { select: { id: true, filename: true, contentType: true } },
    },
  },
  events: {
    where: { action: { not: "OPERATION" } },
    orderBy: { createdAt: "asc" },
  },
  movements: { orderBy: { occurredOn: "asc" } },
} satisfies Prisma.MoneyControlRecordInclude;

function serialiseControl(
  r: Prisma.MoneyControlRecordGetPayload<{ include: typeof CONTROL_INCLUDE }>,
): ControlRow {
  const { attachments, ...record } = r;
  return {
    ...record,
    occurredOn: r.occurredOn.toISOString().slice(0, 10),
    endsOn: r.endsOn?.toISOString().slice(0, 10) ?? "",
    dueOn: r.dueOn?.toISOString().slice(0, 10) ?? "",
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    files: attachments.map((f) => f.file),
    movements: r.movements.map((m) => ({
      ...m,
      occurredOn: m.occurredOn.toISOString().slice(0, 10),
      createdAt: m.createdAt.toISOString(),
      reconciledAt: m.reconciledAt?.toISOString() ?? null,
    })),
    events: r.events.map((e) => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

export async function listControls(
  actor: ControlsActor,
  input: ControlsQuery,
  exporting = false,
): Promise<ControlList> {
  const a = await controlsAccess(actor),
    q = querySchema.parse(input),
    workspaceId = actor.workspace.id;
  const where: Prisma.MoneyControlRecordWhereInput = {
    workspaceId,
    kind: {
      in:
        q.kind && SECTIONS[q.section].includes(q.kind)
          ? [q.kind]
          : SECTIONS[q.section],
    },
    ...(q.status ? { status: q.status } : {}),
    ...(q.owner ? { ownerId: q.owner } : {}),
    ...(q.fundId ? { fundId: q.fundId } : {}),
    ...(q.section === "tds"
      ? {
          AND: [
            { details: { path: ["fiscalYear"], equals: q.fiscalYear } },
            ...(q.quarter
              ? [{ details: { path: ["quarter"], equals: q.quarter } }]
              : []),
          ],
        }
      : {}),
    ...(q.q ? { title: { contains: q.q, mode: "insensitive" } } : {}),
    ...(q.from || q.to
      ? {
          occurredOn: {
            ...(q.from ? { gte: new Date(q.from) } : {}),
            ...(q.to ? { lte: new Date(q.to) } : {}),
          },
        }
      : {}),
    ...(!a.payrollView ? { payroll: false } : {}),
    ...(!a.manage
      ? {
          OR: [
            {
              kind: { in: ["HANDOVER", "ASSIGNMENT"] },
              ownerId: actor.user.id,
            },
            {
              kind: "HANDOVER",
              details: { path: ["outgoingId"], equals: actor.user.id },
            },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.moneyControlRecord.findMany({
      where,
      orderBy: [{ occurredOn: "desc" }, { id: "desc" }],
      take: exporting ? 10001 : 40,
      skip: exporting ? 0 : (q.page - 1) * 40,
      include: CONTROL_INCLUDE,
    }),
    prisma.moneyControlRecord.count({ where }),
  ]);
  if (rows.some((r) => r.payroll))
    await recordAuditEvent({
      workspaceId,
      actorId: actor.user.id,
      action: "moneycontrols.payroll_records_viewed",
      targetType: "money_control",
      metadata: { count: rows.filter((r) => r.payroll).length, exporting },
    });
  return {
    q,
    total,
    manage: a.manage,
    payrollManage: a.payrollManage,
    rows: rows.map(serialiseControl),
  };
}
export async function controlsPickers(
  actor: ControlsActor,
): Promise<ControlPickers> {
  const a = await controlsAccess(actor),
    workspaceId = actor.workspace.id;
  if (!a.manage) {
    const handovers = await prisma.moneyControlRecord.findMany({
      where: {
        workspaceId,
        kind: "HANDOVER",
        OR: [
          { ownerId: actor.user.id },
          { details: { path: ["outgoingId"], equals: actor.user.id } },
        ],
      },
      select: { accountId: true },
    });
    return {
      accounts: await prisma.financeAccount.findMany({
        where: {
          workspaceId,
          id: {
            in: handovers.flatMap((r) => (r.accountId ? [r.accountId] : [])),
          },
        },
        select: { id: true, name: true, currency: true },
      }),
      funds: [],
      assets: await prisma.asset.findMany({
        where: { workspaceId },
        select: { id: true, name: true },
      }),
      members: (
        await prisma.membership.findMany({
          where: { workspaceId, status: "ACTIVE", user: { disabledAt: null } },
          select: { userId: true, user: { select: { name: true } } },
        })
      ).map((m) => ({ id: m.userId, name: m.user.name ?? "Former member" })),
      categories: [],
      records: [],
      compliance: [],
      checklists: [],
    };
  }
  const [
    accounts,
    funds,
    assets,
    members,
    categories,
    records,
    compliance,
    checklists,
  ] = await Promise.all([
    prisma.financeAccount.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, currency: true },
    }),
    prisma.financeFund.findMany({
      where: { workspaceId, archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, currency: true },
    }),
    prisma.asset.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.membership.findMany({
      where: {
        workspaceId,
        status: "ACTIVE",
        role: { not: "GUEST" },
        user: { disabledAt: null },
      },
      select: { userId: true, user: { select: { name: true } } },
    }),
    prisma.financeCategory.findMany({
      where: { workspaceId, archivedAt: null, kind: "EXPENSE" },
      select: { id: true, name: true },
    }),
    prisma.moneyControlRecord.findMany({
      where: {
        workspaceId,
        kind: { in: ["ASSET_CATEGORY", "TDS_DEDUCTION"] },
        status: { not: "CANCELLED" },
        ...(!a.payrollView ? { payroll: false } : {}),
      },
      select: { id: true, title: true, kind: true },
    }),
    prisma.governanceRecord.findMany({
      where: { workspaceId, kind: "OBLIGATION", archivedAt: null },
      select: { id: true, title: true },
    }),
    prisma.checklistRun.findMany({
      where: { workspaceId, kind: { in: ["ONBOARDING", "OFFBOARDING"] } },
      select: { id: true, title: true, subjectUserId: true },
    }),
  ]);
  return {
    accounts,
    funds,
    assets,
    members: members.map((m) => ({
      id: m.userId,
      name: m.user.name ?? "Former member",
    })),
    categories,
    records,
    compliance,
    checklists,
  };
}
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
export async function selectedControl(
  actor: ControlsActor,
  id: string,
): Promise<ControlRow> {
  await controlRecord(actor, id);
  const row = await prisma.moneyControlRecord.findFirstOrThrow({
    where: { workspaceId: actor.workspace.id, id },
    include: CONTROL_INCLUDE,
  });
  if (row.payroll)
    await recordAuditEvent({
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      action: "moneycontrols.payroll_record_viewed",
      targetType: "money_control",
      targetId: row.id,
    });
  return serialiseControl(row);
}

/** The page loads every backend value before rendering, preserving the private frontend gateway. */
export async function loadControlsView(
  actor: ControlsActor,
  section: import("./rules").Section,
  query: ControlsQuery,
  edit?: string,
  newKind?: string,
): Promise<ControlsView> {
  const today = localDate(new Date(), actor.workspace.timezone);
  const { fiscalYear, sectionFor } = await import("./rules");
  const data = await listControls(actor, {
    ...query,
    fiscalYear: query.fiscalYear ?? fiscalYear(today),
    section,
  });
  const p = await controlsPickers(actor),
    summary = await controlsSummary(
      actor,
      section,
      data.q.fiscalYear,
      data.q.fundId,
    );
  let editing: import("./rules").EditableControl | undefined;
  if (edit) {
    const row = await selectedControl(actor, edit);
    if (sectionFor(row.kind) === section) {
      if (!data.rows.some((r) => r.id === row.id)) data.rows.unshift(row);
      if (data.manage) editing = { ...row };
    }
  }

  const viewActor: ControlsActor = {
    user: { id: actor.user.id, name: actor.user.name },
    membership: { role: actor.membership.role },
    workspace: {
      id: actor.workspace.id,
      slug: actor.workspace.slug,
      name: actor.workspace.name,
      currency: actor.workspace.currency,
      timezone: actor.workspace.timezone,
    },
  };
  return {
    actor: viewActor,
    section,
    data,
    p,
    summary,
    editing,
    newKind,
    edit,
    today,
  };
}
