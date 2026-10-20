import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const placeholder = "https://spaceworks-workspace-origin.invalid";
const backendPlaceholder = "https://spaceworks-workspace-backend.invalid";
const directories: string[] = [];

// A fake Next.js build output as the release workflow produces it, beside a
// stand-in server.js that only reports that it started.
function build(files: Record<string, string>) {
  const directory = mkdtempSync(path.join(tmpdir(), "sww-entrypoint-"));
  directories.push(directory);
  for (const [name, text] of Object.entries({ ...files, "server.js": 'console.log("server started");' })) {
    mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
    writeFileSync(path.join(directory, name), text);
  }
  return directory;
}

function run(directory: string, command: string[], variables: Record<string, string>) {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", PATH: process.env.PATH ?? "", SWW_NEXT_DIR: directory.replaceAll("\\", "/"), ...variables };
  return spawnSync("sh", ["scripts/docker-entrypoint.sh", ...command], { cwd: root, encoding: "utf8", env });
}

function start(directory: string, origin?: string, extra: Record<string, string> = { NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: "installation-key" }) {
  return run(directory, ["node", path.join(directory, "server.js")], { ...extra, ...(origin ? { NEXT_PUBLIC_BASE_URL: origin } : {}) });
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("image entrypoint", () => {
  it("applies the installation's public origin to a release build before starting", () => {
    const directory = build({
      "server/app/page.js": `const base="${placeholder}";const prefix="spaceworks-workspace-origin.invalid/";`,
      "static/chunks/(auth)/login.js": `fetch("${placeholder}/api/health")`,
      "server/app/index.html": `<link rel="canonical" href="${placeholder}/"><meta content="https%3A%2F%2Fspaceworks-workspace-origin.invalid">`,
      "untouched.js": "no placeholder here",
    });
    const result = start(directory, "https://workspace.example.com");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("server started");
    expect(readFileSync(path.join(directory, "server/app/page.js"), "utf8"))
      .toBe('const base="https://workspace.example.com";const prefix="workspace.example.com/";');
    expect(readFileSync(path.join(directory, "static/chunks/(auth)/login.js"), "utf8")).toBe('fetch("https://workspace.example.com/api/health")');
    expect(readFileSync(path.join(directory, "server/app/index.html"), "utf8"))
      .toBe('<link rel="canonical" href="https://workspace.example.com/"><meta content="https%3A%2F%2Fworkspace.example.com">');
    // Starting again (a container restart) is a no-op.
    expect(start(directory, "https://workspace.example.com").status).toBe(0);
  });

  it("applies the backend origin to a frontend build", () => {
    const directory = build({ "server/chunk.js": `"${placeholder}";new EventSource("${backendPlaceholder}/api/ticket/x/events")` });
    const result = run(directory, ["node", path.join(directory, "server.js")], {
      NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: "frontend-key", NEXT_PUBLIC_BASE_URL: "https://workspace.example.com",
      NEXT_PUBLIC_BACKEND_ORIGIN: "https://api.workspace.example.com",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(path.join(directory, "server/chunk.js"), "utf8"))
      .toBe('"https://workspace.example.com";new EventSource("https://api.workspace.example.com/api/ticket/x/events")');
    const missing = build({ "server/chunk.js": `"${backendPlaceholder}"` });
    expect(run(missing, ["node", path.join(missing, "server.js")], { NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: "k" }).status).toBe(1);
  });

  it("refuses to start a release build without a usable origin", () => {
    for (const origin of [undefined, "workspace.example.com", "https://workspace.example.com/", "https://evil.example.com/\";alert(1)//", "https://a.example.com|b"]) {
      const directory = build({ "server/page.js": `"${placeholder}"` });
      const result = start(directory, origin);
      expect(result.status, String(origin)).toBe(1);
      expect(result.stdout).not.toContain("server started");
      expect(readFileSync(path.join(directory, "server/page.js"), "utf8")).toBe(`"${placeholder}"`);
    }
  });

  it("refuses to start a release build without its own key or with a build-time setting", () => {
    const cases: Record<string, string>[] = [{}, { NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: "key", ALLOWED_ACTION_ORIGINS: "cdn.example.com" }];
    for (const extra of cases) {
      const directory = build({ "server/page.js": `"${placeholder}"` });
      const result = start(directory, "https://workspace.example.com", extra);
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain("server started");
    }
  });

  it("runs operator tools as given, without touching the build or needing web settings", () => {
    const directory = build({ "server/page.js": `"${placeholder}"`, "scripts/tool.mjs": 'console.log("ops task");' });
    const result = spawnSync("sh", [path.join(root, "scripts/docker-entrypoint.sh"), "node", "scripts/tool.mjs"], {
      cwd: directory, encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", SWW_NEXT_DIR: directory.replaceAll("\\", "/") },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("ops task");
    expect(readFileSync(path.join(directory, "server/page.js"), "utf8")).toBe(`"${placeholder}"`);
  });

  it("fails closed for any other command on a release build", () => {
    const directory = build({ "server/page.js": `"${placeholder}"` });
    const result = run(directory, ["node", "--enable-source-maps", path.join(directory, "server.js")], {});
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("server started");
  });

  it("leaves an image built with a real origin alone", () => {
    const directory = build({ "server/page.js": '"https://workspace.example.com"' });
    const result = start(directory);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("server started");
  });
});
