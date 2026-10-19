import { describe, expect, it } from "vitest";
import {
  decodeForEditing,
  encodeMentions,
  extractChannelLinks,
  extractTaskRefs,
  extractUserMentions,
  hasBroadcastMention,
  normalizeBody,
  preview,
  sanitizeTokens,
  toPlainText,
  triggerAt,
} from "@/lib/chat/text";

describe("message text", () => {
  it("normalises bodies", () => {
    expect(normalizeBody("  hi\r\nthere \u0000​\n\n\n\n\nend  ")).toBe("hi\nthere\n\n\nend");
  });

  it("extracts mentions and channel links outside code only", () => {
    const body = "hey <@u1> <@u2> <@u1> see <#c1> `<@u3>`\n```\n<@u4> <#c2>\n```";
    expect(extractUserMentions(body)).toEqual(["u1", "u2"]);
    expect(extractChannelLinks(body)).toEqual(["c1"]);
  });

  it("detects broadcasts outside code", () => {
    expect(hasBroadcastMention("heads up <!channel>")).toBe(true);
    expect(hasBroadcastMention("`<!here>` is the syntax")).toBe(false);
  });

  it("encodes picked mentions, longest name first, and broadcasts", () => {
    const encoded = encodeMentions("@Meera Nair and @Meera, @everyone and @here! email@Meera.org", [
      { id: "u2", name: "Meera" },
      { id: "u1", name: "Meera Nair" },
    ]);
    expect(encoded).toBe("<@u1> and <@u2>, <!channel> and <!here>! email@Meera.org");
  });

  it("decodes tokens back for editing", () => {
    const { text, mentions } = decodeForEditing("hi <@u1> <@gone> in <#c1> <!here>", { u1: "Meera Nair" }, { c1: "general" });
    expect(text).toBe("hi @Meera Nair @unknown in #general @here");
    expect(mentions).toEqual([{ id: "u1", name: "Meera Nair" }]);
    expect(encodeMentions(text, mentions)).toContain("<@u1>");
  });

  it("sanitises tokens on the server", () => {
    const out = sanitizeTokens("<@u1> <@intruder> <!channel> <#c1> <#c2> #general #nope (#hardware) a#b `#general`", {
      memberIds: new Set(["u1"]),
      allowBroadcast: false,
      channelIds: new Set(["c1"]),
      channelSlugs: new Map([["general", "c1"], ["hardware", "c3"]]),
    });
    expect(out).toBe("<@u1> @unknown @channel <#c1> #unknown-channel <#c1> #nope (<#c3>) a#b `#general`");
  });

  it("finds task references but not inside URLs or code", () => {
    expect(extractTaskRefs("BOT-12 and HW-3, https://x.org/ABC-9 `XY-1` BOT-12")).toEqual([
      { key: "BOT", number: 12 },
      { key: "HW", number: 3 },
    ]);
  });

  it("makes plain text and previews", () => {
    expect(toPlainText("**Hi** <@u1>, see [docs](https://x.org) in <#c1> `code`", { u1: "Meera" }, { c1: "general" })).toBe("Hi @Meera, see docs in #general code");
    expect(preview("a ".repeat(100), 20)).toMatch(/…$/);
    expect(preview("short")).toBe("short");
  });

  it("finds the autocomplete trigger at the caret", () => {
    expect(triggerAt("hello @me", 9)).toEqual({ trigger: "@", query: "me", start: 6 });
    expect(triggerAt("@Meera N", 8)).toEqual({ trigger: "@", query: "Meera N", start: 0 });
    expect(triggerAt("see #gen", 8)).toEqual({ trigger: "#", query: "gen", start: 4 });
    expect(triggerAt("email@x", 7)).toBeNull();
    expect(triggerAt("no trigger", 10)).toBeNull();
  });
});
