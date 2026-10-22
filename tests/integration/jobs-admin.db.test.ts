import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const context = vi.hoisted(() => ({ userId: "", proof: "" }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => context.userId ? { user: { id: context.userId } } : null) }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => ({ value: context.proof }) })), headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: vi.fn(async () => false) }));
vi.mock("@/lib/frontend/cache", () => ({ revalidatePath: vi.fn() }));
import { prisma } from "@/lib/db";
import { createUser, createWorkspace, cleanup } from "../helpers/fixtures";
import { createSuperAdminMfaProof } from "@/lib/superAdminMfa";
import { manageJobsAction } from "@/app/actions/jobs";
import AdminJobsPage from "@/app/admin/jobs/page";
import { getQueues, closeQueues } from "@/lib/queue/client";

const suffix = randomUUID().slice(0, 8);
const slugs = [`queue-a-${suffix}`, `queue-b-${suffix}`];
const domain = `@jobs-${suffix}.test`;
let adminId: string;
let ownerA: string;
let ownerB: string;
describe.sequential("instance queue authorization", () => {
  beforeAll(async () => {
    vi.stubEnv("REDIS_URL", process.env.TEST_QUEUE_REDIS_URL || "redis://127.0.0.1:6395/0");
    vi.stubEnv("JOBS_QUEUE_PREFIX", `sww:test:admin:${suffix}`);
    vi.stubEnv("SUPER_ADMIN_EMAIL", `admin${domain}`);
    const admin = await createUser(`admin${domain}`); adminId = admin.id;
    ownerA = (await createUser(`owner-a${domain}`)).id;
    ownerB = (await createUser(`owner-b${domain}`)).id;
    await createWorkspace(slugs[0], ownerA); await createWorkspace(slugs[1], ownerB);
    await prisma.user.update({ where: { id: adminId }, data: { mfaEnabledAt: new Date() } });
  });
  afterAll(async () => {
    const queues = getQueues();
    for (const queue of Object.values(queues)) await queue.obliterate({ force: true });
    await closeQueues(queues);
    await prisma.auditEvent.deleteMany({ where: { actorId: adminId } });
    await cleanup(slugs, domain);
    await prisma.$disconnect(); vi.unstubAllEnvs();
  });
  it("denies unauthenticated page and actions", async () => {
    context.userId = ""; context.proof = "";
    await expect(AdminJobsPage()).rejects.toThrow("REDIRECT:/login");
    await expect(manageJobsAction({ queue: "outbox", operation: "pause" })).rejects.toThrow("REDIRECT:/login");
  });
  it("denies owners of either workspace access to instance jobs", async () => {
    for (const userId of [ownerA, ownerB]) {
      context.userId = userId; context.proof = createSuperAdminMfaProof(userId, 0);
      await expect(AdminJobsPage()).rejects.toThrow("NOT_FOUND");
      await expect(manageJobsAction({ queue: "outbox", operation: "pause" })).rejects.toThrow("NOT_FOUND");
    }
  });
  it("requires fresh MFA for the configured super-admin", async () => {
    context.userId = adminId;
    for (const proof of ["", createSuperAdminMfaProof(adminId, 0, Date.now() - 11 * 60_000), createSuperAdminMfaProof(ownerA, 0)]) {
      context.proof = proof;
      await expect(AdminJobsPage()).rejects.toThrow("REDIRECT:/admin-mfa");
      await expect(manageJobsAction({ queue: "outbox", operation: "pause" })).rejects.toThrow("REDIRECT:/admin-mfa");
    }
  });
  it("validates, pauses and resumes with audit after fresh MFA", async () => {
    context.userId = adminId; context.proof = createSuperAdminMfaProof(adminId, 0);
    expect((await manageJobsAction({ queue: "untrusted", operation: "pause" })).ok).toBe(false);
    expect((await manageJobsAction({ queue: "outbox", operation: "retry" })).ok).toBe(false);
    expect((await manageJobsAction({ queue: "outbox", operation: "pause" })).ok).toBe(true);
    expect(await getQueues().outbox.isPaused()).toBe(true);
    expect((await manageJobsAction({ queue: "outbox", operation: "resume" })).ok).toBe(true);
    expect(await getQueues().outbox.isPaused()).toBe(false);
    expect(await prisma.auditEvent.count({ where: { actorId: adminId, action: { startsWith: "admin.jobs_" } } })).toBe(2);
    await expect(AdminJobsPage()).resolves.toBeTruthy();
  });
});
