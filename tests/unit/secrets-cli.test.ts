import { describe, it, expect, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { build } from "esbuild";
import { mkdtemp, stat, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseArguments,
  formatValues,
  injectedEnvironment,
} from "../../packages/cli/src/args";
import {
  saveCredentials,
  loadCredentials,
  writePrivateFile,
} from "../../packages/cli/src/credentials";
import {
  normaliseHost,
  getSecrets,
  clearSecretsCache,
} from "../../packages/cli/src/sdk";
import { main, runChild } from "../../packages/cli/src/cli";
import { parseDotenv } from "@/lib/secrets/values";
describe("Secrets CLI and SDK", () => {
  it("executes the actual CLI entrypoint through an npm-style symlink", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sww-bin-"));
    try {
      const executable = join(directory, "cli.mjs"),
        link = join(directory, "sww.mjs");
      await build({
        entryPoints: ["packages/cli/src/cli.ts"],
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node20",
        banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
        outfile: executable,
      });
      await symlink(executable, link);
      const result = await promisify(execFile)(process.execPath, [
        link,
        "--help",
      ]);
      expect(result.stdout).toContain("Space Works Workspace CLI");
      expect(result.stdout).toContain("sww secrets pull");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("parses options and preserves the child command", () => {
    expect(
      parseArguments([
        "run",
        "--env",
        "dev",
        "--path=/api",
        "--",
        "node",
        "--inspect",
        "app.js",
      ]),
    ).toEqual({
      positionals: ["run"],
      flags: { env: "dev", path: "/api" },
      command: ["node", "--inspect", "app.js"],
    });
    expect(parseArguments(["secrets", "set", "TOKEN=a=b"]).positionals[2]).toBe(
      "TOKEN=a=b",
    );
    expect(() => parseArguments(["--env"])).toThrow();
    expect(() => parseArguments(["--unknown"])).toThrow();
  });
  it("escapes environment values and injects without writing files or passing the service token", async () => {
    const values = { MULTI: "a\nb", QUOTE: 'a"b', TOKEN: "secret" };
    expect({ ...parseDotenv(formatValues(values, "env")) }).toEqual(values);
    expect(
      injectedEnvironment(values, {
        SWW_TOKEN: "machine",
        ORIGINAL: "kept",
        NODE_ENV: "test",
      }),
    ).toEqual({ ...values, ORIGINAL: "kept", NODE_ENV: "test" });
    expect(
      await runChild(
        [
          process.execPath,
          "-e",
          "process.exit(process.env.INJECTED==='yes' ? 7 : 8)",
        ],
        { INJECTED: "yes" },
      ),
    ).toBe(7);
  });
  it("stores fallback credentials with private permissions and rejects symlinks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sww-cli-"));
    vi.stubEnv("SWW_CONFIG_DIR", directory);
    vi.stubEnv("SWW_DISABLE_KEYCHAIN", "1");
    try {
      const value = {
        host: "https://example.org",
        accessToken: "fake-access",
        refreshToken: "fake-refresh",
        expiresAt: 123,
      };
      await saveCredentials(value);
      const file = join(directory, "credentials.json");
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(await loadCredentials()).toEqual(value);
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual(value);
      const target = join(directory, "unsafe");
      await symlink(file, target);
      await expect(writePrivateFile(target, "no")).rejects.toThrow("unsafe");
    } finally {
      await rm(directory, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });
  it("requires HTTPS outside localhost and rejects URL credentials", () => {
    expect(normaliseHost("http://localhost:3100")).toBe(
      "http://localhost:3100",
    );
    for (const host of [
      "http://example.org",
      "https://user:pass@example.org",
      "https://example.org/path",
      "https://example.org?key=x",
    ])
      expect(() => normaliseHost(host)).toThrow();
  });
  it("uses a bounded optional in-memory cache and returns independent objects", async () => {
    clearSecretsCache();
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ KEY: "test-value" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetcher);
    try {
      const options = {
        host: "https://example.org",
        token: "test-token",
        project: "id",
        cacheTtlMs: 10000,
      };
      const one = await getSecrets(options);
      one.KEY = "changed";
      expect(await getSecrets(options)).toEqual({ KEY: "test-value" });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      clearSecretsCache();
    }
  });
  it.each([undefined, 0])("bypasses a populated cache when this call's TTL is %s", async (cacheTtlMs) => {
    clearSecretsCache();
    const fetcher = vi.fn().mockImplementation(async () =>
      Response.json({ KEY: `value-${fetcher.mock.calls.length}` }),
    );
    vi.stubGlobal("fetch", fetcher);
    const options = { host: "https://example.org", token: "test-token", project: "id" };
    try {
      expect(await getSecrets({ ...options, cacheTtlMs: 10000 })).toEqual({ KEY: "value-1" });
      expect(await getSecrets({ ...options, cacheTtlMs })).toEqual({ KEY: "value-2" });
      expect(await getSecrets({ ...options, cacheTtlMs })).toEqual({ KEY: "value-3" });
      expect(await getSecrets({ ...options, cacheTtlMs: 10000 })).toEqual({ KEY: "value-1" });
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
      clearSecretsCache();
    }
  });
  it.each(["success", "refresh failure", "revoke failure"])("refreshes expired device credentials before logout and clears them on %s", async (outcome) => {
    const directory = await mkdtemp(join(tmpdir(), "sww-logout-"));
    vi.stubEnv("SWW_CONFIG_DIR", directory);
    vi.stubEnv("SWW_DISABLE_KEYCHAIN", "1");
    // Logout must revoke the stored device, even when a CI token is also set.
    vi.stubEnv("SWW_TOKEN", "unrelated-ci-token");
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const fetcher = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith("/api/cli/refresh")) {
        expect(JSON.parse(String(init.body))).toEqual({ refresh_token: "old-refresh" });
        expect(init.headers).not.toHaveProperty("Authorization");
        return outcome === "refresh failure"
          ? Response.json({ error: "Refresh failed." }, { status: 401 })
          : Response.json({ access_token: "fresh-access", refresh_token: "fresh-refresh", expires_in: 900 });
      }
      expect(url).toBe("https://example.org/api/cli/sessions");
      expect(init.headers).toHaveProperty("Authorization", "Bearer fresh-access");
      expect(JSON.parse(String(init.body))).toEqual({});
      return outcome === "revoke failure"
        ? Response.json({ error: "Revoke failed." }, { status: 503 })
        : Response.json({ ok: true });
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      await saveCredentials({ host: "https://example.org", accessToken: "expired-access", refreshToken: "old-refresh", expiresAt: Date.now() - 900000 });
      if (outcome === "success") expect(await main(["logout"])).toBe(0);
      else await expect(main(["logout"])).rejects.toThrow(outcome === "refresh failure" ? "Refresh failed." : "Revoke failed.");
      expect(fetcher.mock.calls.map(call => call[0])).toEqual([
        "https://example.org/api/cli/refresh",
        ...(outcome === "refresh failure" ? [] : ["https://example.org/api/cli/sessions"]),
      ]);
      expect(await loadCredentials()).toBeNull();
      await expect(stat(join(directory, "credentials.json"))).rejects.toHaveProperty("code", "ENOENT");
    } finally {
      stderr.mockRestore();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
