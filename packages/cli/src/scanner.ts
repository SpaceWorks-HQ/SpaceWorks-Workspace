import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, lstat, realpath } from "node:fs/promises";
import { resolve, relative, dirname, isAbsolute } from "node:path";
export type Finding = { file: string; line: number; detector: string; fingerprint: string };
const detectors: [string, RegExp][] = [
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})\b/g],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,255}\b/g],
  ["Stripe key", /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,255}\b/g],
  ["Google API key", /\bAIza[A-Za-z0-9_-]{35}\b/g],
  // Include complete PEM blocks (up to 64 KiB), without crossing another header.
  ["Private key", /-----BEGIN ((?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY)-----(?:(?:(?!-----BEGIN )[\s\S]){1,65536}?^-----END \1-----(?=\r?$))?/gm],
  ["JWT", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}\b/g],
];
export function entropy(value: string) {
  const counts = new Map<string, number>();
  for (const c of value) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.values()].reduce((sum, n) => sum - n / value.length * Math.log2(n / value.length), 0);
}
export function detectSecrets(content: string, file: string, accepted = new Set<string>()): Finding[] {
  if (content.includes("\0")) return [];
  const findings: Finding[] = [];
  const add = (detector: string, value: string, index: number) => {
    const fingerprint = createHash("sha256").update(detector + "\0" + value).digest("hex");
    if (!accepted.has(fingerprint) && !findings.some(f => f.fingerprint === fingerprint)) findings.push({ file, line: content.slice(0, index).split("\n").length, detector, fingerprint });
  };
  for (const [name, pattern] of detectors) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) add(name, match[0], match.index!);
  }
  const assignment = /\b[A-Za-z0-9_]*(?:secret|token|password|api_?key|credential)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?([A-Za-z0-9+/_=.-]{20,})/gi;
  for (const match of content.matchAll(assignment)) if (entropy(match[1]) >= 3.7) add("High entropy assignment", match[1], match.index!);
  return findings;
}
export function ignoredPath(file: string, patterns: string[]) {
  return patterns.some(pattern => {
    const expression = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\x01").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\x01/g, ".*");
    return new RegExp("^(?:" + (pattern.replace(/\/$/, "").includes("/") ? "" : ".*/") + ")?" + expression + (pattern.endsWith("/") ? ".*" : "") + "$", "u").test(file);
  });
}
function git(args: string[], cwd: string) {
  try { return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }); } catch { throw new Error("Git could not read the requested files. Check this repository and scan limits."); }
}
export async function scanCommand(sub: string | undefined, flags: Record<string, string | boolean>) {
  const cwd = process.cwd(), root = git(["rev-parse", "--show-toplevel"], cwd).trim();
  if (sub === "install") {
    if (!flags["pre-commit"]) throw new Error("Use scan install --pre-commit.");
    const hook = resolve(root, git(["rev-parse", "--git-path", "hooks/pre-commit"], root).trim());
    await mkdir(dirname(hook), { recursive: true });
    const marker = "# Space Works secret scanning";
    let current = "#!/bin/sh\n";
    try { if ((await lstat(hook)).isSymbolicLink()) throw new Error("Use a pre-commit hook without symbolic links."); current = await readFile(hook, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (current.startsWith("#!") && !/^#!\s*(?:\/(?:[^\s/]+\/)*(?:sh|bash|dash|ksh|zsh)|\/usr\/bin\/env\s+(?:sh|bash|dash|ksh|zsh))(?:\s|$)/.test(current.split("\n", 1)[0]))
      throw new Error("The existing pre-commit hook uses an unsupported interpreter. Add sww scan --staged to a shell hook manually.");
    if (!current.includes(marker)) {
      // Prepend after the shebang so an existing early exit cannot bypass scanning.
      const first = current.startsWith("#!") ? current.indexOf("\n") + 1 : 0;
      await writeFile(hook, current.slice(0, first) + marker + "\nsww scan --staged || exit $?\n" + current.slice(first), { mode: 0o755 });
      const { chmod } = await import("node:fs/promises"); await chmod(hook, 0o755);
    }
    process.stderr.write("Installed pre-commit secret scan.\n"); return 0;
  }
  if (sub) throw new Error("Use scan or scan install --pre-commit.");
  let ignore = "";
  try { ignore = await readFile(resolve(root, ".swwignore"), "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const lines = ignore.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith("#"));
  const accepted = new Set(lines.filter(s => s.startsWith("fingerprint:")).map(s => s.slice(12)));
  const patterns = ["node_modules/", ".git/", ".next/", "dist/", ...lines.filter(s => !s.startsWith("fingerprint:"))];
  const findings: Finding[] = [];
  const scan = (file: string, content: string) => { if (!ignoredPath(file, patterns)) findings.push(...detectSecrets(content, file, accepted)); };
  if (flags.history) {
    const revisions = git(["rev-list", "--all"], root).trim().split("\n").filter(Boolean);
    for (const revision of revisions) {
      const files = git(["ls-tree", "-r", "--name-only", "-z", revision], root).split("\0").filter(Boolean);
      for (const file of files) if (!ignoredPath(file, patterns)) scan(revision.slice(0, 12) + ":" + file, git(["show", revision + ":" + file], root));
    }
  } else {
    const files = git(flags.staged ? ["diff", "--cached", "--name-only", "--diff-filter=ACMRT", "-z"] : ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], root).split("\0").filter(Boolean);
    for (const file of files) {
      if (ignoredPath(file, patterns)) continue;
      if (flags.staged) { const mode = git(["ls-files", "--stage", "--", file], root).slice(0, 6); if (mode === "120000" || mode === "160000") continue; scan(file, git(["show", ":" + file], root)); }
      else {
        const target = resolve(root, file), rel = relative(root, target);
        if (rel.startsWith("..") || isAbsolute(rel)) continue;
        try { const stat = await lstat(target); if (!stat.isFile() || stat.isSymbolicLink()) continue; const actual = relative(root, await realpath(target)); if (actual.startsWith("..") || isAbsolute(actual)) continue; if (stat.size > 64 * 1024 * 1024) throw new Error("A file exceeds the scan limit. Add it to .swwignore or scan it separately."); scan(file, await readFile(target, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
    }
  }
  // Never print matched content, including in diagnostics or fingerprints.
  for (const finding of findings) process.stdout.write(`${JSON.stringify(finding.file)}:${finding.line} ${finding.detector} fingerprint:${finding.fingerprint}\n`);
  if (!flags.silent) process.stderr.write(findings.length ? `${findings.length} possible secrets found. Remove them or accept reviewed fingerprints in .swwignore.\n` : "No likely secrets found.\n");
  return findings.length ? 1 : 0;
}
