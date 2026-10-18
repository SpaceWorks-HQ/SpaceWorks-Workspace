// Operator checks for the VPS stack, run in the `ops` container with app.env:
//
//   node docker/vps/check.mjs preflight   configuration only (before start)
//   node docker/vps/check.mjs             live checks against the running stack
//
// Safe output only: no connection URLs, credentials or response bodies.
import { readdirSync } from "node:fs";
import Redis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { productionProblems } from "../../scripts/check-production-env.mjs";

const preflight = productionProblems(process.env);
if (preflight.problems.length > 0) {
  console.error(`Production environment preflight failed:\n- ${preflight.problems.join("\n- ")}`);
  process.exit(1);
}
if (process.argv[2] === "preflight") {
  for (const warning of preflight.warnings) console.warn(`Warning: ${warning}`);
  console.log("Production environment preflight passed.");
  process.exit(0);
}

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 5000, maxRetriesPerRequest: 1 });
redis.on("error", () => {});
const s3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
});
const app = "http://app:3000";

async function status(path, init = {}) {
  const response = await fetch(`${app}${path}`, { ...init, redirect: "manual", signal: AbortSignal.timeout(30_000) });
  await response.body?.cancel();
  return response.status;
}

let step = "database TLS";
try {
  const [{ ssl }] = await prisma.$queryRaw`SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()`;
  if (!ssl) throw new Error();
  step = "runtime database role";
  const [role] = await prisma.$queryRaw`SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user`;
  if (role.rolsuper || role.rolcreatedb || role.rolcreaterole) throw new Error();
  step = "migrations";
  const expected = readdirSync(new URL("../../prisma/migrations/", import.meta.url), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const applied = await prisma.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  const appliedNames = new Set(applied.map((row) => row.migration_name));
  if (expected.some((name) => !appliedNames.has(name))) throw new Error();
  step = "Redis TLS and authentication";
  await redis.connect();
  if ((await redis.ping()) !== "PONG") throw new Error();
  step = "private storage bucket";
  await s3.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }));
  step = "authenticated readiness";
  if ((await status("/api/health/db", { headers: { Authorization: `Bearer ${process.env.HEALTHCHECK_SECRET}` } })) !== 200) throw new Error();
  step = "outbox endpoint";
  if ((await status("/api/internal/outbox", { method: "POST", headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } })) !== 200) throw new Error();
  step = "jobs endpoint";
  const jobs = await status("/api/internal/jobs", { method: "POST", headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  if (jobs < 200 || jobs > 299) throw new Error();
  console.log("VPS checks passed: database TLS, least-privileged runtime role, migrations, Redis TLS/auth, private bucket, readiness, outbox and jobs endpoints.");
} catch {
  console.error(`VPS checks failed at: ${step}. Inspect service health and logs in a trusted operator session; no connection details were logged.`);
  process.exitCode = 1;
} finally {
  redis.disconnect();
  s3.destroy();
  await prisma.$disconnect();
}
