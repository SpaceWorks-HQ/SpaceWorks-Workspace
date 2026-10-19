import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";

// Request-only checks exercise Next's real RSC renderer without needing a
// browser process. A streamed rendering failure can otherwise have HTTP 200.
const prisma = new PrismaClient();
const suffix = randomUUID().slice(0, 8);
const slug = `finance-blog-qa-${suffix}`;
const email = `finance-blog-${suffix}@example.test`;
const password = `finance-blog-test-${suffix}`;
test.setTimeout(180_000);
let userId: string;
let workspaceId: string;
let draftId: string;
let invoiceId: string;

test.beforeAll(async () => {
  const user = await prisma.user.create({ data: { email, name: "Finance reviewer", emailVerified: new Date(), passwordHash: await bcrypt.hash(password, 12) } });
  userId = user.id;
  const workspace = await prisma.workspace.create({ data: { slug, name: "Finance review space", blogEnabled: true, memberships: { create: { userId, role: "OWNER" } } } });
  workspaceId = workspace.id;
  const draft = await prisma.blogPost.create({ data: { workspaceId, slug: "draft", title: "Private draft", contentHtml: "<p>Still writing.</p>" } });
  draftId = draft.id;
  await prisma.blogPost.create({ data: { workspaceId, slug: "published", title: "Public build notes", contentHtml: "<p>Shared workbench notes.</p>", status: "PUBLISHED", publishedAt: new Date("2026-01-01") } });
  await prisma.ledgerEntry.create({ data: { workspaceId, kind: "INCOME", amountMinor: 10000, currency: "INR", description: "Workshop contribution", occurredOn: new Date("2026-10-01") } });
  invoiceId = (await prisma.invoice.create({ data: { workspaceId, number: "INV-0001", clientName: "Workshop partner", currency: "INR", issuedOn: new Date("2026-10-01"), totalMinor: 10000, items: [{ description: "Workshop", quantity: 1, unitMinor: 10000 }] } })).id;
});

test.afterAll(async () => {
  if (workspaceId) await prisma.workspace.deleteMany({ where: { id: workspaceId, slug } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId, email } });
  await prisma.$disconnect();
});

test("finance and CMS pages render controls and records without streaming errors", async ({ request, baseURL }) => {
  // A development server compiles thirteen routes during this one check.
  test.slow();
  const { csrfToken } = await (await request.get("/api/auth/csrf")).json();
  const signedIn = await request.post("/api/auth/callback/credentials", { form: { csrfToken, email, password, callbackUrl: `${baseURL}/w/${slug}` }, maxRedirects: 0 });
  expect(signedIn.status()).toBe(302);
  expect((await (await request.get("/api/auth/session")).json()).user?.id).toBe(userId);
  const routes = [
    ["finance", "Money in and out"],
    ["finance/ledger", "Ledger entries"],
    ["finance/ledger?new=1", "Ledger entries"],
    ["finance/ledger/import", "Import"],
    ["finance/categories", "Categories"],
    ["finance/invoices", "Workshop partner"],
    ["finance/invoices/new", "Client name"],
    [`finance/invoices/${invoiceId}`, "Workshop partner"],
    [`finance/invoices/${invoiceId}/edit`, "Unit price"],
    [`finance/invoices/${invoiceId}/print`, "invoice-print"],
    ["blog", "Private draft"],
    [`blog/${draftId}`, "Search and sharing"],
    [`blog/${draftId}/preview`, "Still writing."],
  ];
  for (const [path, content] of routes) {
    const response = await request.get(`/w/${slug}/${path}`);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    expect(html, path).not.toMatch(/data-dgst=|Cannot read properties/);
    expect(html, path).toContain(content);
  }
});

test("public pages and feeds expose published content and sharing metadata", async ({ request }) => {
  const response = await request.get(`/blog/${slug}/published`);
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain("Shared workbench notes.");
  expect(html).toContain('property="og:type" content="article"');
  expect(html).toContain('name="twitter:card" content="summary_large_image"');
  expect(html).toContain('rel="canonical"');
  for (const path of ["", "/rss.xml", "/sitemap.xml"]) {
    const feed = await request.get(`/blog/${slug}${path}`);
    expect(feed.status()).toBe(200);
    const body = await feed.text();
    expect(body).toContain("published");
    expect(body).not.toContain("Private draft");
  }
});

test("drafts and unknown posts return 404", async ({ request }) => {
  for (const path of ["draft", "missing", "draft/cover"]) {
    expect((await request.get(`/blog/${slug}/${path}`)).status()).toBe(404);
  }
});

test("switching off the blog hides every public surface immediately", async ({ request }) => {
  await prisma.workspace.update({ where: { id: workspaceId }, data: { blogEnabled: false } });
  try {
    for (const path of ["", "/published", "/published/cover", "/rss.xml", "/sitemap.xml"]) {
      expect((await request.get(`/blog/${slug}${path}`)).status(), path).toBe(404);
    }
  } finally {
    await prisma.workspace.update({ where: { id: workspaceId }, data: { blogEnabled: true } });
  }
});
