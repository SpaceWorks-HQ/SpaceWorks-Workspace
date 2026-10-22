import { describe, it, expect, vi } from "vitest";
import {
  parseDotenv,
  formatSecrets,
  resolveValue,
  createValueResolver,
  metadataDiff,
  normalisePath,
} from "@/lib/secrets/values";
import { canUseSecrets, canManageSecrets } from "@/lib/roles";
describe("application secret values", () => {
  it("parses comments, BOM, CRLF, escaped quotes and multiline values", () => {
    expect({
      ...parseDotenv(
        '\uFEFF# comment\r\nexport KEY="a\\nline \\"q\\"" # note\r\nMULTI=\'first\nsecond\'\nBARE=abc # end\nEMPTY=\n',
      ),
    }).toEqual({
      KEY: 'a\nline "q"',
      MULTI: "first\nsecond",
      BARE: "abc",
      EMPTY: "",
    });
  });
  it("round-trips env exports without expanding references", () => {
    const values = {
      NEWLINE: "a\nb",
      QUOTE: '"hello"',
      REFERENCE: "${OTHER}",
      EMPTY: "",
      BACKSLASH: "\\n",
    };
    expect({ ...parseDotenv(formatSecrets(values, "env")) }).toEqual(values);
    expect(JSON.parse(formatSecrets(values, "json"))).toEqual(values);
    expect(formatSecrets({ A: "x\ny" }, "yaml")).toBe('"A": "x\\ny"\n');
  });
  it.each([
    "lower=bad",
    "BAD-KEY=x",
    "1KEY=x",
    "A='unfinished",
    "A=1\nA=2",
    'A="x"trash',
    "A=\0",
  ])("rejects invalid input without repeating its content", (text) => {
    expect(() => parseDotenv(text)).toThrow();
  });
  it("validates bounded folder paths", () => {
    expect(normalisePath("/api/client")).toBe("/api/client");
    for (const p of ["../private", "//", "/a/../b", "/a."])
      expect(() => normalisePath(p)).toThrow();
  });
  it("resolves local and same-project cross-environment references", async () => {
    const values: Record<string, string> = {
      "dev:/:A": "${B}/${staging.api.C}",
      "dev:/:B": "base",
      "staging:/api:C": "suffix",
    };
    expect(
      await resolveValue(
        { environment: "dev", path: "/", key: "A" },
        async (l) => values[`${l.environment}:${l.path}:${l.key}`],
      ),
    ).toBe("base/suffix");
  });
  it("detects cycles and preserves loader access failures", async () => {
    await expect(
      resolveValue(
        { environment: "dev", path: "/", key: "A" },
        async () => "${A}",
      ),
    ).rejects.toThrow("cycle");
    await expect(
      resolveValue({ environment: "dev", path: "/", key: "A" }, async (l) => {
        if (l.environment === "production") throw new Error("denied");
        return "${production.TOKEN}";
      }),
    ).rejects.toThrow("denied");
  });
  it("memoizes duplicated reference trees and shares resolved targets within one read", async () => {
    const load = vi.fn(async (l: { key: string }) => {
      const level = Number(l.key.slice(1));
      return level ? ("${A" + (level - 1) + "}").repeat(2) : "";
    });
    // Empty leaves previously still caused over two million authorised loads.
    const resolve = createValueResolver(load);
    const location = { environment: "dev", path: "/", key: "A20" };
    expect(await resolve(location)).toBe("");
    expect(await resolve({ ...location, key: "A19" })).toBe("");
    expect(load).toHaveBeenCalledTimes(21);
    expect(await createValueResolver(load)(location)).toBe("");
    expect(load).toHaveBeenCalledTimes(42);
  });
  it("bounds total target visits even when repeated references expand to empty values", async () => {
    const load = vi.fn(async (l: { key: string }) => l.key === "ROOT" ? "${EMPTY}".repeat(10000) : "");
    await expect(resolveValue({ environment: "dev", path: "/", key: "ROOT" }, load)).rejects.toThrow("Secret reference expansion is too large. Use fewer or smaller references.");
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("bounds generated characters across all targets in a read", async () => {
    const resolve = createValueResolver(async () => "x".repeat(20000));
    for (let i = 0; i < 50; i++)
      expect(await resolve({ environment: "dev", path: "/", key: "KEY_" + i })).toHaveLength(20000);
    await expect(resolve({ environment: "dev", path: "/", key: "OVER_BUDGET" })).rejects.toThrow("Secret reference expansion is too large. Use fewer or smaller references.");
  });
  it("enforces depth limits through cached subtrees and keeps the per-value size limit", async () => {
    const resolve = createValueResolver(async l => {
      const level = Number(l.key.slice(1));
      return level ? "${A" + (level - 1) + "}" : "x";
    });
    expect(await resolve({ environment: "dev", path: "/", key: "A31" })).toBe("x");
    await expect(resolve({ environment: "dev", path: "/", key: "A32" })).rejects.toThrow("too deep");
    await expect(resolveValue({ environment: "dev", path: "/", key: "ROOT" }, async l =>
      l.key === "ROOT" ? "${LEAF}".repeat(11) : "x".repeat(20000),
    )).rejects.toThrow("The resolved value is too large.");
  });
  it("diffs names and operations only", () => {
    expect(
      metadataDiff(
        [{ path: "/", key: "OLD", fingerprint: "one" }],
        [{ path: "/", key: "NEW", fingerprint: "two" }],
      ),
    ).toEqual([
      { path: "/", key: "NEW", operation: "add" },
      { path: "/", key: "OLD", operation: "delete" },
    ]);
  });
  it("excludes guests and reserves project creation for admins", () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER", "GUEST"] as const) {
      expect(canUseSecrets({ role })).toBe(role !== "GUEST");
      expect(canManageSecrets({ role })).toBe(
        ["OWNER", "ADMIN"].includes(role),
      );
    }
  });
});
