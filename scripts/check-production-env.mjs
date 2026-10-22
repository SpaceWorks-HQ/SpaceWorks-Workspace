#!/usr/bin/env node
// Production preflight for Space Works Workspace. Mirrors lib/env.ts
// (envSchema + productionEnvironmentProblems, which the server enforces at
// boot) so CI, installers and deployment hooks can check a configuration
// without a TypeScript toolchain. Prints variable names and rules, never values.
//
//   npm run production:check                                   (current environment)
//   node --env-file=/secure/path/sww.env scripts/check-production-env.mjs
//
// Exit code 0 = ready, 1 = problems found. Warnings never fail the check.
import { pathToFileURL } from "node:url";

const REQUIRED = [
  "DATABASE_URL", "AUTH_SECRET", "AUTH_URL", "NEXT_PUBLIC_BASE_URL", "REDIS_URL", "CRON_SECRET", "HEALTHCHECK_SECRET",
  "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY", "MFA_ENCRYPTION_KEY", "TRUSTED_PROXY_IP_HEADER", "S3_BUCKET", "S3_REGION",
];
const SECRETS_32 = ["AUTH_SECRET", "CRON_SECRET", "HEALTHCHECK_SECRET"];
const AES_256_KEYS = ["MFA_ENCRYPTION_KEY", "INTEGRATION_ENCRYPTION_KEY", "VAULT_MASTER_KEY"];
const URL_KEYS = ["DATABASE_URL", "DIRECT_URL", "AUTH_URL", "NEXT_PUBLIC_BASE_URL", "REDIS_URL", "S3_ENDPOINT", "SEARXNG_URL"];

function isBase64Key(value, lengths) {
  const decoded = Buffer.from(value, "base64");
  return lengths.includes(decoded.length) && decoded.toString("base64").replace(/=+$/, "") === value.replace(/=+$/, "");
}

function parseUrl(value) {
  try { return new URL(value); } catch { return null; }
}

