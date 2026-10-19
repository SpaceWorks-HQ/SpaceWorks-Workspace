import { describe, expect, it } from "vitest";
import { envSchema, productionEnvironmentProblems } from "@/lib/env";

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
    TRUSTED_PROXY_IP_HEADER: "cf-connecting-ip",
    S3_BUCKET: "sww",
    S3_REGION: "auto",
    S3_ENDPOINT: "https://account.r2.cloudflarestorage.com",
    S3_ACCESS_KEY_ID: "id",
    S3_SECRET_ACCESS_KEY: "secret",
  };
}

describe("environment schema", () => {
  it("accepts a complete production environment", () => {
    expect(productionEnvironmentProblems(productionEnv())).toEqual([]);
  });

  it("treats empty strings as unset", () => {
    const parsed = envSchema.safeParse({ DATABASE_URL: "postgresql://localhost/db", AUTH_SECRET: "x".repeat(32), REDIS_URL: "", S3_ENDPOINT: "" });
    expect(parsed.success).toBe(true);
  });

  it("rejects short secrets and malformed keys", () => {
    const problems = productionEnvironmentProblems({ ...productionEnv(), AUTH_SECRET: "short", MFA_ENCRYPTION_KEY: "not-base64-32-bytes" });
    expect(problems.some((p) => p.startsWith("AUTH_SECRET"))).toBe(true);
    expect(problems.some((p) => p.startsWith("MFA_ENCRYPTION_KEY"))).toBe(true);
  });

  it("requires production-only variables", () => {
    const env = productionEnv();
    delete (env as Record<string, string | undefined>).REDIS_URL;
    expect(productionEnvironmentProblems(env)).toContain("REDIS_URL: required in production");
  });

  it("requires TLS everywhere in production", () => {
    expect(productionEnvironmentProblems({ ...productionEnv(), REDIS_URL: "redis://redis:6379" })).toContain("REDIS_URL must use TLS (rediss://) in production.");
    expect(productionEnvironmentProblems({ ...productionEnv(), DATABASE_URL: "postgresql://u:p@db:5432/x" }).some((p) => p.includes("sslmode"))).toBe(true);
    expect(productionEnvironmentProblems({ ...productionEnv(), AUTH_URL: "http://work.example.org", NEXT_PUBLIC_BASE_URL: "http://work.example.org" }).some((p) => p.includes("HTTPS"))).toBe(true);
  });

  it("requires matching origins and paired S3 credentials", () => {
    expect(productionEnvironmentProblems({ ...productionEnv(), AUTH_URL: "https://other.example.org" }).some((p) => p.includes("same HTTPS origin"))).toBe(true);
    const env = productionEnv();
    delete (env as Record<string, string | undefined>).S3_SECRET_ACCESS_KEY;
    expect(productionEnvironmentProblems(env).some((p) => p.includes("S3_ACCESS_KEY_ID"))).toBe(true);
  });
});
