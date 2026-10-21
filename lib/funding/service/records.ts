import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  recordSchema,
  detailSchemas,
} from "@/lib/funding/schema";
import {
  lock,
  ensure,
  type Actor,
} from "./access";
import { sync } from "./activity";
import {
  linked,
  PARENTS,
} from "./record-links";

export async function saveRecord(actor: Actor, raw: unknown) {
  const input = recordSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await lock(actor, tx);
    const workspaceId = actor.workspace.id;
    const old = input.id
      ? await tx.fundingRecord.findFirst({
          where: { workspaceId, id: input.id, archivedAt: null },
        })
      : null;
    if (input.id) ensure(old);
    ensure(!old || old.kind === input.kind);
    ensure(
      !old?.signedAt,
      "Signed reviews are locked. Add a review for the next quarter.",
    );
    ensure(
      !old?.receiptFileId,
      "Issued receipts are locked. Void the gift and log a corrected donation.",
    );
    ensure(
      input.kind !== "ACCESS_REVIEW" || input.status !== "SIGNED",
      "Use Sign off after reviewing the saved checklist.",
    );
    if (input.ownerId)
      ensure(
        await tx.membership.findFirst({
          where: {
            workspaceId,
            userId: input.ownerId,
            status: "ACTIVE",
            role: { in: ["ADMIN", "OWNER"] },
            user: { disabledAt: null },
          },
        }),
        "Choose an active admin as owner.",
      );
    if (input.fundId)
      ensure(
        await tx.financeFund.findFirst({
          where: {
            workspaceId,
            id: input.fundId,
            archivedAt: null,
            currency: input.currency,
          },
        }),
        "Choose a current finance fund with the same currency.",
      );
    if (input.contactId)
      ensure(
        await tx.contact.findFirst({
          where: { workspaceId, id: input.contactId, deletedAt: null },
        }),
        "Choose a contact in this workspace.",
      );
    if (input.organisationId)
      ensure(
        await tx.organisation.findFirst({
          where: { workspaceId, id: input.organisationId, deletedAt: null },
        }),
        "Choose an organisation in this workspace.",
      );
    const expectedParent = PARENTS[input.kind];
    ensure(
      !input.parentId || expectedParent,
      "This tool doesn't use a parent record.",
    );
    const parent =
      input.parentId && expectedParent
        ? await linked(tx, workspaceId, input.parentId, expectedParent)
        : null;
    if (expectedParent)
      ensure(parent, "Choose the linked record in this workspace.");
    if (input.kind === "INSTALMENT")
      ensure(
        parent?.currency === input.currency,
        "Use the grant's currency for its instalments.",
      );
    const details = detailSchemas[input.kind].parse(
      input.details,
    ) as Prisma.InputJsonObject;
    for (const [field, kind] of Object.entries({
      grantId: "GRANT",
      programmeId: "PROGRAMME",
      opportunityId: "OPPORTUNITY",
      campaignId: "CAMPAIGN",
      pledgeId: "PLEDGE",
      donationId: "DONATION",
    } as const)) {
      const value = details[field];
      if (typeof value !== "string" || !value) continue;
      const target = await linked(tx, workspaceId, value, kind);
      ensure(
        target && target.id !== old?.id,
        "Choose linked records in this workspace.",
      );
      if (field === "pledgeId")
        ensure(
          target.contactId === input.contactId &&
            target.currency === input.currency,
          "The pledge must match this donor and currency.",
        );
      if (field === "campaignId" && input.kind === "DONATION")
        ensure(
          target.currency === input.currency,
          "Use the campaign's currency for tagged donations.",
        );
    }
    if (input.kind === "TOOL_ACCOUNT") {
      ensure(
        await tx.membership.findFirst({
          where: { workspaceId, userId: String(details.userId) },
        }),
        "Choose a person in this workspace.",
      );
      if (details.serviceId)
        ensure(
          await tx.serviceCatalogItem.findFirst({
            where: { workspaceId, id: String(details.serviceId) },
          }),
          "Choose a catalogue item in this workspace.",
        );
      if (details.subscriptionId)
        ensure(
          await tx.subscription.findFirst({
            where: { workspaceId, id: String(details.subscriptionId) },
          }),
          "Choose a subscription in this workspace.",
        );
      ensure(
        details.serviceId || details.subscriptionId,
        "Link a catalogue item or subscription first.",
      );
    }
    let key: string | null = null;
    if (input.kind === "RECEIPT_SETTINGS") key = "settings";
    if (input.kind === "DONOR") key = input.contactId;
    if (input.kind === "FUNDER") key = input.organisationId;
    if (input.kind === "RUNWAY")
      key = `${input.dateOn.slice(0, 7)}:${input.currency}`;
    if (input.kind === "ACCESS_REVIEW")
      key = `${input.parentId}:${details.quarter}`;
    if (input.kind === "RUNWAY")
      ensure(
        input.dateOn.endsWith("-01"),
        "Use the first day of the forecast month.",
      );
    const data = {
      title: input.title,
      status: input.status,
      ownerId: input.ownerId || null,
      parentId: input.parentId || null,
      fundId: input.fundId || null,
      contactId: input.contactId || null,
      organisationId: input.organisationId || null,
      dateOn: input.dateOn ? new Date(input.dateOn) : null,
      dueOn: input.dueOn ? new Date(input.dueOn) : null,
      endsOn: input.endsOn ? new Date(input.endsOn) : null,
      amountMinor: input.amountMinor,
      currency: input.currency,
      notes: input.notes,
      reminderDays: input.reminderDays,
      details,
      key,
    };
    const row = old
      ? await tx.fundingRecord.update({
          where: { workspaceId_id: { workspaceId, id: old.id } },
          data,
        })
      : await tx.fundingRecord.create({
          data: {
            ...data,
            workspaceId,
            kind: input.kind,
            createdById: actor.user.id,
          },
        });
    await sync(actor, tx, row, old ? "updated" : "created");
    return { id: row.id };
  });
}
