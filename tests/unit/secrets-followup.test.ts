import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectSecrets, ignoredPath, scanCommand } from "../../packages/cli/src/scanner";
import { parseArguments, formatValues } from "../../packages/cli/src/args";
import { main } from "../../packages/cli/src/cli";
import { encryptWithKey, decryptWithKey, vaultRootKeys, sealEnvelope, openLegacyVaultEnvelope } from "@/lib/crypto";
import { viewDto } from "@/lib/frontend/view";
import { lineDiff } from "@/lib/secrets/diff";
import { canUseSecrets, canManageSecrets } from "@/lib/roles";
import { isValidElement, useEffect, useRef, useState, type ReactNode, type FormEvent } from "react";
import { IdentitySettings } from "@/components/secrets/IdentitySettings";
import { ShareViewer } from "@/components/secrets/ShareViewer";
import { SecretsWorkspace } from "@/components/secrets/SecretsWorkspace";
import type { SecretsView } from "@/lib/secrets/types";
const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/app/actions/secrets", () => ({ secretsAction: vi.fn() }));
vi.mock("react", async importOriginal => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useEffect: vi.fn(react.useEffect), useRef: vi.fn(react.useRef), useState: vi.fn(react.useState) };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
// Inspect the components' own elements and handlers without rendering UI primitives.
function elements(node: ReactNode): import("react").ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function mockComponentHooks() {
  const setters: ReturnType<typeof vi.fn>[] = [];
  vi.mocked(useState).mockClear(); vi.mocked(useRef).mockClear(); vi.mocked(useEffect).mockClear();
  vi.mocked(useState).mockImplementation(((initial?: unknown) => {
    const setter = vi.fn(); setters.push(setter);
    return [typeof initial === "function" ? initial() : initial, setter];
  }) as typeof useState);
  vi.mocked(useRef).mockImplementation((value: unknown) => ({ current: value }));
  vi.mocked(useEffect).mockImplementation(() => {});
  return setters;
}
describe("Secrets settings and share interactions", () => {
  it("shows the next active keys page only when a cursor is available", () => {
    mockComponentHooks();
    const view = {
      project: { id: "project" }, environment: { id: "dev", accessRole: "KEYS" },
      projects: [], members: [], folders: [], rows: [], path: "/app",
      nextKeysCursor: "last-key",
    } as unknown as SecretsView;
    const more = elements(SecretsWorkspace({ view, slug: "space", timezone: "UTC" }))
      .find(element => element.props.children === "Show more")!;
    expect(more).toBeDefined();
    (more.props.onClick as () => void)();
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith(
      "/w/space/secrets?project=project&environment=dev&path=%2Fapp&keysCursor=last-key",
    );
    expect(elements(SecretsWorkspace({ view: { ...view, nextKeysCursor: undefined }, slug: "space", timezone: "UTC" }))
      .some(element => element.props.children === "Show more")).toBe(false);
  });
  it("submits the selected identity ID with edited settings", async () => {
    mockComponentHooks();
    const act = vi.fn().mockResolvedValue({ ok: true });
    const identity = { id: "identity-selected", name: "CI", clientId: "client-id", accessTtl: 7200, maxTtl: 2592000, permissions: [], loginIps: [], tokenIps: [], failureLimit: 3, lockoutSeconds: 300, clientSecretMetadata: [], tokens: [] };
    const view = { path: "/", identities: [identity] } as unknown as SecretsView;
    const tree = IdentitySettings({ view, act, busy: false });
    const form = elements(tree).find(element => element.type === "form" && elements(element.props.children as ReactNode).some(child => child.props.children === "Save settings and revoke tokens"))!;
    const data = new FormData();
    for (const [key, value] of Object.entries({ name: "Renamed CI", hours: "2", days: "30", loginIps: "", tokenIps: "", failureLimit: "3", lockMinutes: "5" })) data.set(key, value);
    const formData = vi.fn(function () { return data; });
    vi.stubGlobal("FormData", formData);
    await (form.props.onSubmit as (event: FormEvent<HTMLFormElement>) => Promise<void>)({ preventDefault: vi.fn(), currentTarget: {} } as unknown as FormEvent<HTMLFormElement>);
    expect(act).toHaveBeenCalledExactlyOnceWith("identity-settings", expect.objectContaining({ id: identity.id, name: "Renamed CI", accessTtl: 7200, maxTtl: 2592000 }));
  });
  it.each(["fetch", "decrypt"])("discards plaintext when the tab hides and returns during %s", async stage => {
    const setters = mockComponentHooks();
    const document = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal("document", document);
    vi.stubGlobal("location", { hash: "#capability." + Buffer.alloc(32, 1).toString("base64url"), pathname: "/share" });
    vi.stubGlobal("history", { replaceState: vi.fn() });
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    let reached!: () => void;
    const inFlight = new Promise<void>(resolve => { reached = resolve; });
    const fetcher = vi.fn(async () => {
      if (stage === "fetch") { reached(); await pending; }
      return Response.json({ ciphertext: "aXY.Ym9keQ" });
    });
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("crypto", { subtle: {
      importKey: vi.fn().mockResolvedValue({}),
      decrypt: vi.fn(async () => {
        if (stage === "decrypt") { reached(); await pending; }
        return new TextEncoder().encode("private-share-value").buffer;
      }),
    } });
    const tree = ShareViewer();
    const cleanup = vi.mocked(useEffect).mock.calls[0][0]();
    try {
      const button = elements(tree).find(element => element.props.onClick)!;
      (button.props.onClick as () => void)();
      await inFlight;
      document.hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
      document.hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
      release();
      await vi.waitFor(() => expect(setters[2]).toHaveBeenLastCalledWith(false));
      expect(setters[0]).toHaveBeenCalledWith(null);
      expect(setters[0].mock.calls.every(([value]) => value === null)).toBe(true);
      expect(setters[3]).toHaveBeenCalledWith(true);
      expect(vi.mocked(useRef).mock.results[0].value.current).toBe("");
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { cleanup?.(); }
  });
});
describe("Secrets follow-up crypto", () => {
  it("binds ciphertext to the full secret location and changes every nonce", () => {
    const key = Buffer.alloc(32, 4), aad = JSON.stringify(["project", "dev", "/api", "KEY"]);
    const first = encryptWithKey(key, "fixture-only", aad), second = encryptWithKey(key, "fixture-only", aad);
    expect(first).not.toBe(second);
    expect(decryptWithKey(key, first, aad)).toBe("fixture-only");
    for (const other of [["other", "dev", "/api", "KEY"], ["project", "prod", "/api", "KEY"], ["project", "dev", "/", "KEY"], ["project", "dev", "/api", "OTHER"]]) expect(() => decryptWithKey(key, first, JSON.stringify(other))).toThrow();
  });
  it("supports newest-root encryption, dual-root legacy decrypt and rejects duplicate versions", () => {
    const old = Buffer.alloc(32, 8), next = Buffer.alloc(32, 9), legacy = sealEnvelope(old, "fixture-only");
    vi.stubEnv("VAULT_MASTER_KEYS", `2:${next.toString("base64")},1:${old.toString("base64")}`);
    expect(vaultRootKeys()[0].version).toBe(2);
    expect(openLegacyVaultEnvelope(legacy)).toBe("fixture-only");
    vi.stubEnv("VAULT_MASTER_KEYS", `1:${next.toString("base64")},1:${old.toString("base64")}`);
    expect(() => vaultRootKeys()).toThrow("Duplicate");
  });
  it("removes wrapped key material from the shared view transport", () => {
    expect(viewDto({ wrappedKey: "fixture-only", fingerprint: "public-fingerprint", version: 2 })).toEqual({ fingerprint: "public-fingerprint", version: 2 });
  });
  it("limits management to admins and excludes guests", () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER", "GUEST"] as const) {
      expect(canUseSecrets({ role })).toBe(role !== "GUEST");
      expect(canManageSecrets({ role })).toBe(["OWNER", "ADMIN"].includes(role));
    }
  });
  it("shows complete multiline changes and preserves unchanged context", () => {
    expect(lineDiff("first\nold\nlast", "first\nnew\nlast")).toEqual([{ kind: "same", text: "first" }, { kind: "remove", text: "old" }, { kind: "add", text: "new" }, { kind: "same", text: "last" }]);
  });
});
describe("Local secret scanner", () => {
  const fixtures = [
    ["AWS access key", "AKIA" + "A".repeat(16)],
    ["GitHub token", "ghp_" + "b".repeat(36)],
    ["Slack token", "xoxb-" + "1234-".repeat(8)],
    ["Stripe key", "sk_" + "test_" + "c".repeat(24)],
    ["Google API key", "AIza" + "d".repeat(35)],
    ["Private key", "-----BEGIN " + "PRIVATE KEY-----"],
    ["JWT", "eyJ" + "a".repeat(10) + "." + "b".repeat(12) + "." + "c".repeat(20)],
    ["High entropy assignment", "TOKEN=" + "aZ2rN9+xQ4/wE7=sU1.cT5-mV8"],
  ];
  it.each(fixtures)("detects %s without returning the matched value", (name, value) => {
    const findings = detectSecrets("safe\n" + value, "fixture.txt");
    expect(findings.some(f => f.detector === name && f.line === 2)).toBe(true);
    expect(JSON.stringify(findings)).not.toContain(value);
    expect(detectSecrets(value, "fixture.txt", new Set(findings.map(f => f.fingerprint)))).toHaveLength(0);
  });
  it.each(["", "RSA ", "EC ", "OPENSSH ", "DSA ", "ENCRYPTED "])("fingerprints each %sprivate key body without exposing values", async format => {
    const header = `-----BEGIN ${format}PRIVATE KEY-----`;
    const end = `-----END ${format}PRIVATE KEY-----`;
    const first = `${header}\n${"A".repeat(64)}\n${end}`;
    const second = `${header}\n${"B".repeat(64)}\n${end}`;
    const accepted = detectSecrets(first, "keys.pem")[0].fingerprint;
    // The fingerprint is independent of surrounding text and stops at END.
    const content = `safe\n${first}\n${second}\nsafe`;
    const findings = detectSecrets(content, "keys.pem", new Set([accepted]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({ file: "keys.pem", line: 5, detector: "Private key", fingerprint: detectSecrets(second, "other.pem")[0].fingerprint });
    expect(JSON.stringify(findings)).not.toContain(header);
    expect(JSON.stringify(findings)).not.toContain("B".repeat(64));
    const directory = await mkdtemp(join(tmpdir(), "sww-pem-")), previous = process.cwd();
    const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      execFileSync("git", ["init", directory], { stdio: "ignore" });
      process.chdir(directory);
      await writeFile("keys.pem", content);
      await writeFile(".swwignore", `fingerprint:${accepted}\n`);
      expect(await scanCommand(undefined, { silent: true })).toBe(1);
      expect(output).toHaveBeenCalledTimes(1);
      expect(output.mock.calls[0][0]).toContain(findings[0].fingerprint);
      expect(output.mock.calls[0][0]).not.toContain(header);
      expect(output.mock.calls[0][0]).not.toContain("B".repeat(64));
    } finally { process.chdir(previous); await rm(directory, { recursive: true, force: true }); }
  });
  it("bounds PEM bodies and never joins separate private keys", () => {
    const header = "-----BEGIN " + "PRIVATE KEY-----", end = "-----END " + "PRIVATE KEY-----";
    const complete = `${header}\nfixture-body\n${end}`;
    const bare = detectSecrets(header, "key.pem")[0].fingerprint;
    expect(detectSecrets(`${header}\n${"A".repeat(65537)}\n${end}`, "key.pem")[0].fingerprint).toBe(bare);
    expect(detectSecrets(`${header}\ntruncated\n${complete}`, "key.pem").map(f => f.fingerprint)).toEqual([bare, detectSecrets(complete, "key.pem")[0].fingerprint]);
  });
  it("includes the full PEM body with Windows line endings in its fingerprint", () => {
    const pem = (body: string) => `-----BEGIN PRIVATE KEY-----\r\n${body}\r\n-----END PRIVATE KEY-----`;
    const first = pem("A".repeat(64)), second = pem("B".repeat(64));
    const accepted = detectSecrets(first, "key.pem")[0].fingerprint;
    const findings = detectSecrets(`${first}\r\n${second}\r\n`, "keys.pem", new Set([accepted]));
    expect(findings).toEqual([{ file: "keys.pem", line: 4, detector: "Private key", fingerprint: detectSecrets(second, "key.pem")[0].fingerprint }]);
    expect(JSON.stringify(findings)).not.toContain("B".repeat(64));
  });
  it("scans staged content and preserves existing pre-commit hooks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sww-scan-")), previous = process.cwd();
    const output = vi.spyOn(process.stdout, "write").mockReturnValue(true); vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      execFileSync("git", ["init", directory], { stdio: "ignore" });
      process.chdir(directory);
      const finding = "AKIA" + "A".repeat(16);
      await writeFile("config.txt", finding); execFileSync("git", ["add", "config.txt"]);
      await writeFile("config.txt", "safe working copy");
      expect(await scanCommand(undefined, { staged: true, silent: true })).toBe(1);
      expect(output.mock.calls.flat().join("")).not.toContain(finding);
      await mkdir(".git/hooks", { recursive: true }); await writeFile(".git/hooks/pre-commit", "#!/bin/sh\necho existing-hook\nexit 0\n");
      expect(await scanCommand("install", { "pre-commit": true })).toBe(0);
      const hook = await readFile(".git/hooks/pre-commit", "utf8"); expect(hook).toContain("echo existing-hook"); expect(hook.indexOf("sww scan --staged")).toBeLessThan(hook.indexOf("exit 0"));
      await scanCommand("install", { "pre-commit": true }); expect(await readFile(".git/hooks/pre-commit", "utf8")).toBe(hook);
      const fingerprints = detectSecrets(finding, "config.txt"); await writeFile(".swwignore", "fingerprint:" + fingerprints[0].fingerprint + "\n");
      expect(await scanCommand(undefined, { staged: true, silent: true })).toBe(0);
    } finally { process.chdir(previous); await rm(directory, { recursive: true, force: true }); }
  });
  it.each(["#!/usr/bin/env python3", "#!/usr/bin/node", "#!/usr/bin/env ruby"])("refuses %s hooks without changing their contents or permissions", async shebang => {
    const directory = await mkdtemp(join(tmpdir(), "sww-hook-")), previous = process.cwd();
    const { stat } = await import("node:fs/promises");
    try {
      execFileSync("git", ["init", directory], { stdio: "ignore" });
      process.chdir(directory);
      const hook = ".git/hooks/pre-commit", original = shebang + "\n# Existing hook\n";
      await writeFile(hook, original, { mode: 0o700 });
      const mode = (await stat(hook)).mode;
      await expect(scanCommand("install", { "pre-commit": true })).rejects.toThrow("unsupported interpreter");
      expect(await readFile(hook, "utf8")).toBe(original);
      expect((await stat(hook)).mode).toBe(mode);
    } finally { process.chdir(previous); await rm(directory, { recursive: true, force: true }); }
  });
  it("detects high-entropy JSON credential assignments", () => {
    const value = "aZ2rN9+xQ4/wE7=sU1.cT5-mV8";
    expect(detectSecrets(JSON.stringify({ apiKey: value }), "fixture.json").some(f => f.detector === "High entropy assignment")).toBe(true);
  });
  it("ignores ordinary assignments, binary files and configured paths", () => {
    expect(detectSecrets("TOKEN=replace-me\nCOUNT=123\nDESCRIPTION=ordinary-office-setting", "a")).toEqual([]);
    expect(detectSecrets("\0" + fixtures[0][1], "binary")).toEqual([]);
    expect(ignoredPath("nested/node_modules/a.js", ["node_modules/"])).toBe(true);
    expect(ignoredPath("tests/fixtures/a.txt", ["tests/fixtures/**"])).toBe(true);
    expect(ignoredPath("src/a.ts", ["tests/**"])).toBe(false);
  });
});
describe("Universal auth CLI parity", () => {
  it("accepts aliases, interactive no-browser login and dotenv format", () => {
    expect(parseArguments(["login", "-i", "--domain=example.org", "--projectId", "p", "--plain", "--silent"]).flags).toEqual({ "no-open": true, domain: "example.org", projectId: "p", plain: true, silent: true });
    expect(formatValues({ KEY: "fixture" }, "dotenv")).toBe('KEY="fixture"\n');
  });
  it("prints only an access token for CI and honours SWW_DOMAIN", async () => {
    vi.stubEnv("SWW_DOMAIN", "https://workspace.example.org");
    const fetcher = vi.fn().mockResolvedValue(Response.json({ accessToken: "fixture-access", expiresIn: 7200 }));
    vi.stubGlobal("fetch", fetcher);
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true), err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(await main(["login", "--method=universal-auth", "--client-id=fake-id", "--client-secret=fake-secret", "--plain", "--silent"])).toBe(0);
    expect(out).toHaveBeenCalledExactlyOnceWith("fixture-access\n"); expect(err).not.toHaveBeenCalled();
    expect(String(fetcher.mock.calls[0][0])).toContain("https://workspace.example.org/api/v1/auth/universal/login");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ clientId: "fake-id", clientSecret: "fake-secret" });
  });
});
