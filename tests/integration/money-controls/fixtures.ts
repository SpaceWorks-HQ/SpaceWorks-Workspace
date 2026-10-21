import { beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { prisma } from "@/lib/db";
import { type ControlsActor } from "@/lib/moneyControls/access";
import { saveControl, transitionControl } from "@/lib/moneyControls/service";
import { uploadControlFiles } from "@/lib/moneyControls/files";
import { deleteObjects } from "@/lib/storage";
import {
  createUser,
  createWorkspace,
  addMember,
  cleanup,
  uniqueSuffix,
} from "../../helpers/fixtures";

const session = vi.hoisted(() => ({ id: "" }));
export { session };
vi.mock("@/lib/auth", () => ({
  auth: async () => (session.id ? { user: { id: session.id } } : null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actionRateLimit", () => ({
  isActionRateLimited: async () => false,
}));
export const suffix = uniqueSuffix(),
  emailSuffix = `@mc-${suffix}.test`,
  slugs = [`mc-${suffix}`, `mc-other-${suffix}`];
export let actor: ControlsActor,
  admin: ControlsActor,
  member: ControlsActor,
  guest: ControlsActor,
  other: ControlsActor,
  cash: string,
  bank: string,
  category: string,
  foreignAccount: string,
  asset: string;
export const on = "2026-06-10",
  date = new Date(on),
  keys: string[] = [];
export const save = (kind: string, extra: Record<string, unknown> = {}, as = actor) =>
  saveControl(as, {
    kind,
    title: `Office ${kind} ${randomUUID()}`,
    currency: "INR",
    occurredOn: on,
    details: {},
    ...extra,
  });
export const transition = (
  id: string,
  operation = "POST",
  extra: Record<string, unknown> = {},
  as = actor,
) =>
  transitionControl(as, {
    id,
    operation,
    occurredOn: on,
    reference: "Manual reference",
    operationKey: randomUUID(),
    ...extra,
  });
export async function attach(id: string, as = actor) {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const body = await pdf.save();
  const out = await uploadControlFiles(as, id, [
    new File([Buffer.from(body)], "office-proof.pdf", {
      type: "application/pdf",
    }),
  ]);
  for (const f of out) {
    const row = await prisma.fileObject.findUniqueOrThrow({
      where: { id: f.id },
    });
    keys.push(row.storageKey);
  }
  return out[0];
}
export async function fund(name: string, budget = 10000, details = {}) {
  const f = await prisma.financeFund.create({
    data: {
      workspaceId: actor.workspace.id,
      name: `${name}-${randomUUID()}`,
      currency: "INR",
      restricted: true,
    },
  });
  await save("FUND_RULE", {
    fundId: f.id,
    amountMinor: budget,
    occurredOn: "2026-04-01",
    endsOn: "2027-03-31",
    details: {
      allowedCategoryIds: [category],
      eligibilityMode: "BLOCK",
      budgetMode: "BLOCK",
      duplicateMode: "BLOCK",
      ...details,
    },
  });
  return f.id;
}
export const expense = (fundId: string, amountMinor: number, extra = {}) => ({
  kind: "EXPENSE",
  description: "Programme supplies",
  currency: "INR",
  occurredOn: on,
  amountMinor,
  fundId,
  categoryId: category,
  incomeSource: "OTHER",
  ...extra,
});
beforeAll(async () => {
  const owner = await createUser(`owner${emailSuffix}`),
    a = await createUser(`admin${emailSuffix}`),
    m = await createUser(`member${emailSuffix}`),
    g = await createUser(`guest${emailSuffix}`),
    o = await createUser(`other${emailSuffix}`);
  const ws = await createWorkspace(slugs[0], owner.id),
    foreign = await createWorkspace(slugs[1], o.id);
  await addMember(ws.id, a.id, "ADMIN");
  await addMember(ws.id, m.id);
  await addMember(ws.id, g.id, "GUEST");
  const ctx = (
    user: typeof owner,
    role: "OWNER" | "ADMIN" | "MEMBER" | "GUEST",
    workspace = ws,
  ): ControlsActor => ({ user, workspace, membership: { role } });
  actor = ctx(owner, "OWNER");
  admin = ctx(a, "ADMIN");
  member = ctx(m, "MEMBER");
  guest = ctx(g, "GUEST");
  other = ctx(o, "OWNER", foreign);
  cash = (
    await prisma.financeAccount.create({
      data: {
        workspaceId: ws.id,
        name: "Cash tin",
        openingOn: new Date("2026-04-01"),
        openingMinor: 500000,
        currency: "INR",
      },
    })
  ).id;
  bank = (
    await prisma.financeAccount.create({
      data: {
        workspaceId: ws.id,
        name: "Operating bank",
        openingOn: new Date("2026-04-01"),
        openingMinor: 5000000,
        currency: "INR",
      },
    })
  ).id;
  foreignAccount = (
    await prisma.financeAccount.create({
      data: {
        workspaceId: foreign.id,
        name: "Private account",
        openingOn: new Date("2026-04-01"),
        openingMinor: 100,
        currency: "INR",
      },
    })
  ).id;
  category = (
    await prisma.financeCategory.create({
      data: { workspaceId: ws.id, name: "Office supplies", kind: "EXPENSE" },
    })
  ).id;
  asset = (
    await prisma.asset.create({
      data: {
        workspaceId: ws.id,
        name: "Office laptop",
        category: "IT",
        tag: `it-${suffix}`,
      },
    })
  ).id;
  await save("FLOAT", {
    accountId: cash,
    ownerId: actor.user.id,
    amountMinor: 500000,
  });
});
afterAll(async () => {
  await deleteObjects(keys);
  await cleanup(slugs, emailSuffix);
});