/** Returns { problems, warnings } for an environment object. Pure. */
export function productionProblems(source) {
  const env = Object.fromEntries(Object.entries(source).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]));
  const problems = [];
  const warnings = [];
  for (const key of REQUIRED) if (!env[key]) problems.push(`${key}: required in production`);

  for (const key of SECRETS_32) if (env[key] && env[key].length < 32) problems.push(`${key}: must be at least 32 characters`);
  if (env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY && !isBase64Key(env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY, [16, 24, 32])) {
    problems.push("NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: must be base64 for a 16, 24 or 32 byte AES key");
  }
  for (const key of AES_256_KEYS) if (env[key] && !isBase64Key(env[key], [32])) problems.push(`${key}: must be base64 for a 32 byte AES key`);
  for (const key of URL_KEYS) if (env[key] && !parseUrl(env[key])) problems.push(`${key}: must be a valid URL`);

  if (Boolean(env.S3_ACCESS_KEY_ID) !== Boolean(env.S3_SECRET_ACCESS_KEY)) {
    problems.push("S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY: set both, or neither when using an IAM role");
  }
  if (env.S3_FORCE_PATH_STYLE && !["0", "1"].includes(env.S3_FORCE_PATH_STYLE)) problems.push("S3_FORCE_PATH_STYLE: must be 0 or 1");
  if (env.TRUSTED_PROXY_IP_HEADER && !["cf-connecting-ip", "x-forwarded-for", "x-real-ip"].includes(env.TRUSTED_PROXY_IP_HEADER)) {
    problems.push("TRUSTED_PROXY_IP_HEADER: must be cf-connecting-ip, x-forwarded-for or x-real-ip");
  }
  if (env.TRUSTED_PROXY_HOPS && (!/^[1-9]\d?$/.test(env.TRUSTED_PROXY_HOPS) || env.TRUSTED_PROXY_IP_HEADER !== "x-forwarded-for")) {
    problems.push("TRUSTED_PROXY_HOPS: a positive whole number, only with TRUSTED_PROXY_IP_HEADER=x-forwarded-for");
  }

  // SMTP in the environment is a bootstrap fallback; /admin settings override it.
  if (env.SMTP_HOST || env.SMTP_SERVICE) {
    if (env.SMTP_ALLOW_UNAUTHENTICATED !== "1" && (!env.SMTP_USER || !env.SMTP_PASSWORD)) {
      problems.push("SMTP_USER and SMTP_PASSWORD: required with SMTP_HOST unless SMTP_ALLOW_UNAUTHENTICATED=1 (or configure SMTP in /admin)");
    }
    if (!env.EMAIL_FROM) problems.push("EMAIL_FROM: required when SMTP is configured");
  }
  if (env.SMTP_PORT && !(/^\d{1,5}$/.test(env.SMTP_PORT) && Number(env.SMTP_PORT) >= 1 && Number(env.SMTP_PORT) <= 65535)) problems.push("SMTP_PORT: must be a port number");
  if (env.SMTP_SECURE && !["true", "false"].includes(env.SMTP_SECURE)) problems.push("SMTP_SECURE: must be true or false");
  if (env.SMTP_ALLOW_UNAUTHENTICATED === "1") warnings.push("SMTP_ALLOW_UNAUTHENTICATED=1 is meant for local Mailpit only");

  for (const key of ["GITHUB_WEBHOOK_SECRET", "TELEGRAM_WEBHOOK_SECRET"]) if (env[key] && env[key].length < 16) problems.push(`${key}: must be at least 16 characters`);
  if (env.SUPER_ADMIN_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.SUPER_ADMIN_EMAIL)) problems.push("SUPER_ADMIN_EMAIL: must be an email address");
  if (!env.SUPER_ADMIN_EMAIL) warnings.push("SUPER_ADMIN_EMAIL is not set: nobody can open /admin");
  if (!env.INTEGRATION_ENCRYPTION_KEY) warnings.push("INTEGRATION_ENCRYPTION_KEY is not set: integration tokens use a subkey of MFA_ENCRYPTION_KEY");
  for (const [key, maximum] of [["JOBS_HEALTH_PORT", 65535], ...["OUTBOX", "SCHEDULED", "SYNC", "MONITOR", "DOCUMENTS"].map(name => [`QUEUE_${name}_CONCURRENCY`, 64])]) {
    if (env[key] && (!/^\d+$/.test(env[key]) || Number(env[key]) < 1 || Number(env[key]) > maximum)) problems.push(`${key}: must be an integer from 1 to ${maximum}`);
  }
  if (env.JOBS_QUEUE_PREFIX && !/^[a-zA-Z0-9:_-]{1,100}$/.test(env.JOBS_QUEUE_PREFIX)) problems.push("JOBS_QUEUE_PREFIX: invalid queue prefix");
  if (env.JOBS_INPROCESS === "true") problems.push("JOBS_INPROCESS: local development only; run worker and beat in production");
  if (env.DEPLOYMENT_MODE === "backend" && !/^[a-f0-9]{64}$/.test(env.FRONTEND_GATEWAY_SECRET ?? "")) problems.push("FRONTEND_GATEWAY_SECRET: split backend requires a 32-byte hex key");
  if (env.DEPLOYMENT_MODE && env.DEPLOYMENT_MODE !== "backend") problems.push("DEPLOYMENT_MODE: use backend or leave unset");
  if (problems.length > 0) return { problems, warnings };

  // Transport security (the same rules the server enforces at boot).
  const insecureCiTest = env.CI === "true" && env.ALLOW_INSECURE_PRODUCTION_TESTS === "1";
  const authUrl = parseUrl(env.AUTH_URL);
  const baseUrl = parseUrl(env.NEXT_PUBLIC_BASE_URL);
  if ((!insecureCiTest && (authUrl.protocol !== "https:" || baseUrl.protocol !== "https:")) || authUrl.origin !== baseUrl.origin) {
    problems.push("AUTH_URL and NEXT_PUBLIC_BASE_URL: must be the same HTTPS origin");
  }
  for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
    if (!env[key]) continue;
    if (!insecureCiTest && !["require", "verify-ca", "verify-full"].includes(parseUrl(env[key]).searchParams.get("sslmode") ?? "")) {
      problems.push(`${key}: must require TLS with sslmode=require, verify-ca or verify-full`);
    }
  }
  const database = parseUrl(env.DATABASE_URL);
  if (database.port === "6543" && database.searchParams.get("pgbouncer") !== "true") {
    problems.push("DATABASE_URL: a transaction pooler (port 6543) needs pgbouncer=true, plus DIRECT_URL for migrations");
  }
  if (database.searchParams.get("pgbouncer") === "true" && !env.DIRECT_URL) {
    warnings.push("DATABASE_URL uses pgbouncer=true but DIRECT_URL is unset: migrations would run through the pooler");
  }
  if (!insecureCiTest && parseUrl(env.REDIS_URL).protocol !== "rediss:") problems.push("REDIS_URL: must use TLS (rediss://) in production");
  if (!insecureCiTest && env.S3_ENDPOINT && parseUrl(env.S3_ENDPOINT).protocol !== "https:") problems.push("S3_ENDPOINT: must use HTTPS in production");
  if (insecureCiTest) warnings.push("CI=true with ALLOW_INSECURE_PRODUCTION_TESTS=1 relaxes TLS rules: never use this pair in a deployment");
  return { problems, warnings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { problems, warnings } = productionProblems(process.env);
  for (const warning of warnings) console.warn(`Warning: ${warning}`);
  if (problems.length > 0) {
    console.error(`Production environment preflight failed:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log("Production environment preflight passed.");
}
