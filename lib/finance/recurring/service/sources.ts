import "server-only";
import { prisma } from "@/lib/db";
import {
  financeAccess,
  FinanceError,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import { localDate } from "@/lib/finance/dates";
import { saveSchedule } from "./schedules";

/** Source shortcuts copy editable facts once; later changes never rewrite already issued dues. */
export async function scheduleFromSource(
  actor: FinanceActor,
  source: "LEASE" | "INSURANCE" | "SUBSCRIPTION",
  sourceId: string,
) {
  await financeAccess(actor, "MANAGE");
  const workspaceId = actor.workspace.id;
  const base = {
    requestKey: `${source}:${sourceId}`,
    kind: "OTHER",
    frequency: "MONTHLY",
    dueDay: 1,
    startsOn: localDate(new Date(), actor.workspace.timezone),
    currency: actor.workspace.currency,
    title: "",
    payee: "",
    amountMinor: 0,
  };
  if (source === "LEASE") {
    const lease = await prisma.facilityLease.findFirst({
      where: { workspaceId, id: sourceId, status: "ACTIVE" },
    });
    if (!lease) throw new FinanceError("Choose an active lease.");
    const contact = await prisma.contact.findFirst({
      where: { workspaceId, id: lease.landlordContactId, deletedAt: null },
    });
    if (!contact) throw new FinanceError("Review the landlord contact first.");
    return saveSchedule(actor, {
      ...base,
      kind: "RENT",
      leaseId: lease.id,
      title: lease.title,
      payee: contact.displayName,
      contactId: contact.id,
      amountMinor: lease.rentMinor,
      currency: lease.currency,
      ownerId: lease.ownerId,
      renewalOn: lease.renewalOn.toISOString().slice(0, 10),
      tdsSection: "194-I",
      notes:
        "Review the due day, tax applicability and renewal escalation before the first bill.",
    });
  }
  if (source === "SUBSCRIPTION") {
    const s = await prisma.subscription.findFirst({
      where: { workspaceId, id: sourceId, status: "ACTIVE" },
    });
    if (
      !s?.amountMinor ||
      !["MONTHLY", "QUARTERLY", "YEARLY"].includes(s.period)
    )
      throw new FinanceError(
        "Set a fixed monthly, quarterly or yearly subscription amount first.",
      );
    const date = s.nextRenewalAt ?? new Date();
    return saveSchedule(actor, {
      ...base,
      kind: "SOFTWARE",
      subscriptionId: s.id,
      title: s.name,
      payee: s.name,
      organisationId: s.vendorOrgId,
      amountMinor: s.amountMinor,
      currency: s.currency,
      frequency: s.period,
      startsOn: date.toISOString().slice(0, 10),
      dueDay: date.getUTCDate(),
    });
  }
  const r = await prisma.governanceRecord.findFirst({
    where: { workspaceId, id: sourceId, kind: "INSURANCE", archivedAt: null },
  });
  if (!r) throw new FinanceError("Choose an insurance register entry.");
  const d = r.details as Record<string, unknown>;
  const date = r.dueOn ?? r.endsOn ?? new Date();
  return saveSchedule(actor, {
    ...base,
    kind: "INSURANCE",
    insuranceId: r.id,
    title: r.title,
    payee: String(d.issuer || r.title),
    amountMinor: Number(d.premiumMinor || 0),
    currency: String(d.currency || actor.workspace.currency),
    frequency: String(d.premiumFrequency || "YEARLY"),
    startsOn: date.toISOString().slice(0, 10),
    dueDay: date.getUTCDate(),
    ownerId: r.ownerId,
  });
}
