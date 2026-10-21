import { afterAll, beforeAll, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { getWorkspaceForAction } from "@/lib/permissions";
import type { WorkspaceContext } from "@/lib/permissions";
import { saveFund, saveCentre } from "@/lib/finance/tools/service";
import { addAccount } from "@/lib/finance/tools/close";
import { deleteObjects } from "@/lib/storage";
import {
  addMember,
  cleanup,
  createUser,
  createWorkspace,
  uniqueSuffix,
} from "../../helpers/fixtures";

export const records = {} as {
  payRunId: string;
};
const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (session.id ? { user: { id: session.id } } : null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actionRateLimit", () => ({
  isActionRateLimited: async () => false,
}));
const ai = vi.hoisted(() => ({ configured: false, called: 0 }));
export { session, ai };
vi.mock("@/lib/assistant/client", () => ({
  getAssistantConfig: async () =>
    ai.configured
      ? { apiKey: "fake", model: "configured-model", jobModel: "unused" }
      : null,
  createAnthropicClient: () => ({
    beta: {
      messages: {
        create: async (input: Record<string, unknown>) => {
          expect(input.model).toBe("configured-model");
          ai.called++;
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  vendor: "Receipt supplier",
                  date: "2026-06-10",
                  invoiceNumber: "R-10",
                  gstin: null,
                  taxableValue: "100",
                  cgst: "9",
                  sgst: "9",
                  igst: "0",
                  total: "118",
                  suggestedCategory: "Office materials",
                }),
              },
            ],
          };
        },
      },
    },
  }),
  messageText: (m: { content: Array<{ text: string }> }) =>
    m.content.map((v) => v.text).join(""),
  modelOptions: () => ({}),
}));
export const suffix = uniqueSuffix(),
  domain = `@finance-tools-${suffix}.test`,
  slugs = [`ft-${suffix}`, `ft-other-${suffix}`];
export let owner: WorkspaceContext,
  admin: WorkspaceContext,
  member: WorkspaceContext,
  guest: WorkspaceContext,
  foreign: WorkspaceContext;
export let categoryId: string,
  foreignCategoryId: string,
  fundId: string,
  centreId: string,
  accountId: string;
export const entry = (extra: Record<string, unknown> = {}) => ({
  kind: "EXPENSE",
  amountMinor: 10000,
  currency: "INR",
  occurredOn: "2026-06-10",
  description: "Office materials",
  categoryId,
  accountId,
  fundId,
  costCentreId: centreId,
  ...extra,
});
export const bill = (extra: Record<string, unknown> = {}) => ({
  vendor: "Paper cooperative",
  number: `B-${randomUUID()}`,
  issuedOn: "2026-06-01",
  dueOn: "2026-06-08",
  amountMinor: 30000,
  currency: "INR",
  categoryId,
  accountId,
  fundId,
  costCentreId: centreId,
  ...extra,
});
export const receipt = () =>
  new File(["%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF"], "office-receipt.pdf", {
    type: "application/pdf",
  });
export async function actor(slug: string, id: string) {
  session.id = id;
  return (await getWorkspaceForAction(slug))!;
}
beforeAll(async () => {
  const [o, a, m, g] = await Promise.all(
    ["owner", "admin", "member", "guest"].map((n) =>
      createUser(`${n}${domain}`, n),
    ),
  );
  const w = await createWorkspace(slugs[0]!, o!.id);
  await createWorkspace(slugs[1]!, o!.id);
  await addMember(w.id, a!.id, "ADMIN");
  await addMember(w.id, m!.id);
  await addMember(w.id, g!.id, "GUEST");
  owner = await actor(slugs[0]!, o!.id);
  admin = await actor(slugs[0]!, a!.id);
  member = await actor(slugs[0]!, m!.id);
  guest = await actor(slugs[0]!, g!.id);
  foreign = await actor(slugs[1]!, o!.id);
  categoryId = (
    await prisma.financeCategory.create({
      data: { workspaceId: w.id, name: "Office materials", kind: "EXPENSE" },
    })
  ).id;
  foreignCategoryId = (
    await prisma.financeCategory.create({
      data: {
        workspaceId: foreign.workspace.id,
        name: "Private category",
        kind: "EXPENSE",
      },
    })
  ).id;
  fundId = await saveFund(owner, {
    name: "Restricted education grant",
    restricted: true,
    currency: "INR",
    funder: "Local foundation",
  });
  centreId = await saveCentre(owner, {
    name: "Office programme",
    kind: "PROGRAMME",
  });
  accountId = await addAccount(owner, {
    name: "Office bank",
    currency: "INR",
    openingMinor: 50000,
    openingOn: "2026-01-01",
  });
}, 60000);
afterAll(async () => {
  const files = await prisma.fileObject.findMany({
    where: { workspace: { slug: { in: slugs } } },
    select: { storageKey: true },
  });
  await deleteObjects(files.map((f) => f.storageKey));
  await cleanup(slugs, domain);
  await prisma.$disconnect();
});
