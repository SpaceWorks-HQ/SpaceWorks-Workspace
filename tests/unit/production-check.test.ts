import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { productionEnvironmentProblems } from "@/lib/env";
import { productionProblems } from "@/scripts/check-production-env.mjs";

// scripts/check-production-env.mjs is the toolchain-free twin of lib/env.ts
// used by CI, the VPS installer and deployment hooks. They must agree.
function productionEnv(): Record<string, string> {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://user:pw@db.example.org:5432/sww?sslmode=require",
    AUTH_SECRET: "s".repeat(44),
    AUTH_URL: "https://work.example.org",
    NEXT_PUBLIC_BASE_URL: "https://work.example.org",
    REDIS_URL: "rediss://default:token@redis.example.org:6379",
    CRON_SECRET: "c".repeat(44),
    HEALTHCHECK_SECRET: "h".repeat(44),
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    MFA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64"),
    TRUSTED_PROXY_IP_HEADER: "x-real-ip",
    S3_BUCKET: "sww",
    S3_REGION: "auto",
    S3_ENDPOINT: "https://account.r2.cloudflarestorage.com",
    S3_ACCESS_KEY_ID: "id",
    S3_SECRET_ACCESS_KEY: "secret",
    SUPER_ADMIN_EMAIL: "owner@example.org",
  };
}

const cases: Array<[string, Record<string, string | undefined>]> = [
  ["production in-process jobs", { JOBS_INPROCESS: "true" }],
  ["invalid worker concurrency", { QUEUE_OUTBOX_CONCURRENCY: "0" }],
  ["invalid worker health port", { JOBS_HEALTH_PORT: "70000" }],
  ["invalid queue prefix", { JOBS_QUEUE_PREFIX: "not a prefix" }],
  ["missing CRON_SECRET", { CRON_SECRET: undefined }],
  ["short AUTH_SECRET", { AUTH_SECRET: "short" }],
  ["bad MFA key", { MFA_ENCRYPTION_KEY: "not-a-key" }],
  ["plain-text database", { DATABASE_URL: "postgresql://user:pw@db.example.org:5432/sww" }],
  ["plain-text Redis", { REDIS_URL: "redis://redis.example.org:6379" }],
  ["HTTP origin", { AUTH_URL: "http://work.example.org", NEXT_PUBLIC_BASE_URL: "http://work.example.org" }],
  ["mismatched origins", { NEXT_PUBLIC_BASE_URL: "https://other.example.org" }],
  ["pooler without pgbouncer", { DATABASE_URL: "postgresql://u:p@pooler.example.org:6543/postgres?sslmode=require" }],
  ["plain-text S3 endpoint", { S3_ENDPOINT: "http://storage:9000" }],
  ["half S3 credentials", { S3_SECRET_ACCESS_KEY: undefined }],
  ["unknown proxy header", { TRUSTED_PROXY_IP_HEADER: "forwarded" }],
];

function withOverrides(overrides: Record<string, string | undefined>) {
  const env: Record<string, string> = { ...productionEnv() };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

describe("production preflight script", () => {
  it("accepts a complete production environment, like the server does", () => {
    expect(productionProblems(productionEnv()).problems).toEqual([]);
    expect(productionEnvironmentProblems(productionEnv())).toEqual([]);
  });

  it.each(cases)("rejects %s, like the server does", (_name, overrides) => {
    const env = withOverrides(overrides);
    expect(productionProblems(env).problems.length).toBeGreaterThan(0);
    expect(productionEnvironmentProblems(env).length).toBeGreaterThan(0);
  });

  it("checks deployment extras the server leaves to operators", () => {
    expect(productionProblems({ ...productionEnv(), VAULT_MASTER_KEY: "short" }).problems).toContain("VAULT_MASTER_KEY: must be base64 for a 32 byte AES key");
    expect(productionProblems({ ...productionEnv(), SMTP_HOST: "smtp.example.org" }).problems.some((p: string) => p.startsWith("SMTP_USER"))).toBe(true);
    expect(productionProblems({ ...productionEnv(), TRUSTED_PROXY_HOPS: "1" }).problems.some((p: string) => p.startsWith("TRUSTED_PROXY_HOPS"))).toBe(true);
    expect(productionProblems({ ...productionEnv(), SUPER_ADMIN_EMAIL: "" }).warnings.some((w: string) => w.startsWith("SUPER_ADMIN_EMAIL"))).toBe(true);
  });

  it("exits 0 or 1 and never prints secret values", () => {
    const run = (env: Record<string, string>) =>
      spawnSync(process.execPath, ["scripts/check-production-env.mjs"], { env: { ...env, NODE_ENV: "production", PATH: process.env.PATH ?? "" }, encoding: "utf8" });
    const ok = run(productionEnv());
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("preflight passed");

    const bad = run({ ...productionEnv(), REDIS_URL: "redis://default:hunter2-secret@redis:6379" });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("REDIS_URL");
    expect(`${bad.stdout}${bad.stderr}`).not.toContain("hunter2-secret");
  });
});
