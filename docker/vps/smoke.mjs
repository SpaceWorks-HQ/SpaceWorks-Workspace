// Disposable deployment test only. Production operators use check.mjs.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

await import("./check.mjs");
const prisma = new PrismaClient();
const plainUrl = new URL(process.env.DATABASE_URL);
plainUrl.searchParams.set("sslmode", "disable");
const plain = new PrismaClient({ datasources: { db: { url: plainUrl.toString() } } });
const s3 = new S3Client({ region: process.env.S3_REGION, endpoint: process.env.S3_ENDPOINT, forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } });
const objectKey = `deployment-smoke/${randomUUID()}`;
try {
  let rejected = false;
  try { await plain.$queryRaw`SELECT 1`; } catch { rejected = true; }
  assert.ok(rejected, "Plain-text database connections must fail");
  const anonymous = await fetch(`${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}`);
  await anonymous.body?.cancel();
  assert.equal(anonymous.status, 403, "Anonymous bucket access must fail");
  await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: objectKey, Body: "disposable deployment check" }));
  const object = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: objectKey }));
  assert.equal(await object.Body.transformToString(), "disposable deployment check");
  // Runtime role may write tenant data but may never alter the schema.
  const rollback = new Error("rollback disposable test");
  await prisma.$transaction(async tx => {
    const workspace = await tx.workspace.create({ data: { name: "Deployment smoke", slug: `smoke-${randomUUID()}` } });
    await tx.auditEvent.create({ data: { workspaceId: workspace.id, action: "deployment.smoke", targetType: "Workspace", targetId: workspace.id } });
    assert.equal(await tx.auditEvent.count({ where: { workspaceId: workspace.id } }), 1);
    throw rollback;
  }).catch(error => { if (error !== rollback) throw error; });
  // Pages come from the website container in the split layout.
  const site = process.env.SWW_LAYOUT === "split" ? "http://frontend:3000" : "http://app:3000";
  for (const path of ["/", "/login", "/api/health"]) {
    const response = await fetch(`${site}${path}`, { signal: AbortSignal.timeout(15_000), redirect: "manual" });
    await response.body?.cancel();
    assert.ok([200, 302, 303, 307].includes(response.status), `Application route ${path} must render`);
  }
  const unauthorized = await fetch("http://app:3000/api/health/db");
  await unauthorized.body?.cancel();
  assert.equal(unauthorized.status, 404, "Readiness must require authentication");
  console.log("Disposable VPS smoke passed: plain-text rejection, anonymous storage rejection, object roundtrip, audited runtime writes, page rendering and readiness authorization.");
} catch {
  console.error("Disposable VPS smoke failed; connection details were suppressed.");
  process.exitCode = 1;
} finally {
  await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: objectKey })).catch(() => {});
  s3.destroy();
  await plain.$disconnect();
  await prisma.$disconnect();
}
