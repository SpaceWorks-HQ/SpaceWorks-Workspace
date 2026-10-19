import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { verifySlack, verifyDiscord, verifySha256, verifyToken } from "@/lib/messaging/signatures";
import { formatSlackMessage, chunkEscaped } from "@/lib/messaging/format/slack";
import { formatDiscordMessage } from "@/lib/messaging/format/discord";
import { escapeTelegramHtml, escapeMattermostMarkdown } from "@/lib/messaging/format/escape";
import { truncateEscaped } from "@/lib/messaging/format/message";
import { newLinkCode } from "@/lib/messaging/linking";
import { sha256Hex, encryptSecret } from "@/lib/crypto";
import { normalizeInbound } from "@/lib/messaging/inbound";
import { telegramAdapter } from "@/lib/notify/adapters/telegram";
import { webhookAdapter } from "@/lib/notify/adapters/webhook";
import { discordAdapter } from "@/lib/notify/adapters/discord";
import { slackAdapter } from "@/lib/notify/adapters/slack";
import { mattermostAdapter } from "@/lib/notify/adapters/mattermost";
import type { AdapterSendInput } from "@/lib/notify/adapters/types";
import type { RenderedMessage } from "@/lib/notify/types";
const now = 1792404000000;
const timestamp = String(now / 1000);
const body = '{"event":"message","text":"Hi 🌿"}';
const secret = "a-test-signing-secret";
const message: RenderedMessage = { title: "Build <night> & crew", text: "<script>@everyone & hello</script>", url: "https://workspace.example.org/w/makers", severity: "warning", severityLabel: "Warning", fields: [{ label: "Bench", value: "<laser>" }], actions: [], eventType: "monitor.down", workspace: { id: "w1", name: "Space Works", slug: "makers" } };
const fetchMock = vi.fn<typeof fetch>();
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); fetchMock.mockReset(); });
function input(kind: "SLACK" | "DISCORD" | "TELEGRAM" | "MATTERMOST" | "WEBHOOK"): AdapterSendInput {
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", Buffer.alloc(32, 6).toString("base64"));
  const provider = kind === "WEBHOOK" ? "SLACK" : kind;
  const connection = { id: "c1", workspaceId: "w1", provider, status: "ACTIVE", lastVerifiedAt: new Date(), credentialsEnc: encryptSecret("messaging-credentials", JSON.stringify({ botToken: "test-token", webhookSecret: "test-secret" })), config: { serverUrl: "https://mattermost.example.org" } };
  return { deliveryId: "d1", event: { id: "e1", type: "monitor.down" }, message, isTest: true, thread: null, target: { type: "destination", destination: { id: "dest1", name: "Crew", kind, connection, config: kind === "TELEGRAM" ? { chatId: "123" } : { mode: "bot", channelId: kind === "DISCORD" ? "123456789" : "C123" }, secretEnc: null } } } as unknown as AdapterSendInput;
}
describe("provider signatures", () => {
  it("verifies Slack v0 over exact UTF-8 bytes", () => {
    const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
    expect(verifySlack(secret, body, timestamp, signature, now)).toBe(true);
    expect(verifySlack(secret, body + " ", timestamp, signature, now)).toBe(false);
    expect(verifySlack(secret, body, timestamp, signature, now + 301000)).toBe(false);
    expect(verifySlack(secret, body, null, signature, now)).toBe(false);
  });
  it("matches the published Slack request vector", () => {
    const vector = "token=xyzz0WbapXh1234567&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSSB5BP&channel_name=foobar&user_id=U2U3N4C5S&user_name=roadrunner&command=%2Fweather&text=94070&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F1234567890%2Fabc&trigger_id=12345.98765.abcdef235522";
    const signature = `v0=${createHmac("sha256", "8f742231b10e8888abcd99yyyzzz85a5").update(`v0:1531420618:${vector}`).digest("hex")}`;
    expect(verifySlack("8f742231b10e8888abcd99yyyzzz85a5", vector, "1531420618", signature, 1531420618000)).toBe(true);
  });
  it("verifies Discord Ed25519 signatures and rejects tampering and stale requests", () => {
    const keys = generateKeyPairSync("ed25519");
    const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
    const signature = sign(null, Buffer.from(timestamp + body), keys.privateKey).toString("hex");
    expect(verifyDiscord(publicKey, body, timestamp, signature, now)).toBe(true);
    expect(verifyDiscord(publicKey, body + "x", timestamp, signature, now)).toBe(false);
    expect(verifyDiscord(publicKey, body, timestamp, signature, now + 301000)).toBe(false);
    expect(verifyDiscord("bad", body, timestamp, signature, now)).toBe(false);
  });
  it.each(["WhatsApp", "GitHub"])("verifies %s SHA-256 webhook signatures", () => {
    const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    expect(verifySha256(secret, body, signature)).toBe(true);
    expect(verifySha256(secret, body + "x", signature)).toBe(false);
    expect(verifySha256("", body, signature)).toBe(false);
  });
  it.each(["Telegram", "Mattermost"])("verifies %s tokens and fails closed", () => {
    expect(verifyToken(secret, secret)).toBe(true);
    expect(verifyToken(secret, secret + "x")).toBe(false);
    expect(verifyToken(undefined, "")).toBe(false);
  });
});
describe("provider formatting and limits", () => {
  it("renders Slack Block Kit, neutralises mentions and includes the test marker", () => {
    const result = formatSlackMessage(message, { isTest: true });
    expect(result.text).toContain("[Test]");
    expect(JSON.stringify(result.blocks)).toContain("&lt;night&gt;");
    expect(JSON.stringify(result.blocks)).not.toContain("<script>");
    expect(result.blocks.length).toBeLessThanOrEqual(50);
  });
  it("keeps Slack text chunks within the provider limit without broken entities", () => {
    const chunks = chunkEscaped("&amp;".repeat(1500));
    expect(chunks.every(c => c.length <= 3000)).toBe(true);
    expect(chunks.join("")).toBe("&amp;".repeat(1500));
  });
  it("keeps Discord embed fields and total text within limits and never allows mentions", () => {
    const result = formatDiscordMessage({ ...message, text: "<@123>".repeat(5000), fields: Array.from({ length: 40 }, () => ({ label: "N".repeat(500), value: "V".repeat(2000) })) });
    expect(result.allowed_mentions.parse).toEqual([]);
    const embed = result.embeds[0];
    const total = embed.title.length + (embed.description?.length ?? 0) + embed.footer.text.length + (embed.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
    expect(total).toBeLessThanOrEqual(6000);
    expect(embed.fields!.length).toBeLessThanOrEqual(25);
  });
  it("escapes Telegram HTML and truncates complete entities", () => {
    expect(escapeTelegramHtml('<b>&"')).toBe('&lt;b&gt;&amp;"');
    expect(truncateEscaped("abcd&amp;tail", 8)).not.toMatch(/&[a-z]+…$/);
  });
  it("neutralises Mattermost broad mentions", () => {
    expect(escapeMattermostMarkdown("@everyone @here @channel")).not.toContain("@everyone");
  });
  it("uses Telegram HTML parse mode and bounded text", async () => {
    const data = input("TELEGRAM"); data.message = { ...message, text: "<>&".repeat(10000) };
    vi.stubGlobal("fetch", fetchMock.mockResolvedValue(Response.json({ ok: true, result: { message_id: 42 } })));
    expect(await telegramAdapter.send(data)).toMatchObject({ ok: true, providerMessageId: "42" });
    const payload = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(payload.parse_mode).toBe("HTML"); expect(payload.text.length).toBeLessThanOrEqual(4096); expect(payload.text).not.toContain("<script>");
  });
  it.each(["SLACK", "DISCORD", "MATTERMOST"] as const)("sends %s bot messages with mocked fetch", async kind => {
    const data = input(kind); vi.stubEnv("ALLOW_PRIVATE_WEBHOOK_TARGETS", "true");
    vi.stubGlobal("fetch", fetchMock.mockImplementation(async () => Response.json({ ok: true, ts: "1.2", id: "42" })));
    const adapter = { SLACK: slackAdapter, DISCORD: discordAdapter, MATTERMOST: mattermostAdapter }[kind];
    expect(await adapter.send(data)).toMatchObject({ ok: true }); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("signs generic webhooks over the timestamp and exact body", async () => {
    const data = input("WEBHOOK"); vi.stubEnv("ALLOW_PRIVATE_WEBHOOK_TARGETS", "true");
    if (data.target.type === "destination") data.target.destination.secretEnc = encryptSecret("notification-secrets", JSON.stringify({ webhookUrl: "https://hooks.example.org/secret", signingSecret: secret }));
    vi.stubGlobal("fetch", fetchMock.mockResolvedValue(new Response(null, { status: 204 })));
    expect(await webhookAdapter.send(data)).toEqual({ ok: true });
    const init = fetchMock.mock.calls[0]![1]!; const headers = init.headers as Record<string, string>;
    expect(headers["X-SpaceWorks-Signature"]).toBe(`v1=${createHmac("sha256", secret).update(`${headers["X-SpaceWorks-Timestamp"]}.${init.body}`).digest("hex")}`);
  });
});
describe("inbound normalisation and linking capabilities", () => {
  it("generates high-entropy, hashed, ten-minute link codes", () => {
    const start = Date.now(); const a = newLinkCode(); const b = newLinkCode();
    expect(a.codeHash).toBe(sha256Hex(a.code)); expect(a.codeHash).not.toContain(a.code); expect(a.code).not.toBe(b.code); expect(a.expiresAt.getTime() - start).toBeGreaterThanOrEqual(599000);
  });
  it("normalises Slack DMs and marks bot echoes", () => {
    expect(normalizeInbound("SLACK", { event_id: "1", event: { type: "message", channel: "D1", user: "U1", ts: "1", text: "hello", bot_id: "B1" } })[0]).toMatchObject({ private: true, bot: true });
  });
  it("normalises Discord post commands for channel bridges", () => {
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", Buffer.alloc(32, 6).toString("base64"));
    expect(normalizeInbound("DISCORD", { type: 2, id: "1", guild_id: "guild", channel_id: "123456", application_id: "app", token: "interaction-test", member: { user: { id: "member" } }, data: { name: "post", options: [{ value: "Build-night update" }] } })[0]).toMatchObject({ text: "Build-night update", mention: false, private: false });
  });
  it("normalises Telegram commands and WhatsApp texts", () => {
    expect(normalizeInbound("TELEGRAM", { update_id: 1, message: { message_id: 2, from: { id: 3 }, chat: { id: 3, type: "private" }, text: "/link abc" } })[0]).toMatchObject({ private: true, mention: true, eventId: "1" });
    expect(normalizeInbound("WHATSAPP", { entry: [{ changes: [{ value: { messages: [{ id: "m1", from: "919999999999", type: "text", text: { body: "hello" } }] } }] }] })[0]).toMatchObject({ eventId: "m1", private: true });
  });
});
