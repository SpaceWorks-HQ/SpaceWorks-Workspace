import "server-only";
import { prisma } from "@/lib/db";
import { type DocumentsActor } from "../access";
import { getSettings, object } from "../service";
import type { EditorOptions } from "../types";
export async function editorOptions(
  actor: DocumentsActor,
): Promise<EditorOptions> {
  const settings = await getSettings(actor);
  const workspaceId = actor.workspace.id;
  const [
    contacts,
    organisations,
    people,
    originals,
    funds,
    invoices,
    ledger,
    contracts,
    funding,
  ] = await Promise.all([
    prisma.contact.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, displayName: true, emails: true },
      orderBy: { displayName: "asc" },
      take: 300,
    }),
    prisma.organisation.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, name: true, address: true },
      orderBy: { name: "asc" },
      take: 300,
    }),
    prisma.memberProfile.findMany({
      where: { workspaceId },
      include: { user: { select: { name: true } } },
      take: 300,
    }),
    prisma.businessDocument.findMany({
      where: {
        workspaceId,
        status: { in: ["ISSUED", "CANCELLED"] },
        OR: [{ sourceType: null }, { sourceType: { not: "PAY_RUN" } }],
      },
      select: { id: true, number: true, type: true, status: true },
      take: 300,
    }),
    prisma.financeFund.findMany({
      where: { workspaceId, archivedAt: null },
      select: { id: true, name: true },
      take: 300,
    }),
    prisma.invoice.findMany({
      where: { workspaceId },
      select: { id: true, number: true, clientName: true },
      take: 300,
    }),
    prisma.ledgerEntry.findMany({
      where: { workspaceId, privatePayroll: false, voidedAt: null },
      select: { id: true, description: true, amountMinor: true },
      take: 300,
    }),
    prisma.governanceRecord.findMany({
      where: { workspaceId, kind: "CONTRACT", archivedAt: null },
      select: { id: true, title: true },
      take: 300,
    }),
    prisma.fundingRecord.findMany({
      where: {
        workspaceId,
        archivedAt: null,
        OR: [{ kind: "DONATION", status: "RECEIVED" }, { kind: "GRANT" }],
      },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
  ]);
  return {
    country: settings.profile.country,
    funding: funding.map((f) => ({ id: f.id, name: f.title })),
    references: settings.references.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      data: object(r.data),
    })),
    contacts: contacts.map((c) => ({ id: c.id, name: c.displayName })),
    organisations: organisations.map((o) => ({
      id: o.id,
      name: o.name,
      address: o.address,
    })),
    people: people.map((p) => ({
      id: p.userId,
      name: p.user.name ?? "Former member",
      start: p.engagementStart?.toISOString().slice(0, 10) ?? "",
      end: p.engagementEnd?.toISOString().slice(0, 10) ?? "",
    })),
    originals: originals.map((o) => ({
      id: o.id,
      type: o.type,
      status: o.status,
      name: `${o.number} · ${o.type}`,
    })),
    funds,
    invoices: invoices.map((i) => ({
      id: i.id,
      name: `${i.number} · ${i.clientName}`,
    })),
    ledger: ledger.map((e) => ({ id: e.id, name: e.description })),
    contracts: contracts.map((c) => ({ id: c.id, name: c.title })),
  };
}
