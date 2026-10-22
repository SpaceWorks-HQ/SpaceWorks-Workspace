import { beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import {
  createWorkspace,
  createUser,
  addMember,
  cleanup,
  uniqueSuffix,
} from "../../helpers/fixtures";
import { context, metricResult } from "@/lib/analytics/queries";
import { allowedDefinitions } from "@/lib/analytics/definitions";
import { type Actor } from "@/lib/analytics/access";

const suffix = uniqueSuffix(),
  domain = `@analytics-${suffix}.test`,
  slugs = [`ana-a-${suffix}`, `ana-b-${suffix}`];
export let owner: Actor, member: Actor, guest: Actor, admin: Actor, outside: Actor;
export const records = {} as {
  billId: string;
  presetId: string;
  adjustmentId: string;
};
export const q = {
  period: "custom",
  from: "2026-10-01",
  to: "2026-10-21",
  currency: "INR",
};
export async function result(actor: Actor, id: string, extra = {}) {
  const c = await context(actor, { ...q, ...extra }),
    d = allowedDefinitions(c.access).find((d) => d.id === id);
  if (!d) throw new Error("Unavailable");
  return metricResult(c.access, d, c.q, c.p);
}
export { domain };

export function registerAnalyticsFixtures() {
  beforeAll(async () => {
    const users = await Promise.all(
        ["owner", "member", "guest", "admin", "outside"].map((n) =>
          createUser(`${n}${domain}`, n),
        ),
      ),
      a = await createWorkspace(slugs[0], users[0].id),
      b = await createWorkspace(slugs[1], users[4].id);
    await addMember(a.id, users[1].id, "MEMBER");
    await addMember(a.id, users[2].id, "GUEST");
    await addMember(a.id, users[3].id, "ADMIN");
    [owner, member, guest, admin, outside] = users.map((u, i) => ({
      user: u,
      workspace: i === 4 ? b : a,
      membership: {
        role: (["OWNER", "MEMBER", "GUEST", "ADMIN", "OWNER"] as const)[i],
      },
    }));
    await prisma.workspace.update({
      where: { id: a.id },
      data: { financeVisibleToMembers: true },
    });
    const account = await prisma.financeAccount.create({
      data: {
        workspaceId: a.id,
        name: "Office bank",
        currency: "INR",
        openingMinor: 100000,
        openingOn: new Date("2026-01-01"),
      },
    });
    await prisma.ledgerEntry.createMany({
      data: [
        {
          workspaceId: a.id,
          kind: "INCOME",
          amountMinor: 50000,
          currency: "INR",
          description: "Office support",
          occurredOn: new Date("2026-10-01"),
          accountId: account.id,
        },
        {
          workspaceId: a.id,
          kind: "EXPENSE",
          amountMinor: 10000,
          currency: "INR",
          description: "Supplies",
          occurredOn: new Date("2026-10-05"),
          accountId: account.id,
        },
        {
          workspaceId: a.id,
          kind: "EXPENSE",
          amountMinor: 20000,
          currency: "INR",
          description: "Private pay",
          occurredOn: new Date("2026-10-05"),
          privatePayroll: true,
          accountId: account.id,
        },
        {
          workspaceId: a.id,
          kind: "EXPENSE",
          amountMinor: 999,
          currency: "USD",
          description: "Other currency",
          occurredOn: new Date("2026-10-05"),
        },
        {
          workspaceId: b.id,
          kind: "INCOME",
          amountMinor: 999999,
          currency: "INR",
          description: "Foreign tenant",
          occurredOn: new Date("2026-10-01"),
        },
      ],
    });
    const priorCategory = await prisma.financeCategory.create({
      data: { workspaceId: a.id, kind: "EXPENSE", name: "Prior rent" },
    });
    await prisma.ledgerEntry.create({
      data: {
        workspaceId: a.id,
        kind: "EXPENSE",
        categoryId: priorCategory.id,
        amountMinor: 15000,
        currency: "INR",
        description: "Prior-period rent",
        occurredOn: new Date("2026-09-20"),
      },
    });
    const bill = await prisma.financeBill.create({
      data: {
        workspaceId: a.id,
        vendor: "Paper supplier",
        number: "B-1",
        issuedOn: new Date("2026-10-01"),
        dueOn: new Date("2026-10-18"),
        amountMinor: 3000,
        paidMinor: 1000,
        currency: "INR",
        createdById: users[0].id,
      },
    });
    records.billId = bill.id;
    await prisma.helpTicket.createMany({
      data: [
        {
          workspaceId: a.id,
          number: 1,
          requesterId: member.user.id,
          title: "Private request",
          description: "Private",
          category: "Confidential",
          priority: "NORMAL",
          slaDueAt: new Date("2026-10-10"),
          confidential: true,
          handlerIds: [admin.user.id],
          requestKey: "one",
          createdAt: new Date("2026-10-01"),
        },
        {
          workspaceId: a.id,
          number: 2,
          requesterId: admin.user.id,
          title: "Public request",
          description: "Public",
          category: "IT",
          priority: "NORMAL",
          slaDueAt: new Date("2026-10-10"),
          confidential: false,
          requestKey: "two",
          createdAt: new Date("2026-10-01"),
        },
      ],
    });
  });
  afterAll(async () => cleanup(slugs, domain));
}
