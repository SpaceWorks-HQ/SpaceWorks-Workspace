// Disposable deployment test only (CI or a throwaway stack). Production
// operators use check.mjs. Runs in the `ops` container with app.env.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

await import("./check.mjs");
if (process.exitCode) process.exit(process.exitCode);

const plainUrl = new URL(process.env.DATABASE_URL);
plainUrl.searchParams.set("sslmode", "disable");
const plain = new PrismaClient({ datasources: { db: { url: plainUrl.toString() } } });
const s3 = new S3Client({
  region: process.env.S3_REGION, endpoint: process.env.S3_ENDPOINT, forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
});
const objectKey = `deployment-smoke/${randomUUID()}`;
const app = "http://app:3000";

async function status(path, init = {}) {
  const response = await fetch(`${app}${path}`, { ...init, redirect: "manual", signal: AbortSignal.timeout(30_000) });
  await response.body?.cancel();
  return response.status;
}

let step = "plain-text database rejection";
try {
  let rejected = false;
  try { await plain.$queryRaw`SELECT 1`; } catch { rejected = true; }
  assert.ok(rejected);
  step = "anonymous storage rejection";
  const anonymous = await fetch(`${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/`);
  await anonymous.body?.cancel();
  assert.equal(anonymous.status, 403);
  step = "storage round trip";
  await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: objectKey, Body: "disposable deployment check" }));
  const object = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: objectKey }));
  assert.equal(await object.Body.transformToString(), "disposable deployment check");
  step = "pages render";
  assert.equal(await status("/api/health"), 200, "/api/health");
  // A fresh install has no accounts yet, so /login sends visitors to /setup.
  const login = await status("/login");
  assert.ok(login === 200 || (login >= 300 && login < 400 && (await status("/setup")) === 200), "/login or /setup");
  step = "readiness requires the bearer";
  assert.equal(await status("/api/health/db"), 404);
  step = "internal endpoints require the bearer";
  assert.equal(await status("/api/internal/outbox", { method: "POST" }), 404);
  assert.equal(await status("/api/internal/jobs", { method: "POST", headers: { Authorization: "Bearer wrong" } }), 404);
  console.log("Disposable VPS smoke passed: plain-text DB rejection, anonymous storage rejection, object round trip, pages, bearer-protected endpoints.");
} catch {
  console.error(`Disposable VPS smoke failed at: ${step}.`);
  process.exitCode = 1;
} finally {
  await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: objectKey })).catch(() => {});
  s3.destroy();
  await plain.$disconnect();
}
