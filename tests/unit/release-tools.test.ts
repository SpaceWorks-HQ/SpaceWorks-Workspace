import { describe, expect, it } from "vitest";
import { configure, dotenv, validateAnswers } from "../../scripts/configure-installation.mjs";
import { prepareFrontendAssets } from "../../scripts/prepare-frontend-assets.mjs";
import { pgEnvironment } from "../../scripts/release-database.mjs";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const answers = {
  ANSWERS_CONFIRMED: "yes", WEBHOST: "work.example.org", HTTPS_MODE: "1", SHAPE: "1", SPLIT_ROLE: "backend",
  DATABASE: "bundled", REDIS: "bundled", STORAGE: "bundled", ADMINEMAIL: "owner@example.org",
} as unknown as NodeJS.ProcessEnv;
describe("release configuration boundary", () => {
  it("keeps interpolation and shell syntax literal in private dotenv values", () => {
    expect(dotenv({ PASSWORD: "a'$value\\literal", EMPTY: "" })).toBe("PASSWORD='a\\'$value\\\\literal'\nEMPTY=''\n");
  });
  it.each(["\r", "\n", "\0"])("rejects multiline and NUL values (%j)", (value) => {
    expect(() => dotenv({ PASSWORD: value })).toThrow("single line");
  });
  it("accepts the confirmed bundled deployment", () => expect(() => validateAnswers(answers)).not.toThrow());
  it.each([
    { ANSWERS_CONFIRMED: "no" }, { HTTPS_MODE: "3" }, { WEBHOST: "https://work.example.org/path" },
    { SWW_EDGE_PORT: "0" }, { SWW_HTTPS_PORT: "65536" }, { COMPOSE_PROJECT_NAME: "../../other" },
    { ADMINEMAIL: "not-an-email" }, { DATABASE: "unknown" },
  ])("rejects unsafe or unconfirmed answers: %j", (change) => {
    expect(() => validateAnswers({ ...answers, ...change })).toThrow();
  });
  it.each([
    { DATABASE: "external", RUNTIME_DATABASE: "postgresql://app:p@db/app", DIRECT_DATABASE: "postgresql://owner:p@db/app?sslmode=require" },
    { DATABASE: "external", RUNTIME_DATABASE: "postgresql://app:p@db/app?sslmode=require", DIRECT_DATABASE: "postgresql://owner:p@db:6543/app?sslmode=require" },
    { REDIS: "external", EXTERNAL_REDIS: "redis://db:6379" },
    { STORAGE: "external", S3_ENDPOINT: "http://objects.example.org" },
    { SPLIT_ROLE: "frontend", BACKEND_UPSTREAM: "https://user:secret@backend.example.org" },
    { SPLIT_ROLE: "frontend", BACKEND_UPSTREAM: "https://backend.example.org/route" },
  ])("rejects insecure external services: %j", (change) => {
    expect(() => validateAnswers({ ...answers, ...change })).toThrow();
  });
  it("accepts a frontend-only host without owner or database credentials", () => {
    expect(() => validateAnswers({ ...answers, SPLIT_ROLE: "frontend", ADMINEMAIL: "", BACKEND_UPSTREAM: "https://backend.example.org" })).not.toThrow();
  });
});

describe("release PostgreSQL transport", () => {
  it("uses the maintenance URL and decodes credentials into child environment", () => {
    const value = pgEnvironment({ DATABASE_URL: "postgresql://app:p@elsewhere/app", DIRECT_URL: "postgresql://owner:p%40ss@postgres:5432/sww?sslmode=require&sslcert=/tls/ca.crt", PGHOST: "injected", PGPASSWORD: "injected" });
    expect(value).toMatchObject({ PGHOST: "postgres", PGUSER: "owner", PGPASSWORD: "p@ss", PGSSLMODE: "require", PGSSLROOTCERT: "/tls/ca.crt" });
    expect(value.DATABASE_URL).toBeUndefined();
    expect(value.DIRECT_URL).toBeUndefined();
  });
  it("does not force the bundled private CA onto a managed database", () => {
    const value = pgEnvironment({ DIRECT_URL: "postgresql://owner:p@managed.example.org/app?sslmode=verify-full" });
    expect(value.PGSSLROOTCERT).toBeUndefined();
    expect(value.PGSSLMODE).toBe("verify-full");
  });
  it("rejects a non-PostgreSQL protocol", () => expect(() => pgEnvironment({ DATABASE_URL: "https://example.org" })).toThrow());
});

