import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  createWorkspace,
  createUser,
  addMember,
  cleanup,
  uniqueSuffix,
} from "../helpers/fixtures";
import {
  loadMetrics,
  drillRecords,
  listPresets,
  context,
  metricResult,
} from "@/lib/analytics/queries";
import { allowedDefinitions } from "@/lib/analytics/definitions";
import {
  savePreset,
  saveAdjustment,
  attachAdjustmentFiles,
} from "@/lib/analytics/service";
import { cashForecast, forecastDrill } from "@/lib/analytics/forecast";
import { financeReports, toolLists } from "@/lib/finance/tools/queries";
import { findDownloadableFile } from "@/lib/files";
import { canDownloadAnalyticsFile } from "@/lib/analytics/files";
import type { Actor } from "@/lib/analytics/access";
const suffix = uniqueSuffix(),
  domain = `@analytics-${suffix}.test`,
  slugs = [`ana-a-${suffix}`, `ana-b-${suffix}`];
let owner: Actor, member: Actor, guest: Actor, admin: Actor, outside: Actor;
let billId: string, presetId: string, adjustmentId: string;
const q = {
  period: "custom",
  from: "2026-10-01",
  to: "2026-10-21",
  currency: "INR",
};
async function result(actor: Actor, id: string, extra = {}) {
  const c = await context(actor, { ...q, ...extra }),
    d = allowedDefinitions(c.access).find((d) => d.id === id);
  if (!d) throw new Error("Unavailable");
  return metricResult(c.access, d, c.q, c.p);
}
describe.sequential("analytics live access and source consistency", () => {
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
    billId = bill.id;
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
  it("executes every registered SQL metric against PostgreSQL", async () => {
    await prisma.financePayrollGrant.create({
      data: {
        workspaceId: owner.workspace.id,
        userId: owner.user.id,
        manage: true,
        grantedById: owner.user.id,
      },
    });
    try {
      const c = await context(owner, q),
        errors: string[] = [];
      for (const d of allowedDefinitions(c.access)) {
        try {
          const m = await metricResult(c.access, d, c.q, c.p);
          expect(m.id).toBe(d.id);
        } catch (e) {
          errors.push(`${d.id}: ${String(e)}`);
        }
      }
      expect(errors).toEqual([]);
    } finally {
      await prisma.financePayrollGrant.deleteMany({
        where: { workspaceId: owner.workspace.id },
      });
    }
  }, 60000);
  it("matches Finance report income and expense totals, currency and payroll exclusions", async () => {
    const actor = {
        ...owner,
        user: { ...owner.user, name: null },
        workspace: await prisma.workspace.findUniqueOrThrow({
          where: { id: owner.workspace.id },
        }),
      },
      finance = await financeReports(actor, q);
    expect((await result(owner, "income")).value).toBe(
      finance.entries
        .filter((r) => r.kind === "INCOME")
        .reduce((n, r) => n + r.amountMinor, 0),
    );
    expect((await result(owner, "spending")).value).toBe(10000);
    expect((await result(member, "spending")).value).toBe(10000);
  });
  it("filters each drill-down by workspace and currency", async () => {
    const r = await drillRecords(owner, "income", q);
    expect(r.rows.map((r) => r.title)).toEqual(["Office support"]);
    expect(
      (await drillRecords(outside, "income", q)).rows.map((r) => r.title),
    ).toEqual(["Foreign tenant"]);
    expect((await result(owner, "income")).trend.map((p) => p.label)).toEqual([
      "2026-10-01",
    ]);
    expect(
      (await result(owner, "spending")).groups.find(
        (g) => g.label === "Prior rent",
      ),
    ).toMatchObject({ value: 0, previous: 15000, count: 0 });
    expect(
      (await drillRecords(owner, "spending", { ...q, group: "Prior rent" }))
        .rows,
    ).toEqual([]);
    expect((await result(owner, "payables")).value).toBe(2000);
    expect((await drillRecords(owner, "payables", q)).rows[0].id).toBe(billId);
  });
  it("gates confidential requests exactly like Help desk", async () => {
    expect((await result(owner, "help-volume")).count).toBe(1);
    expect((await result(admin, "help-volume")).count).toBe(2);
    expect((await result(member, "help-volume")).count).toBe(1);
    expect(
      (await drillRecords(owner, "help-volume", q)).rows.map((r) => r.title),
    ).toEqual(["Public request"]);
  });
  it("excludes inaccessible dimensions rather than treating them as global", async () => {
    expect(
      (
        await loadMetrics(member, {
          ...q,
          section: "home",
          fund: "not-this-workspace",
        })
      ).metrics.every((m) => m.count === 0),
    ).toBe(true);
  });
  it("requires live permissions, not caller-supplied roles", async () => {
    await expect(loadMetrics(guest, q)).rejects.toThrow();
    expect(
      (
        await loadMetrics(
          { ...member, membership: { role: "OWNER" } },
          { ...q, section: "funding" },
        )
      ).metrics,
    ).toEqual([]);
    await expect(drillRecords(owner, "payroll", q)).rejects.toThrow();
    await prisma.financePayrollGrant.create({
      data: {
        workspaceId: owner.workspace.id,
        userId: owner.user.id,
        manage: true,
        grantedById: owner.user.id,
      },
    });
    expect((await result(owner, "payroll")).count).toBe(0);
    const profile = await prisma.financePayProfile.create({
      data: {
        workspaceId: owner.workspace.id,
        name: "Private salary fixture",
        kind: "STAFF",
        rateMinor: 5000,
      },
    });
    await prisma.financePayRun.create({
      data: {
        workspaceId: owner.workspace.id,
        profileId: profile.id,
        month: "2026-10",
        currency: "INR",
        grossMinor: 5000,
        netMinor: 4500,
        tdsMinor: 500,
        status: "PAID",
        paidOn: new Date("2026-10-10"),
        createdById: owner.user.id,
      },
    });
    await prisma.financeBill.create({
      data: {
        workspaceId: owner.workspace.id,
        vendor: "Private statutory fixture",
        number: "TDS-1",
        issuedOn: new Date("2026-10-10"),
        dueOn: new Date("2026-11-07"),
        amountMinor: 500,
        currency: "INR",
        privatePayroll: true,
        createdById: owner.user.id,
      },
    });
    expect((await result(owner, "payroll")).value).toBe(4500);
    expect((await result(owner, "payroll-gross")).value).toBe(5000);
    expect((await result(owner, "payroll-deductions")).value).toBe(500);
    expect((await result(owner, "remittances")).value).toBe(500);

    await prisma.financePayrollGrant.deleteMany({
      where: { workspaceId: owner.workspace.id },
    });
  });
  it("saves presets privately and shares only with current admins", async () => {
    presetId = await savePreset(owner, {
      name: "October management",
      query: { ...q, section: "home" },
      shared: true,
      pinned: true,
      commentary: "Office cash is stable.",
    });
    expect((await listPresets(admin)).map((r) => r.id)).toContain(presetId);
    expect((await listPresets(member)).map((r) => r.id)).not.toContain(
      presetId,
    );
    expect(await listPresets(outside)).toEqual([]);
    await expect(
      savePreset(member, {
        name: "Forged shared report",
        query: q,
        shared: true,
      }),
    ).rejects.toThrow();
    await expect(
      savePreset(outside, { id: presetId, name: "Foreign edit", query: q }),
    ).rejects.toThrow();
  });
  it("keeps one-off adjustments separate from the ledger and forecasts opening cash once", async () => {
    const before = await prisma.ledgerEntry.count({
        where: { workspaceId: owner.workspace.id },
      }),
      date = new Date();
    date.setUTCDate(date.getUTCDate() + 2);
    adjustmentId = await saveAdjustment(owner, {
      title: "Printer replacement",
      dueOn: date.toISOString().slice(0, 10),
      amountMinor: -2500,
      currency: "INR",
    });
    const f = await cashForecast(
      owner,
      { currency: "INR" },
      new Date("2026-10-21T12:00:00Z"),
    );
    expect(f.openingMinor).toBe(120000);
    expect(
      f.lines.some((l) => l.id === billId && l.amountMinor === -2000),
    ).toBe(true);
    expect(f.weekly).toHaveLength(12);
    expect(f.monthly).toHaveLength(6);
    expect(
      await prisma.ledgerEntry.count({
        where: { workspaceId: owner.workspace.id },
      }),
    ).toBe(before);
    await expect(
      saveAdjustment(member, {
        title: "Unauthorized",
        dueOn: "2026-11-01",
        amountMinor: 100,
        currency: "INR",
      }),
    ).rejects.toThrow();
    await expect(
      saveAdjustment(owner, {
        title: "Foreign reference",
        dueOn: "2026-11-01",
        amountMinor: 100,
        currency: "INR",
        fundId: "foreign",
      }),
    ).rejects.toThrow();
  });
  it("uses all team memberships and hides private project facts", async () => {
    const ws = owner.workspace.id,
      one = await prisma.team.create({
        data: { workspaceId: ws, name: "Programmes", slug: "programmes" },
      }),
      two = await prisma.team.create({
        data: { workspaceId: ws, name: "Office", slug: "office" },
      }),
      hidden = await prisma.team.create({
        data: {
          workspaceId: ws,
          name: "Private planning",
          slug: "private",
          visibility: "PRIVATE",
        },
      });
    await prisma.teamMember.createMany({
      data: [
        { teamId: one.id, userId: member.user.id },
        { teamId: two.id, userId: member.user.id },
      ],
    });
    await prisma.memberProfile.create({
      data: {
        workspaceId: ws,
        userId: member.user.id,
        engagementStart: new Date("2026-10-01"),
      },
    });
    expect((await result(member, "headcount", { team: two.id })).count).toBe(1);
    const project = await prisma.project.create({
      data: {
        workspaceId: ws,
        key: "PRI",
        name: "Private project",
        teamId: hidden.id,
      },
    });
    await prisma.task.create({
      data: {
        workspaceId: ws,
        projectId: project.id,
        number: 91,
        title: "Private task",
        createdAt: new Date("2026-10-01"),
      },
    });
    expect((await result(member, "tasks-created")).count).toBe(0);
    expect((await result(owner, "tasks-created")).count).toBe(1);
    const centre = await prisma.financeCostCentre.create({
      data: {
        workspaceId: ws,
        name: "Private programme accounts",
        kind: "PROJECT",
        projectId: project.id,
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        workspaceId: ws,
        kind: "EXPENSE",
        amountMinor: 700,
        currency: "INR",
        description: "Office finance record",
        occurredOn: new Date("2026-10-10"),
        costCentreId: centre.id,
      },
    });
    const finance = await financeReports(
      {
        ...member,
        user: { ...member.user, name: null },
        workspace: await prisma.workspace.findUniqueOrThrow({
          where: { id: ws },
        }),
      },
      q,
    );
    expect((await result(member, "spending")).value).toBe(
      finance.entries
        .filter((e) => e.kind === "EXPENSE")
        .reduce((n, e) => n + e.amountMinor, 0),
    );
  });
  it("uses the canonical budget actuals including category-selection precedence", async () => {
    const ws = owner.workspace.id,
      category = await prisma.financeCategory.create({
        data: { workspaceId: ws, kind: "EXPENSE", name: "Repairs" },
      }),
      b = await prisma.budget.create({
        data: {
          workspaceId: ws,
          name: "Repairs budget",
          periodStart: new Date("2026-10-01"),
          periodEnd: new Date("2026-10-31"),
          amountMinor: 10000,
          currency: "INR",
          categories: [category.id],
        },
      });
    await prisma.ledgerEntry.createMany({
      data: [
        {
          workspaceId: ws,
          kind: "EXPENSE",
          amountMinor: 500,
          currency: "INR",
          description: "Repairs allocation",
          categoryId: category.id,
          occurredOn: new Date("2026-10-10"),
        },
        {
          workspaceId: ws,
          kind: "EXPENSE",
          amountMinor: 1000,
          currency: "INR",
          description: "Explicit tag outside selected category",
          budgetId: b.id,
          occurredOn: new Date("2026-10-10"),
        },
      ],
    });
    const m = await result(owner, "budgets"),
      finance = await financeReports(
        {
          ...owner,
          user: { ...owner.user, name: null },
          workspace: await prisma.workspace.findUniqueOrThrow({
            where: { id: ws },
          }),
        },
        q,
      );
    expect(m.groups.find((g) => g.label === b.name)?.value).toBe(5);
    expect(finance.budgets.find((r) => r.id === b.id)?.actualMinor).toBe(500);
  });
  it("matches the Attendance tool for legacy approved leave and cancellation", async () => {
    const { dayRange } = await import("@/lib/people/availability"),
      { attendanceData } = await import("@/lib/orgPeople/service"),
      ws = owner.workspace.id,
      range = dayRange("2026-10-12", "2026-10-12", owner.workspace.timezone);
    await prisma.attendanceEntry.create({
      data: {
        workspaceId: ws,
        userId: member.user.id,
        dateOn: new Date("2026-10-12"),
        status: "PRESENT",
        recordedById: owner.user.id,
      },
    });
    await prisma.availability.create({
      data: { workspaceId: ws, userId: member.user.id, type: "AWAY", ...range },
    });
    const request = await prisma.checklistRun.create({
      data: {
        workspaceId: ws,
        kind: "CUSTOM",
        title: "Approved leave",
        subjectUserId: member.user.id,
        status: "DONE",
        items: {
          create: {
            title: "Request",
            sourceType: "availability_request",
            descriptionMd: JSON.stringify({
              from: "2026-10-12",
              to: "2026-10-12",
              type: "AWAY",
              visibility: "PRIVATE",
            }),
          },
        },
      },
    });
    expect((await result(member, "attendance")).count).toBe(0);
    expect((await result(owner, "leave")).value).toBe(1);
    const source = await attendanceData(
      {
        ...member,
        user: { ...member.user, name: null },
        workspace: await prisma.workspace.findUniqueOrThrow({
          where: { id: ws },
        }),
      },
      "2026-10",
    );
    expect(
      source.cells.find(
        (c) => c.userId === member.user.id && c.date === "2026-10-12",
      )?.status,
    ).toBe("ON_LEAVE");
    await prisma.checklistRun.update({
      where: { id: request.id },
      data: { status: "CANCELLED" },
    });
    expect((await result(member, "attendance")).value).toBe(100);
    expect((await result(owner, "leave")).value).toBe(0);
  });
  it("derives donor retention from distinct adjacent-period cohorts without mixing currency", async () => {
    const ws = owner.workspace.id,
      donor = await prisma.contact.create({
        data: { workspaceId: ws, displayName: "Office supporter" },
      });
    for (const date of ["2026-09-20", "2026-10-10"])
      await prisma.fundingRecord.create({
        data: {
          workspaceId: ws,
          kind: "DONATION",
          title: "Office support gift",
          status: "RECEIVED",
          dateOn: new Date(date),
          contactId: donor.id,
          amountMinor: 1000,
          currency: "INR",
          details: { mode: "BANK" },
        },
      });
    const m = await result(owner, "retention");
    expect(m.value).toBe(100);
    expect(m.count).toBe(1);
    expect((await result(owner, "retention", { currency: "USD" })).count).toBe(
      0,
    );
  });
  it("generates an owner-only private report pack and rechecks downloads after revocation", async () => {
    const { generatePack, packData } = await import("@/lib/analytics/packs"),
      { getObject } = await import("@/lib/storage"),
      { PDFDocument } = await import("pdf-lib");
    const pack = await packData(owner, presetId, "management");
    expect(
      pack.metrics.some((m) => m.id === "payroll" || m.id === "safeguarding"),
    ).toBe(false);
    expect(pack.metrics.find((m) => m.id === "help-volume")?.count).toBe(1);
    const pdf = await generatePack(owner, presetId, "management"),
      file = await findDownloadableFile(pdf.fileId, owner.user.id);
    expect(file).not.toBeNull();
    expect(await findDownloadableFile(pdf.fileId, admin.user.id)).toBeNull();
    const object = await getObject(file!.storageKey),
      bytes = object!.body;
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThan(1);
    if (process.env.ANALYTICS_PDF_QA === "1") {
      const { writeFile } = await import("node:fs/promises");
      await writeFile("/tmp/analytics-management-report.pdf", bytes);
    }
    await expect(
      generatePack(member, presetId, "management"),
    ).rejects.toThrow();
  }, 60000);
  it("queues one monthly PDF per selected current admin and rechecks delivery permission", async () => {
    const { queueMonthlyReport, renderAnalyticsEmail } =
        await import("@/lib/analytics/email"),
      id = await savePreset(owner, {
        name: "Monthly email",
        query: {
          period: "last-month",
          currency: "INR",
          monthlyEmail: true,
          emailTo: [admin.user.id],
        },
        shared: true,
      }),
      month = new Date().toISOString().slice(0, 7);
    expect(await queueMonthlyReport(owner, id, month)).toBe(1);
    expect(await queueMonthlyReport(owner, id, month)).toBe(0);
    const jobs = await prisma.outboxMessage.findMany({
      where: {
        kind: "analytics.email",
        payload: { path: ["presetId"], equals: id },
      },
    });
    expect(jobs).toHaveLength(1);
    const rendered = await renderAnalyticsEmail(jobs[0].payload);
    expect(rendered.to).toBe(`admin${domain}`);
    expect(rendered.email.attachments?.[0].contentType).toBe("application/pdf");
    await prisma.membership.updateMany({
      where: { workspaceId: owner.workspace.id, userId: admin.user.id },
      data: { role: "MEMBER" },
    });
    await expect(renderAnalyticsEmail(jobs[0].payload)).rejects.toThrow();
    await prisma.membership.updateMany({
      where: { workspaceId: owner.workspace.id, userId: admin.user.id },
      data: { role: "ADMIN" },
    });
  }, 120000);
  it("deduplicates forecast reminders across concurrent worker ticks", async () => {
    const { run } = await import("@/lib/scheduled/analytics"),
      { localDate } = await import("@/lib/finance/dates"),
      date = new Date();
    const id = await saveAdjustment(owner, {
      title: "Review assumption",
      dueOn: localDate(date, owner.workspace.timezone),
      amountMinor: -100,
      currency: "INR",
    });
    await Promise.all([run(date), run(date)]);
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: owner.workspace.id,
          type: "analytics.assumption_due",
          dedupeKey: { contains: id },
        },
      }),
    ).toBe(1);
  });
  it("stores multiple proof files only through private storage and denies orphans", async () => {
    const { PDFDocument } = await import("pdf-lib"),
      pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = await pdf.save(),
      ids = await attachAdjustmentFiles(owner, adjustmentId, [
        new File([new Uint8Array(bytes)], "proof.pdf", {
          type: "application/pdf",
        }),
        new File([new Uint8Array(bytes)], "quote.pdf", {
          type: "application/pdf",
        }),
      ]);
    expect(ids).toHaveLength(2);
    expect(await findDownloadableFile(ids[0], owner.user.id)).not.toBeNull();
    expect(await findDownloadableFile(ids[0], member.user.id)).toBeNull();
    expect(await findDownloadableFile(ids[0], outside.user.id)).toBeNull();
    expect(
      await canDownloadAnalyticsFile(
        {
          id: "orphan",
          workspaceId: owner.workspace.id,
          folder: "/analytics/reports",
        },
        owner.user.id,
        "OWNER",
      ),
    ).toBe(false);
  });
  it("indexes adjustment titles with a live admin gate and keeps missing opening balances explicit", async () => {
    const { searchDocuments } = await import("@/lib/search/query"),
      search = (a: Actor) => ({
        workspaceId: a.workspace.id,
        userId: a.user.id,
        role: a.membership.role,
      });
    expect(
      (await searchDocuments(search(owner), "Printer replacement")).some(
        (r) => r.entityId === adjustmentId,
      ),
    ).toBe(true);
    expect(
      (await searchDocuments(search(member), "Printer replacement")).some(
        (r) => r.entityId === adjustmentId,
      ),
    ).toBe(false);
    const empty = await cashForecast(outside, { currency: "INR" });
    expect(empty.openingKnown).toBe(false);
    expect(empty.warnings.some((w) => w.includes("No finance accounts"))).toBe(
      true,
    );
  });
  it("revokes analytics immediately for suspension and archive state", async () => {
    await prisma.membership.updateMany({
      where: { workspaceId: owner.workspace.id, userId: member.user.id },
      data: { status: "SUSPENDED" },
    });
    await expect(loadMetrics(member, q)).rejects.toThrow();
    await prisma.membership.updateMany({
      where: { workspaceId: owner.workspace.id, userId: member.user.id },
      data: { status: "ACTIVE" },
    });
    await prisma.workspace.update({
      where: { id: owner.workspace.id },
      data: { archivedAt: new Date() },
    });
    await expect(loadMetrics(owner, q)).rejects.toThrow();
    await prisma.workspace.update({
      where: { id: owner.workspace.id },
      data: { archivedAt: null },
    });
  });
  it("uses the meeting source visibility for metrics, drill-downs and exported rows", async () => {
    const { meetingWhere } = await import("@/lib/meetings/service"),
      { csv } = await import("@/lib/analytics/metrics"),
      ws = owner.workspace.id,
      team = await prisma.team.create({
        data: { workspaceId: ws, name: "Public meeting team", slug: "meeting-public" },
      }),
      privateTeam = await prisma.team.create({
        data: { workspaceId: ws, name: "Private meeting team", slug: "meeting-private", visibility: "PRIVATE" },
      });
    const cases = [
      { title: "Workspace meeting", visibility: "WORKSPACE" as const },
      { title: "Team meeting secret", visibility: "TEAM" as const, teamId: team.id,
        facilitatorId: member.user.id, attendees: { create: { userId: member.user.id } } },
      { title: "Own team meeting", visibility: "TEAM" as const, teamId: team.id, createdById: member.user.id },
      { title: "Private meeting secret", visibility: "PRIVATE" as const,
        facilitatorId: member.user.id, attendees: { create: { userId: member.user.id } } },
      { title: "Own private meeting", visibility: "PRIVATE" as const, createdById: member.user.id },
      { title: "Private team workspace meeting", visibility: "WORKSPACE" as const, teamId: privateTeam.id },
    ];
    for (const data of cases)
      await prisma.meeting.create({ data: {
        workspaceId: ws, createdById: owner.user.id,
        startsAt: new Date("2026-10-10T10:00:00Z"),
        endsAt: new Date("2026-10-10T11:00:00Z"), ...data,
      } });
    const sourceActor = { ...member, user: { ...member.user, name: null },
      workspace: await prisma.workspace.findUniqueOrThrow({ where: { id: ws } }) };
    const visibleIds = async () => (await prisma.meeting.findMany({
      where: await meetingWhere(sourceActor), select: { id: true },
    })).map((m) => m.id).sort();
    const drill = await drillRecords(member, "meeting-load", q, 10000);
    expect(drill.rows.map((r) => r.id).sort()).toEqual(await visibleIds());
    expect(drill.rows.map((r) => r.title).sort()).toEqual([
      "Own private meeting", "Own team meeting", "Workspace meeting",
    ]);
    expect((await result(member, "meeting-load")).value).toBe(3);
    expect((await result(owner, "meeting-load")).count).toBe(cases.length);
    const exported = csv(drill.rows.map((r) => [r.title, r.date, r.value]));
    expect(exported).not.toContain("Team meeting secret");
    expect(exported).not.toContain("Private meeting secret");
    await prisma.teamMember.create({ data: { teamId: team.id, userId: member.user.id } });
    expect((await drillRecords(member, "meeting-load", q)).rows.map((r) => r.id).sort())
      .toEqual(await visibleIds());
    expect((await result(member, "meeting-load")).count).toBe(4);
    await prisma.teamMember.delete({ where: { teamId_userId: { teamId: team.id, userId: member.user.id } } });
    expect((await result(member, "meeting-load")).count).toBe(3);
  });
  it("counts only dated open overdue tasks", async () => {
    const ws = owner.workspace.id;
    for (const [index, dueAt, completedAt] of [
      [0, null, null],
      [1, new Date("2026-10-10"), null],
      [2, new Date("2026-11-01"), null],
      [3, new Date("2026-10-10"), new Date("2026-10-11")],
    ] as const)
      await prisma.task.create({ data: {
        workspaceId: ws, number: 200 + index, title: `Due-date regression ${index}`,
        createdAt: new Date("2026-10-01"), dueAt, completedAt,
      } });
    expect((await result(owner, "overdue-tasks")).count).toBe(1);
    expect((await drillRecords(owner, "overdue-tasks", q)).rows.map((r) => r.title))
      .toEqual(["Due-date regression 1"]);
  });
  it("includes issued balances before their due dates and ages them by due date", async () => {
    const common = { workspaceId: owner.workspace.id, currency: "EUR" };
    for (const [index, issuedOn, dueOn] of [
      [0, "2026-10-01", "2026-11-01"],
      [1, "2026-09-01", "2026-09-10"],
      [2, "2026-11-01", "2026-11-15"],
    ] as const) {
      const dates = { issuedOn: new Date(issuedOn), dueOn: new Date(dueOn) };
      await prisma.financeBill.create({ data: { ...common, ...dates,
        vendor: "Ageing fixture", number: `AGE-${index}`, amountMinor: 1200,
        createdById: owner.user.id,
      } });
      await prisma.invoice.create({ data: { ...common, ...dates,
        number: `AGE-${index}`, clientName: "Ageing fixture", totalMinor: 1200,
        status: "SENT", items: [],
      } });
      await prisma.businessDocument.create({ data: { ...common, ...dates,
        title: `Ageing fixture ${index}`, totalMinor: 1200, status: "ISSUED",
        type: "COMMERCIAL_INVOICE", ownerId: owner.user.id, input: {},
      } });
    }
    for (const metric of ["payables", "receivables", "document-receivables"]) {
      const m = await result(owner, metric, { currency: "EUR" });
      expect(m.value).toBe(2400);
      expect(m.groups.map((g) => [g.label, g.value])).toEqual([["0–30", 1200], ["31–60", 1200]]);
      const drill = await drillRecords(owner, metric, { ...q, currency: "EUR" });
      expect(drill.rows).toHaveLength(2);
      expect(drill.rows.map((r) => r.date).sort()).toEqual(["2026-09-10", "2026-11-01"]);
    }
  });
  it("uses the linked funding kind to select the BOM award denominator", async () => {
    for (const kind of ["GRANT", "OPPORTUNITY"] as const) {
      const award = await prisma.fundingRecord.create({ data: {
        workspaceId: owner.workspace.id, kind, title: `${kind} award`, status: "AWARDED",
        amountMinor: kind === "GRANT" ? 10000 : 0, details: { awardedMinor: 20000 },
      } });
      const estimate = await prisma.productRecord.create({ data: {
        workspaceId: owner.workspace.id, kind: "ESTIMATE", title: `${kind} BOM`,
        status: "DRAFT", fundingId: award.id, createdById: owner.user.id,
        createdAt: new Date("2026-10-01"),
      } });
      await prisma.productEstimateRevision.create({ data: {
        workspaceId: owner.workspace.id, recordId: estimate.id, version: 1,
        createdById: owner.user.id,
        snapshot: { details: { lines: [{ quantityMilli: 1000, unitCostMinor: 5000, gstBps: 0 }], contingencyBps: 0 } },
      } });
    }
    const m = await result(owner, "bom");
    expect(m.groups.find((g) => g.label === "GRANT BOM")).toMatchObject({ value: 50, base: 10000 });
    expect(m.groups.find((g) => g.label === "OPPORTUNITY BOM")).toMatchObject({ value: 25, base: 20000 });
  });
  it("matches month-end forecast drill rows to the chart bucket boundaries", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-30T12:00:00Z"));
    try {
      for (const date of ["2026-02-28", "2026-03-28", "2026-03-30", "2026-03-31"])
        await prisma.analyticsAdjustment.create({ data: {
          workspaceId: owner.workspace.id, title: `Month-end ${date}`, dueOn: new Date(date),
          amountMinor: -100, currency: "EUR", createdById: owner.user.id,
        } });
      const forecast = await cashForecast(owner, { currency: "EUR" }),
        drill = await forecastDrill(owner, { currency: "EUR", cadence: "month", bucket: forecast.monthly[1].label });
      expect(drill.period).toEqual({ from: "2026-02-28", to: "2026-03-30" });
      expect(drill.rows.map((r) => r.date).sort()).toEqual(["2026-02-28", "2026-03-28", "2026-03-30"]);
      expect(drill.rows.reduce((sum, r) => sum - r.value, 0)).toBe(forecast.monthly[1].expenseMinor);
    } finally { vi.useRealTimers(); }
  });
  it("sorts trend buckets chronologically across category order", async () => {
    await prisma.ledgerEntry.createMany({ data: [
      { workspaceId: owner.workspace.id, kind: "INCOME", amountMinor: 100, currency: "EUR",
        description: "Later first category", incomeSource: "A", occurredOn: new Date("2026-10-20") },
      { workspaceId: owner.workspace.id, kind: "INCOME", amountMinor: 200, currency: "EUR",
        description: "Earlier last category", incomeSource: "Z", occurredOn: new Date("2026-10-02") },
    ] });
    const m = await result(owner, "income", { currency: "EUR" });
    expect(m.trend.map((p) => [p.label, p.value])).toEqual([["2026-10-02", 200], ["2026-10-20", 100]]);
  });
  it("opens exact budget and fund records through their existing anchors", async () => {
    const ws = owner.workspace.id,
      fund = await prisma.financeFund.create({ data: {
        workspaceId: ws, name: "Linked grant fund", restricted: true, createdAt: new Date("2026-10-01"),
      } }),
      budget = await prisma.budget.findFirstOrThrow({ where: { workspaceId: ws } }),
      actor = { ...owner, user: { ...owner.user, name: null },
        workspace: await prisma.workspace.findUniqueOrThrow({ where: { id: ws } }) };
    await prisma.fundingRecord.create({ data: {
      workspaceId: ws, kind: "GRANT", title: "Linked grant", status: "ACTIVE", fundId: fund.id,
    } });
    await prisma.financeFund.create({ data: { workspaceId: ws, name: "Other fund" } });
    await prisma.budget.create({ data: {
      workspaceId: ws, name: "Other budget", amountMinor: 1000,
      periodStart: new Date("2026-10-01"), periodEnd: new Date("2026-10-31"),
    } });
    const budgets = await toolLists(actor, "budgets", { record: budget.id }),
      funds = await toolLists(actor, "funds", { record: fund.id });
    expect(budgets.budgets.map((r) => r.id)).toEqual([budget.id]);
    expect(funds.funds.map((r) => r.id)).toEqual([fund.id]);
    expect((await toolLists(actor, "budgets", {})).budgets.length).toBeGreaterThan(1);
    expect((await toolLists(actor, "funds", {})).funds.length).toBeGreaterThan(1);
    expect((await toolLists(actor, "funds", { record: "foreign-record" })).funds).toEqual([]);
    expect((await toolLists(actor, "budgets", { record: "foreign-record" })).budgets).toEqual([]);
    expect((await drillRecords(owner, "budgets", q)).rows.find((r) => r.id === budget.id)?.path)
      .toBe(`/w/${owner.workspace.slug}/finance/budgets?record=${budget.id}#${budget.id}`);
    expect((await drillRecords(owner, "grant-utilisation", q)).rows.find((r) => r.id === fund.id)?.path)
      .toBe(`/w/${owner.workspace.slug}/finance/funds?record=${fund.id}#${fund.id}`);
  });
  it("uses proposal outcome counts for donut slices while retaining the headline win rate", async () => {
    for (const [index, status] of ["WON", "DECLINED", "DECLINED", "SENT", "WITHDRAWN"].entries())
      await prisma.marketingItRecord.create({ data: {
        workspaceId: owner.workspace.id, kind: "PROPOSAL", title: `Win-rate fixture ${index}`,
        status, details: { sentOn: "2026-10-10" }, createdById: owner.user.id,
      } });
    const m = await result(owner, "win-rate");
    expect(m.value).toBeCloseTo(100 / 3);
    expect(m.groups.map((g) => [g.label, g.value])).toEqual([["DECLINED", 2], ["WON", 1]]);
    expect(m.trend[0].value).toBeCloseTo(100 / 3);
    expect(m.groups.reduce((sum, g) => sum + g.value, 0)).toBe(3);
  });

  it("keeps reporters' safety follow-ups admin-only in metrics, drills and CSV", async () => {
    const { getSafety } = await import("@/lib/opsGaps/safety"),
      { csv } = await import("@/lib/analytics/metrics"),
      ws = owner.workspace.id,
      report = await prisma.safetyReport.create({ data: {
        workspaceId: ws, reporterId: member.user.id, title: "Reported hazard",
        description: "Hazard", immediateAction: "Isolated", location: "Workshop",
        kind: "HAZARD", occurredAt: new Date("2026-10-10"), requestKey: "analytics-followup",
        actions: { create: { title: "Private handling action",
          assigneeId: owner.user.id, dueAt: new Date("2026-10-15") } },
      } }),
      sourceActor = { ...member, user: { ...member.user, name: null },
        workspace: await prisma.workspace.findUniqueOrThrow({ where: { id: ws } }) };
    expect((await getSafety(sourceActor, report.id))?.actions).toEqual([]);
    expect((await result(member, "safety")).count).toBeGreaterThan(0);
    expect((await loadMetrics(member, { ...q, section: "operations" })).metrics.some((m) => m.id === "safety-followups")).toBe(false);
    // CSV uses drillRecords too; both paths must reject before exposing rows.
    await expect(drillRecords(member, "safety-followups", q, 10000)).rejects.toThrow("unavailable");
    expect((await result(owner, "safety-followups")).count).toBe(1);
    const drill = await drillRecords(owner, "safety-followups", q);
    expect(csv(drill.rows.map((r) => [r.title, r.date, r.value]))).toContain("Private handling action");
  });

  it("forecasts approved unpaid disbursements using the payment workflow's approval identity", async () => {
    const ws = owner.workspace.id;
    for (const [i, status, approvalStatus, subjectType, mismatched] of [
      [0, "PENDING", "APPROVED", "CUSTOM", false],
      [1, "PENDING", "PENDING", "CUSTOM", false],
      [2, "PENDING", "REJECTED", "CUSTOM", false],
      [3, "PAID", "APPROVED", "CUSTOM", false],
      [4, "DRAFT", "APPROVED", "CUSTOM", true],
      [5, "PENDING", "APPROVED", "PURCHASE_REQUEST", false],
    ] as const) {
      const row = await prisma.financeDisbursement.create({ data: {
        workspaceId: ws, payee: `Forecast payout ${i}`, purpose: "Regression",
        kind: "VENDOR", amountMinor: 1000, currency: "GBP", status,
        dueOn: new Date("2026-10-25"), createdById: owner.user.id,
      } });
      const approval = await prisma.approvalRequest.create({ data: {
        workspaceId: ws, subjectType, subjectId: mismatched ? "different-payout" : row.id,
        title: "Approve payout", requesterId: owner.user.id, steps: [], status: approvalStatus,
      } });
      await prisma.financeDisbursement.update({ where: { id: row.id }, data: { approvalId: approval.id } });
    }
    const forecast = await cashForecast(owner, { currency: "GBP" }, new Date("2026-10-21T12:00:00Z"));
    expect(forecast.lines.filter((l) => l.source === "Approved disbursement").map((l) => [l.title, l.amountMinor]))
      .toEqual([["Forecast payout 0", -1000]]);
  });

  it("matches Product Ops visibility after a project is archived", async () => {
    const { visibleWhere } = await import("@/lib/productOps/access"),
      ws = owner.workspace.id,
      project = await prisma.project.create({ data: { workspaceId: ws, key: "ARCHIVEDPRODUCT", name: "Archived product", status: "ARCHIVED" } });
    const record = await prisma.productRecord.create({ data: {
      workspaceId: ws, kind: "RELEASE", title: "Archived project release", status: "SHIPPED",
      projectId: project.id, createdById: owner.user.id, shippedAt: new Date("2026-10-10"),
    } });
    for (const actor of [owner, member]) {
      expect(await prisma.productRecord.findFirst({ where: { AND: [await visibleWhere(actor), { id: record.id }] } })).toBeNull();
      expect((await drillRecords(actor, "releases", q)).rows.some((r) => r.id === record.id)).toBe(false);
    }
    await prisma.project.update({ where: { id: project.id }, data: { status: "ACTIVE" } });
    expect((await drillRecords(member, "releases", q)).rows.some((r) => r.id === record.id)).toBe(true);
  });

  it("carries the monetary ratio basis from the definition into the drill payload", async () => {
    expect(await drillRecords(owner, "budgets", q)).toMatchObject({ unit: "percent", basisUnit: "money" });
    expect(await drillRecords(member, "attendance", q)).toMatchObject({ unit: "percent", basisUnit: "count" });
  });

  it("hides certification expiry when its holder is no longer an active member", async () => {
    const { certifications } = await import("@/lib/people/certifications"),
      holder = await createUser(`cert-holder${domain}`),
      ws = owner.workspace.id,
      type = await prisma.certType.create({ data: { workspaceId: ws, name: "Analytics sign-off" } }),
      cert = await prisma.certification.create({ data: {
        certTypeId: type.id, userId: holder.id, expiresAt: new Date("2026-10-15"),
      } }),
      actor = { ...owner, user: { ...owner.user, name: null },
        workspace: await prisma.workspace.findUniqueOrThrow({ where: { id: ws } }) };
    await addMember(ws, holder.id, "MEMBER");
    expect((await drillRecords(owner, "certifications", q)).rows.some((r) => r.id === cert.id)).toBe(true);
    await prisma.membership.updateMany({ where: { workspaceId: ws, userId: holder.id }, data: { status: "SUSPENDED" } });
    expect(await certifications(actor, holder.id)).toEqual([]);
    expect((await drillRecords(owner, "certifications", q)).rows.some((r) => r.id === cert.id)).toBe(false);
    await prisma.membership.deleteMany({ where: { workspaceId: ws, userId: holder.id } });
    expect((await drillRecords(owner, "certifications", q)).rows.some((r) => r.id === cert.id)).toBe(false);
  });

});
