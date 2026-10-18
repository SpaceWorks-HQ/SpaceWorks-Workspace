#!/usr/bin/env node
// Production preflight for Space Works Workspace. Mirrors lib/env.ts
// (productionEnvironmentProblems) for use in CI and deployment hooks without
// a TypeScript toolchain. Prints problem names only, never values.
//
//   node --env-file=.env.production scripts/check-production-env.mjs

const env = process.env;
const problems = [];
const required = [
  "DATABASE_URL", "AUTH_SECRET", "AUTH_URL", "NEXT_PUBLIC_BASE_URL", "REDIS_URL", "CRON_SECRET", "HEALTHCHECK_SECRET",
  "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY", "MFA_ENCRYPTION_KEY", "TRUSTED_PROXY_IP_HEADER", "S3_BUCKET", "S3_REGION",
];
for (const key of required) if (!env[key]?.trim()) problems.push(`${key} is required`);

for (const key of ["AUTH_SECRET", "CRON_SECRET", "HEALTHCHECK_SECRET"]) {
  if (env[key] && env[key].trim().length < 32) problems.push(`${key} must be at least 32 characters`);
}

function isKey(value, lengths) {
  const decoded = Buffer.from(value, "base64");
  return lengths.includes(decoded.length) && decoded.toString("base64").replace(/=+$/, "") === value.replace(/=+$/, "");
}
if (env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY && !isKey(env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY, [16, 24, 32])) problems.push("NEXT_SERVER_ACTIONS_ENCRYPTION_KEY must be base64 for a 16/24/32-byte key");
for (const key of ["MFA_ENCRYPTION_KEY", "INTEGRATION_ENCRYPTION_KEY"]) {
  if (env[key] && !isKey(env[key], [32])) problems.push(`${key} must be base64 for a 32-byte key`);
}

if (Boolean(env.S3_ACCESS_KEY_ID) !== Boolean(env.S3_SECRET_ACCESS_KEY)) problems.push("Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither (IAM role)");
if (env.TRUSTED_PROXY_IP_HEADER && !["cf-connecting-ip", "x-forwarded-for", "x-real-ip"].includes(env.TRUSTED_PROXY_IP_HEADER)) {
  problems.push("TRUSTED_PROXY_IP_HEADER must be cf-connecting-ip, x-forwarded-for or x-real-ip");
}
if ((env.SMTP_HOST || env.SMTP_SERVICE) && env.SMTP_ALLOW_UNAUTHENTICATED !== "1" && (!env.SMTP_USER?.trim() || !env.SMTP_PASSWORD?.trim())) {
  problems.push("SMTP needs SMTP_USER and SMTP_PASSWORD unless SMTP_ALLOW_UNAUTHENTICATED=1 (or configure SMTP in /admin/settings)");
}

if (problems.length === 0) {
  const insecureCiTest = env.CI === "true" && env.ALLOW_INSECURE_PRODUCTION_TESTS === "1";
  try {
    const authUrl = new URL(env.AUTH_URL);
    const baseUrl = new URL(env.NEXT_PUBLIC_BASE_URL);
    if ((!insecureCiTest && (authUrl.protocol !== "https:" || baseUrl.protocol !== "https:")) || authUrl.origin !== baseUrl.origin) {
      problems.push("AUTH_URL and NEXT_PUBLIC_BASE_URL must be the same HTTPS origin");
    }
    for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
      if (!env[key]?.trim()) continue;
      if (!insecureCiTest && !["require", "verify-ca", "verify-full"].includes(new URL(env[key]).searchParams.get("sslmode") ?? "")) {
        problems.push(`${key} must use sslmode=require, verify-ca or verify-full`);
      }
    }
    const db = new URL(env.DATABASE_URL);
    if (db.port === "6543" && db.searchParams.get("pgbouncer") !== "true") problems.push("DATABASE_URL on a transaction pooler (6543) needs pgbouncer=true and a DIRECT_URL");
    if (!insecureCiTest && new URL(env.REDIS_URL).protocol !== "rediss:") problems.push("REDIS_URL must use rediss:// in production");
    if (!insecureCiTest && env.S3_ENDPOINT && new URL(env.S3_ENDPOINT).protocol !== "https:") problems.push("S3_ENDPOINT must use HTTPS in production");
  } catch {
    problems.push("One of the URL variables is not a valid URL");
  }
}

if (problems.length > 0) {
  console.error(`Production environment preflight failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("Production environment preflight passed.");