describe("release backup manifest", () => {
  it("verifies a complete snapshot and refuses changed object bytes", () => {
    const folder = mkdtempSync(join(tmpdir(), "sww-release-unit-"));
    try {
      mkdirSync(join(folder, "config")); mkdirSync(join(folder, "objects"));
      writeFileSync(join(folder, "database.dump"), "custom dump placeholder");
      writeFileSync(join(folder, "config", "app.env"), "AUTH_SECRET='unit-test-only'\n");
      writeFileSync(join(folder, "objects", "manifest.json"), "private object bytes");
      execFileSync("python3", ["scripts/backup-manifest.py", "create", folder]);
      expect(readFileSync(join(folder, "manifest.json"), "utf8")).toContain("objects/manifest.json");
      expect(spawnSync("python3", ["scripts/backup-manifest.py", "verify", folder]).status).toBe(0);
      writeFileSync(join(folder, "objects", "manifest.json"), "changed");
      expect(spawnSync("python3", ["scripts/backup-manifest.py", "verify", folder]).status).toBe(1);
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
  it("refuses path traversal and links before extraction", () => {
    const folder = mkdtempSync(join(tmpdir(), "sww-release-unit-"));
    try {
      for (const kind of ["path", "link"]) {
        const archive = join(folder, `${kind}.tar`);
        execFileSync("python3", ["-c", "import io,sys,tarfile; a=tarfile.open(sys.argv[1],'w'); m=tarfile.TarInfo('../outside' if sys.argv[2]=='path' else 'link'); m.type=tarfile.REGTYPE if sys.argv[2]=='path' else tarfile.SYMTYPE; m.linkname='/etc/passwd'; m.size=0; a.addfile(m,io.BytesIO()); a.close()", archive, kind]);
        expect(spawnSync("python3", ["scripts/backup-manifest.py", "extract", archive, join(folder, "unpacked")]).status).toBe(1);
      }
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
});

describe("release public asset export", () => {
  it("copies public files and metadata while excluding server page artifacts", () => {
    const folder = mkdtempSync(join(tmpdir(), "sww-release-assets-"));
    try {
      mkdirSync(join(folder, "public"));
      mkdirSync(join(folder, ".next/server/app"), { recursive: true });
      writeFileSync(join(folder, "public", "offline.html"), "public offline shell");
      writeFileSync(join(folder, ".next/server/app", "robots.txt.body"), "User-Agent: *");
      writeFileSync(join(folder, ".next/server/app", "private.html"), "private page");
      prepareFrontendAssets(folder);
      expect(readFileSync(join(folder, "frontend-public", "robots.txt"), "utf8")).toBe("User-Agent: *");
      expect(readFileSync(join(folder, "frontend-public", "offline.html"), "utf8")).toBe("public offline shell");
      expect(() => readFileSync(join(folder, "frontend-public", "private.html"))).toThrow();
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
});

describe("release secret separation", () => {
  it("keeps maintenance credentials out of the app and gives the scheduler only its bearer", () => {
    const folder = mkdtempSync(join(tmpdir(), "sww-release-config-"));
    const previous = process.umask();
    try {
      configure(folder, answers);
      const runtime = readFileSync(join(folder, "config/app.env"), "utf8");
      const maintenance = readFileSync(join(folder, "config/migrate.env"), "utf8");
      const scheduler = readFileSync(join(folder, "config/scheduler.env"), "utf8");
      expect(runtime).toContain("sww_app:");
      expect(maintenance).toContain("sww:");
      expect(runtime).not.toContain("POSTGRES_PASSWORD");
      expect(scheduler.trim().split("\n").map((line: string) => line.split("=", 1)[0]).sort()).toEqual(["APP_URL", "CRON_SECRET"]);
      expect(statSync(join(folder, "config/app.env")).mode & 0o777).toBe(0o600);
      expect(statSync(join(folder, ".env")).mode & 0o777).toBe(0o600);
      expect(() => configure(folder, answers)).toThrow("Configuration exists");
    } finally { process.umask(previous); rmSync(folder, { recursive: true, force: true }); }
  }, 20000);
  it("creates no backend credentials on a frontend-only host", () => {
    const folder = mkdtempSync(join(tmpdir(), "sww-release-frontend-"));
    const previous = process.umask();
    try {
      configure(folder, { ...answers, SPLIT_ROLE: "frontend", BACKEND_UPSTREAM: "https://backend.example.org" });
      expect(existsSync(join(folder, "config/app.env"))).toBe(false);
      expect(existsSync(join(folder, "config/tls/ca.key"))).toBe(false);
    } finally { process.umask(previous); rmSync(folder, { recursive: true, force: true }); }
  });
});
