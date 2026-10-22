import { beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  getWorkspaceForAction,
  type WorkspaceContext,
} from "@/lib/permissions";
import {
  addMember,
  cleanup,
  createUser,
  createWorkspace,
  uniqueSuffix,
} from "../../helpers/fixtures";
import {
  generateSchedule,
} from "@/lib/finance/recurring/service";
import { lockFinance } from "@/lib/finance/tools/access";
import { deleteObjects } from "@/lib/storage";

const authState = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (authState.id ? { user: { id: authState.id } } : null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actionRateLimit", () => ({
  isActionRateLimited: async () => false,
}));
export const session = authState;
export const suffix = uniqueSuffix(),
  domain = `@recurring-${suffix}.test`,
  slug = `recurring-${suffix}`,
  foreignSlug = `recurring-other-${suffix}`;
export let owner: WorkspaceContext,
  manager: WorkspaceContext,
  person: WorkspaceContext,
  outsider: WorkspaceContext,
  guest: WorkspaceContext;
export let categoryId: string,
  accountId: string,
  profileId: string,
  foreignFund: string;
export const records = {} as {
  runId: string;
  advanceId: string;
  scheduleId: string;
  utilityBill: string;
  emiBill: string;
};
export const schedule = (extra: Record<string, unknown> = {}) => ({
  requestKey: randomUUID(),
  title: "Office rent",
  kind: "RENT",
  payee: "Landlord",
  amountMinor: 4500000,
  currency: "INR",
  frequency: "MONTHLY",
  dueDay: 1,
  startsOn: "2026-10-01",
  leadDays: 14,
  categoryId,
  accountId,
  ...extra,
});
export const pdf = () =>
  new File(["%PDF-1.4\nmanual proof"], "challan.pdf", {
    type: "application/pdf",
  });
export async function generate(id: string, day = "2026-10-21") {
  await prisma.$transaction(async (tx) => {
    await lockFinance(tx, owner.workspace.id);
    const s = await tx.recurringCostSchedule.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, id },
    });
    await generateSchedule(tx, s, new Date(day));
  });
}
export async function ctx(id: string, space = slug) {
  session.id = id;
  return (await getWorkspaceForAction(space))!;
}
beforeAll(async () => {
  const users = await Promise.all(
    ["owner", "manager", "person", "outsider", "guest"].map((n) =>
      createUser(`${n}${domain}`, n),
    ),
  );
  const ws = await createWorkspace(slug, users[0]!.id),
    other = await createWorkspace(foreignSlug, users[3]!.id);
  await addMember(ws.id, users[1]!.id, "ADMIN");
  await addMember(ws.id, users[2]!.id, "MEMBER");
  await addMember(ws.id, users[4]!.id, "GUEST");
  owner = await ctx(users[0]!.id);
  manager = await ctx(users[1]!.id);
  person = await ctx(users[2]!.id);
  guest = await ctx(users[4]!.id);
  outsider = await ctx(users[3]!.id, foreignSlug);
  for (const actor of [owner, manager])
    await prisma.financePayrollGrant.create({
      data: {
        workspaceId: ws.id,
        userId: actor.user.id,
        manage: true,
        grantedById: owner.user.id,
      },
    });
  categoryId = (
    await prisma.financeCategory.create({
      data: {
        workspaceId: ws.id,
        name: "Recurring office costs",
        kind: "EXPENSE",
      },
    })
  ).id;
  accountId = (
    await prisma.financeAccount.create({
      data: {
        workspaceId: ws.id,
        name: "Office bank",
        openingMinor: 50000000,
        openingOn: new Date("2026-01-01"),
      },
    })
  ).id;
  profileId = (
    await prisma.financePayProfile.create({
      data: {
        workspaceId: ws.id,
        name: "Staff member",
        userId: person.user.id,
        kind: "STAFF",
        rateMinor: 3000000,
      },
    })
  ).id;
  foreignFund = (
    await prisma.financeFund.create({
      data: { workspaceId: other.id, name: "Foreign fund" },
    })
  ).id;
}, 60000);
afterAll(async () => {
  const files = await prisma.fileObject.findMany({
    where: { workspace: { slug: { in: [slug, foreignSlug] } } },
    select: { storageKey: true },
  });
  await deleteObjects(files.map((f) => f.storageKey));
  await cleanup([slug, foreignSlug], domain);
  await prisma.$disconnect();
});
