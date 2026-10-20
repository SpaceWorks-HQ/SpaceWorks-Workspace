import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
// Commented-out markup is not rendered by GitHub, so it may name files that do not exist yet.
const readme = readFileSync(path.join(root, "README.md"), "utf8").replace(/<!--[\s\S]*?-->/g, "");

describe("README", () => {
  it("only references local images that exist", () => {
    const sources = [...readme.matchAll(/(?:src="|\]\()(?!https?:|#)([^")\s]+\.(?:png|webp|svg|jpe?g|gif))/g)].map((m) => m[1]);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.filter((source) => !existsSync(path.join(root, source)))).toEqual([]);
  });
});
