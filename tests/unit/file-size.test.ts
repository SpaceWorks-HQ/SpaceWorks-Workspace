import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

// AGENTS.md: hand-written files stay at or below 300 lines. Generated
// output, the Prisma schema, migrations and lockfiles are exempt.
const MAX_LINES = 300;
const exempt = [
  /^frontend\//,
  /^lib\/views\/generated\//,
  /^lib\/frontend\/(registry|resources)\.ts$/,
  /^prisma\//,
  /^deploy\//,
  /^public\//,
  /\.d\.ts$/,
];

const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "*.ts", "*.tsx", "*.js", "*.mjs", "*.css"], { encoding: "utf8" })
  .split("\n")
  .filter((file) => file && existsSync(file) && !exempt.some((pattern) => pattern.test(file)));

const lineCount = (file: string) => readFileSync(file, "utf8").replace(/\n$/, "").split("\n").length;

describe("file size", () => {
  it.each(files)(`%s has at most ${MAX_LINES} lines`, (file) => {
    expect(lineCount(file)).toBeLessThanOrEqual(MAX_LINES);
  });
});
