import { describe, it, expect, vi } from "vitest";
import {
  buildSearchQuery,
  normaliseSearch,
  accessSql,
} from "@/lib/search/query";
import { notificationWhere } from "@/lib/shell/notifications";
import { retentionCutoff } from "@/lib/shell/retention";
import { redactExportRow, EXPORT_FIELDS } from "@/lib/shell/export";
import { verifiedOidcEmail } from "@/lib/shell/oidc";
import { parseCsv, mapLinkRows } from "@/lib/shell/csv";
import { jsonZip } from "@/lib/shell/zip";
import { resolvePersonalChannels } from "@/lib/notify/preferences";
import { safeWorkspaceUrl } from "@/lib/shell/context";
import { shellMessage } from "@/lib/shell/messages";
vi.mock("@/lib/permissions", () => ({ getWorkspaceForAction: vi.fn() }));
const actor = {
  workspaceId: "workspace",
  userId: "member",
  role: "MEMBER" as const,
};
describe("platform search", () => {
  it("normalises and limits input", () => {
    expect(normaliseSearch("  maker   night \n ")).toBe("maker night");
    expect(normaliseSearch("a".repeat(300))).toHaveLength(200);
  });
  it("binds hostile query strings as values", () => {
    const q = "'; DROP TABLE x; --";
    const sql = buildSearchQuery(actor, q);
    expect(sql.text).not.toContain(q);
    expect(sql.values).toContain(q);
    expect(sql.text).toContain("websearch_to_tsquery");
    expect(sql.text).toContain("similarity");
  });
  it("escapes wildcard characters for literal title matches", () => {
    expect(buildSearchQuery(actor, "50%_\\").values).toContain(
      "%50\\%\\_\\\\%",
    );
  });
  it("checks live membership and source record permissions", () => {
    const sql = accessSql(actor);
    for (const token of [
      '"Membership"',
      '"TeamMember"',
      '"Doc"',
      '"ChannelMember"',
      '"Project"',
      '"workspaceId"',
    ])
      expect(sql.text).toContain(token);
    expect(sql.values).toContain(actor.workspaceId);
    expect(sql.values).toContain(actor.userId);
  });
  it("clamps offsets", () => {
    expect(buildSearchQuery(actor, "maker", undefined, -20).values.at(-1)).toBe(
      0,
    );
    expect(buildSearchQuery(actor, "maker", undefined, 900).values.at(-1)).toBe(
      500,
    );
  });
});
describe("notification preferences and state", () => {
  it("scopes counts to the user, tenant and active archive state", () => {
    expect(notificationWhere("w", "u", { tab: "unread" })).toMatchObject({
      workspaceId: "w",
      userId: "u",
      archivedAt: null,
      readAt: null,
    });
  });
  it("combines mentions and category filters", () => {
    expect(
      notificationWhere("w", "u", { tab: "mentions", category: "tasks" }),
    ).toHaveProperty("id", { in: [] });
    expect(notificationWhere("w", "u", { category: "tasks" })).toHaveProperty(
      "kind",
      { in: expect.arrayContaining(["task.assigned"]) },
    );
  });
  it("resolves personal rows ahead of workspace defaults", () => {
    expect(
      resolvePersonalChannels({
        category: "tasks",
        role: "MEMBER",
        linkedProviders: [],
        userPreference: { channels: ["EMAIL"], digestFrequency: "DAILY" },
        workspaceDefault: {
          channels: ["TELEGRAM_DM"],
          digestFrequency: "HOURLY",
        },
      }),
    ).toEqual({ channels: ["IN_APP", "EMAIL"], digestFrequency: "DAILY" });
  });
  it("does not unlock unlinked messaging or guest DMs", () => {
    for (const role of ["GUEST", "MEMBER"] as const)
      expect(
        resolvePersonalChannels({
          category: "tasks",
          role,
          linkedProviders: [],
          userPreference: {
            channels: ["TELEGRAM_DM"],
            digestFrequency: "IMMEDIATE",
          },
        }).channels,
      ).toEqual(["IN_APP"]);
  });
  it("unlocks only linked messaging providers", () => {
    expect(
      resolvePersonalChannels({
        category: "tasks",
        role: "MEMBER",
        linkedProviders: ["TELEGRAM"],
        userPreference: {
          channels: ["TELEGRAM_DM", "SLACK_DM"],
          digestFrequency: "IMMEDIATE",
        },
      }).channels,
    ).toEqual(["IN_APP", "TELEGRAM_DM"]);
  });
});
describe("retention and redaction", () => {
  it("uses an exact elapsed-day cutoff", () => {
    expect(
      retentionCutoff(new Date("2026-10-19T12:00:00Z"), 30).toISOString(),
    ).toBe("2026-09-19T12:00:00.000Z");
  });
  it.each([0, -1, 1.5, 36501, NaN])("rejects invalid keep days %s", (days) => {
    expect(() => retentionCutoff(new Date(), days)).toThrow();
  });
  it("excludes unknown columns and unsupported sensitive models", () => {
    expect(
      redactExportRow("Monitor", {
        id: "m",
        name: "Maker",
        secretEnc: "secret",
        config: { password: "pw" },
        heartbeatTokenHash: "hash",
      }),
    ).toEqual({ id: "m", name: "Maker" });
    expect(
      redactExportRow("VaultItem", { title: "secret", secretEnc: "value" }),
    ).toEqual({});
    for (const fields of Object.values(EXPORT_FIELDS))
      for (const key of fields)
        expect(key).not.toMatch(/secret|password|token|emergency|credential/i);
  });
  it("writes a ZIP with a central directory and JSON payload", () => {
    const zip = jsonZip('{"space":"works"}');
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.toString()).toContain("workspace.json");
    expect(zip.toString()).toContain('{"space":"works"}');
  });
});
describe("OIDC invite-only claims", () => {
  const profile = {
    sub: "subject",
    email: " Maker@Example.org ",
    email_verified: true,
  };
  it("requires a verified email and non-empty subject", () => {
    expect(verifiedOidcEmail(profile, [])).toBe("maker@example.org");
    for (const invalid of [
      null,
      {},
      { ...profile, email_verified: "true" },
      { ...profile, email_verified: false },
      { ...profile, sub: "" },
    ])
      expect(verifiedOidcEmail(invalid, [])).toBeNull();
  });
  it("uses exact domains", () => {
    expect(verifiedOidcEmail(profile, ["example.org"])).toBe(
      "maker@example.org",
    );
    expect(
      verifiedOidcEmail({ ...profile, email: "m@otherexample.org" }, [
        "example.org",
      ]),
    ).toBeNull();
  });
});
describe("CSV imports", () => {
  it("parses quotes, commas, embedded newlines and BOM", () => {
    expect(
      parseCsv(
        '\uFEFFtitle,url\r\n"Maker, \"\"night\"\"",https://example.org\r\n"Two\nlines",https://example.org/two',
      ),
    ).toEqual([
      ["title", "url"],
      ['Maker, "night"', "https://example.org"],
      ["Two\nlines", "https://example.org/two"],
    ]);
  });
  it.each([
    "title,title\na,b",
    "title,url\na",
    'title,url\n"unfinished,b',
    'title,url\n"title"bad,url',
  ])("rejects malformed records", (text) => {
    expect(() => parseCsv(text)).toThrow();
  });
  it("maps and validates rows before any writes", () => {
    const rows = parseCsv(
      "Title,URL,Tags\nMaker,https://example.org,build;night\nBad,javascript:alert(1),",
    );
    const mapped = mapLinkRows(rows, {
      title: "Title",
      url: "URL",
      tags: "Tags",
    });
    expect(mapped[0].data?.tags).toEqual(["build", "night"]);
    expect(mapped[1].error).toBeTruthy();
  });
  it("rejects missing mapping columns", () => {
    expect(() =>
      mapLinkRows(
        [
          ["a", "b"],
          ["x", "y"],
        ],
        { title: "missing", url: "b" },
      ),
    ).toThrow();
  });
});
describe("shell safety", () => {
  it.each([
    "https://example.org",
    "//example.org",
    "/w/other/docs",
    "/w/maker\\evil",
    "/w/maker\nfoo",
  ])("rejects unsafe navigation %s", (url) => {
    expect(safeWorkspaceUrl(url, "maker")).toBeNull();
  });
  it("allows only the current workspace path", () => {
    expect(safeWorkspaceUrl("/w/maker/docs", "maker")).toBe("/w/maker/docs");
  });
  it("falls back to the English catalogue", () => {
    expect(shellMessage("fr-FR", "home")).toBe("My day");
  });
});
