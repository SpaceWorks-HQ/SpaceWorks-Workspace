// Live deployment checks. Provider errors can contain secrets, so only name the failed check.
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 5000, maxRetriesPerRequest: 1 });
redis.on("error", () => {});
const s3 = new S3Client({ region: process.env.S3_REGION, endpoint: process.env.S3_ENDPOINT, forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "1", credentials: process.env.S3_ACCESS_KEY_ID ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } : undefined });
let check = "database TLS";
try {
  const [{ ssl }] = await prisma.$queryRaw`SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()`;
  if (!ssl) throw new Error();
  check = "restricted runtime database role";
  const [role] = await prisma.$queryRaw`SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user`;
  if (role.rolsuper || role.rolcreatedb || role.rolcreaterole) throw new Error();
  const [{ owns }] = await prisma.$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='public' AND nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owns`;
  if (owns) throw new Error();
  check = "Redis TLS and authentication";
  if (!process.env.REDIS_URL?.startsWith("rediss://")) throw new Error();
  await redis.connect();
  if (await redis.ping() !== "PONG") throw new Error();
  check = "private object storage credentials";
  await s3.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }));
  if (process.env.S3_ENDPOINT) {
    const endpoint = new URL(process.env.S3_ENDPOINT);
    if (endpoint.protocol !== "https:") throw new Error();
  }
  check = "authenticated database readiness";
  const result = await fetch("http://127.0.0.1:3000/api/health/db", { headers: { Authorization: `Bearer ${process.env.HEALTHCHECK_SECRET}` }, signal: AbortSignal.timeout(5000) });
  await result.body?.cancel();
  if (!result.ok) throw new Error();
  console.log("Deployment passed: database TLS, restricted app role, Redis TLS/auth, storage access and authenticated readiness.");
} catch {
  console.error(`Deployment failed at ${check}. Check private service configuration and logs.`);
  process.exitCode = 1;
} finally {
  redis.disconnect();
  s3.destroy();
  await prisma.$disconnect();
}
