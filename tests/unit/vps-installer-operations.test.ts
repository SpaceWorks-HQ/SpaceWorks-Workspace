import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { root, lib } from "./vps-installer-fixtures";

describe("VPS installer operations", () => {
  it("redacts structured credentials and bearer capabilities from support logs", () => {
    const source = readFileSync(path.join(root, "scripts/vps-support.sh"), "utf8");
    const fn = source.slice(source.indexOf("redact() {"), source.indexOf("\nsection()"));
    const result = spawnSync("bash", ["-c", `${fn}\nredact`], {
      encoding: "utf8", input: 'password=plain-value {"smtpPassword":"json-value","apiKey": "json-key"} Authorization: Bearer bearer-value https://u:url-pass@example.test /reset-password/reset-value ?ticket=ticket-value',
    });
    expect(result.status).toBe(0);
    for (const secret of ["plain-value", "json-value", "json-key", "bearer-value", "url-pass", "reset-value", "ticket-value"]) expect(result.stdout).not.toContain(secret);
    expect(result.stdout).toContain("REDACTED");
  });
  it("offers every operator tool from the installer menu, each shipped with the release", () => {
    const installer = readFileSync(path.join(root, "install.sh"), "utf8");
    expect(installer).toContain("Choose 0-10 [0]");
    for (const script of ["vps-backup.sh", "vps-status.sh", "vps-backup-settings.sh", "vps-reconfigure.sh", "vps-harden.sh",
      "install-runner.sh", "vps-recover.sh", "vps-support.sh", "vps-uninstall.sh"]) {
      expect(installer).toContain(`run_tool ${script}`);
      expect(statSync(path.join(root, "scripts", script)).isFile()).toBe(true);
    }
    // A fork installs by answering one question instead of passing --repo.
    expect(installer).toContain("Install from which GitHub repository?");
  });

  it("encodes off-site credentials and validates backup settings", () => {
    expect(lib("urlencode 'ab/c+d=e f'").stdout).toBe("ab%2Fc%2Bd%3De%20f");
    for (const [check, good, bad] of [
      ["is_days", "14", "0"], ["is_prefix", "spaceworks-workspace", "a/b"],
      ["is_https_endpoint", "https://acct.r2.cloudflarestorage.com", "http://bucket.example.com"],
    ] as const) {
      expect(lib(`${check} '${good}'`).status).toBe(0);
      expect(lib(`${check} '${bad}'`).status).not.toBe(0);
    }
    const backup = readFileSync(path.join(root, "scripts/vps-backup.sh"), "utf8");
    // Encrypted backups keep only the version and kind readable, and only encrypted ones leave the server.
    expect(backup).toContain('age --encrypt --recipient "$recipient"');
    // The archive is written into the folder it archives: it must skip itself.
    expect(backup).toContain("--exclude=./backup.tar.age .");
    expect(backup).toContain("Off-site copies need encrypted backups");
    expect(backup).toContain('"lastFullSuccessAt"');
    const restore = readFileSync(path.join(root, "scripts/vps-restore.sh"), "utf8");
    expect(restore).toContain('mktemp -d "$SWW_CONFIG_DIR/backups/.restore.XXXXXX"');
    expect(readFileSync(path.join(root, "scripts/vps-lib.sh"), "utf8")).not.toMatch(/AGE-SECRET-KEY.*>\s*"?\$/m);
  });

  it("renews internal certificates only when they are due", { timeout: 30_000 }, () => {
    const directory = mkdtempSync(path.join(tmpdir(), "sww-renew-"));
    try {
      const run = (...args: string[]) => spawnSync(process.execPath, ["docker/vps/setup.mjs", ...args], { cwd: root, env: { ...process.env, SWW_SETUP_CONFIG_DIR: directory }, encoding: "utf8" });
      expect(run("workspace.example.com", "admin@example.com", "vps-0123456789ab").status).toBe(0);
      const before = readFileSync(path.join(directory, "tls/postgres/public.crt"), "utf8");
      const due = run("renew-certificates", "--if-due");
      expect(due.status).toBe(10);
      expect(due.stdout).toContain("renewal is not due");
      expect(readFileSync(path.join(directory, "tls/postgres/public.crt"), "utf8")).toBe(before);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    expect(readFileSync(path.join(root, "scripts/vps-lib.sh"), "utf8")).toContain("vps-renew-certs.sh --if-due");
  });
});
