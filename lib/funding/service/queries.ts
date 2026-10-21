import "server-only";
import { prisma } from "@/lib/db";
import {
  SECTION_KINDS,
  type Section,
} from "@/lib/funding/schema";
import {
  donationSummary,
  pledgeDue,
} from "@/lib/funding/analytics";
import { maxUploadBytes } from "@/lib/storage";
import {
  assertActor,
  type Actor,
} from "./access";
import {
  recordsWhere,
  type Filters,
} from "./filters";

export async function analyticsSnapshot(
  actor: Actor,
  now = new Date(),
  majorMinor = 1000000,
  majorCurrency = "INR",
) {
  await assertActor(actor);
  const gifts = await prisma.fundingRecord.findMany({
    where: {
      workspaceId: actor.workspace.id,
      kind: "DONATION",
      archivedAt: null,
    },
    select: {
      id: true,
      contactId: true,
      dateOn: true,
      amountMinor: true,
      currency: true,
      status: true,
      details: true,
      thankedAt: true,
    },
  });
  return {
    summary: donationSummary(gifts, now, majorMinor, majorCurrency),
    gifts,
  };
}
export async function loadFunding(
  actor: Actor,
  section: Section,
  filters: Filters,
  edit?: string,
) {
  await assertActor(actor);
  const workspaceId = actor.workspace.id;
  const where = recordsWhere(actor, section, filters);
  const page = Math.max(
    1,
    Math.min(10000, Number.parseInt(filters.page ?? "1", 10) || 1),
  );
  const [
    records,
    total,
    selected,
    people,
    contacts,
    organisations,
    services,
    subscriptions,
    funds,
    choices,
    documents,
  ] = await Promise.all([
    prisma.fundingRecord.findMany({
      where,
      orderBy: [{ dueOn: "asc" }, { createdAt: "desc" }, { id: "asc" }],
      take: 30,
      skip: (page - 1) * 30,
    }),
    prisma.fundingRecord.count({ where }),
    edit
      ? prisma.fundingRecord.findFirst({
          where: {
            workspaceId,
            id: edit.slice(0, 64),
            kind: { in: SECTION_KINDS[section] },
          },
          include: {
            attachments: {
              where: { file: { deletedAt: null } },
              select: {
                file: {
                  select: {
                    id: true,
                    filename: true,
                    contentType: true,
                    size: true,
                  },
                },
              },
            },
            children: {
              where: { archivedAt: null },
              select: {
                id: true,
                title: true,
                kind: true,
                status: true,
                amountMinor: true,
                currency: true,
                dateOn: true,
                dueOn: true,
                details: true,
              },
            },
          },
        })
      : null,
    prisma.membership.findMany({
      where: { workspaceId },
      select: {
        user: { select: { id: true, name: true } },
        role: true,
        status: true,
      },
    }),
    prisma.contact.findMany({
      where: { workspaceId, deletedAt: null },
      select: {
        id: true,
        displayName: true,
        emails: true,
        preferredChannel: true,
        consentStatus: true,
        consentSource: true,
        doNotContact: true,
      },
      orderBy: { displayName: "asc" },
    }),
    prisma.organisation.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.serviceCatalogItem.findMany({
      where: { workspaceId },
      select: { id: true, name: true },
    }),
    prisma.subscription.findMany({
      where: { workspaceId },
      select: { id: true, name: true },
    }),
    prisma.financeFund.findMany({
      where: { workspaceId, archivedAt: null },
      select: { id: true, name: true, currency: true },
      orderBy: { name: "asc" },
    }),
    prisma.fundingRecord.findMany({
      where: { workspaceId, archivedAt: null },
      select: {
        id: true,
        title: true,
        kind: true,
        parentId: true,
        contactId: true,
        dateOn: true,
        dueOn: true,
        endsOn: true,
        status: true,
        amountMinor: true,
        currency: true,
        details: true,
        thankedAt: true,
        ownerId: true,
      },
    }),
    prisma.businessDocument.findMany({
      where: { workspaceId, sourceType: "FUNDING" },
      select: {
        id: true,
        sourceId: true,
        type: true,
        status: true,
        number: true,
      },
    }),
  ]);
  // The same snapshot feeds donor retention and campaign analytics consumers.
  const summary = donationSummary(
    choices.filter((r) => r.kind === "DONATION"),
    new Date(),
    Math.max(1, Math.min(2147483647, Number(filters.major) || 1000000)),
    filters.currency ?? "INR",
  );
  const pledgeDates = choices
    .filter((r) => r.kind === "PLEDGE" && r.status === "ACTIVE")
    .map((p) => ({
      id: p.id,
      dueOn: pledgeDue(
        p,
        choices.filter((r) => r.kind === "DONATION"),
      ),
    }));
  return {
    records,
    total,
    page,
    selected,
    documents,
    people,
    contacts,
    organisations,
    services,
    subscriptions,
    funds,
    choices,
    summary,
    pledgeDates,
    uploadMaxBytes: maxUploadBytes(),
  };
}
export type FundingData = Awaited<ReturnType<typeof loadFunding>>;
