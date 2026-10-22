import { beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { saveReference } from "@/lib/documents/service";
import type { DocumentsActor } from "@/lib/documents/access";
import { draftSchema } from "@/lib/documents/rules";
import { deleteObjects } from "@/lib/storage";

export const records = {} as {
  invoiceId: string;
  receiptId: string;
  issuedFileId: string;
};
vi.mock("@/lib/auth", () => ({ auth: async () => null }));
export const suffix = randomUUID().slice(0, 8);
export let actor: DocumentsActor,
  other: DocumentsActor,
  member: DocumentsActor,
  signatoryId: string,
  registrationId: string;
export let workspaceIds: string[] = [],
  userIds: string[] = [];
export const draft = (extra: Record<string, unknown> = {}) =>
  draftSchema.parse({
    type: "TAX_INVOICE",
    title: "Programme support",
    issuedOn: "2026-10-01",
    dueOn: "2026-10-15",
    currency: "INR",
    partyName: "Community Foundation",
    partyAddress: "Kochi, Kerala",
    placeOfSupply: "32",
    placeRule: "Ordinary domestic services",
    supplyOn: "2026-10-01",
    registrationId,
    signatoryId,
    reviewed: true,
    lines: [
      {
        description: "Programme support",
        quantity: "1",
        unitMinor: 1000000,
        discountMinor: 0,
        hsn: "998599",
        unit: "NOS",
        rateBps: 1800,
      },
    ],
    ...extra,
  });
beforeAll(async () => {
  const u = await prisma.user.create({
      data: {
        email: `documents-${suffix}@example.org`,
        name: "Documents operator",
      },
    }),
    m = await prisma.user.create({
      data: { email: `documents-member-${suffix}@example.org`, name: "Member" },
    });
  userIds = [u.id, m.id];
  const w = await prisma.workspace.create({
      data: {
        slug: `documents-${suffix}`,
        name: "Community Office",
        financeVisibleToMembers: true,
      },
    }),
    w2 = await prisma.workspace.create({
      data: { slug: `documents-other-${suffix}`, name: "Other office" },
    });
  workspaceIds = [w.id, w2.id];
  await prisma.membership.createMany({
    data: [
      { workspaceId: w.id, userId: u.id, role: "OWNER" },
      { workspaceId: w2.id, userId: u.id, role: "OWNER" },
      { workspaceId: w.id, userId: m.id, role: "MEMBER" },
    ],
  });
  actor = {
    workspace: w,
    user: { id: u.id, name: u.name },
    membership: { role: "OWNER" },
  };
  other = { ...actor, workspace: w2 };
  member = {
    workspace: w,
    user: { id: m.id, name: m.name },
    membership: { role: "OWNER" },
  };
  await prisma.governanceRecord.create({
    data: {
      workspaceId: w.id,
      kind: "LEGAL_ENTITY",
      title: "Community Office Society",
      details: {
        address: "Kochi, Kerala, India",
        pan: "ABCDE1234F",
        registration: "DEMO-SOCIETY",
      },
    },
  });
  signatoryId = await saveReference(actor, "SIGNATORY", "Secretary", {
    name: "Anita",
    designation: "Secretary",
    validFrom: "2026-04-01",
    validTo: "2027-03-31",
    signatureFileId: "",
  });
  registrationId = await saveReference(actor, "REGISTRATION", "Kerala GST", {
    kind: "GST",
    identifier: "32ABCDE1234F1Z5",
    state: "32",
    address: "Kochi",
    validFrom: "2026-04-01",
    validTo: "2027-03-31",
    reviewed: true,
  });
}, 60000);
afterAll(async () => {
  const files = await prisma.fileObject.findMany({
    where: { workspaceId: { in: workspaceIds } },
    select: { storageKey: true },
  });
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await deleteObjects(files.map((f) => f.storageKey));
  await prisma.outboxMessage.deleteMany({
    where: { payload: { path: ["workspaceId"], equals: workspaceIds[0] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}, 60000);
