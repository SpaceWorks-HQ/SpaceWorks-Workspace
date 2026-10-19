import "server-only";
import type { MessagingConnection } from "@prisma/client";
import { openCredentials, connectionConfig } from "./credentials";
import { slackAuthTest } from "./api/slack";
import { getDiscordApplication, registerDiscordCommands } from "./api/discord";
import { getMattermostMe } from "./api/mattermost";
import { getTelegramMe, setTelegramWebhook } from "./api/telegram";
import { getWhatsAppPhoneNumber } from "./api/whatsapp";
import { prisma } from "@/lib/db";
export async function verifyConnection(connection: MessagingConnection) {
  let botExternalId = ""; let config: Record<string, unknown> = {};
  switch (connection.provider) {
    case "SLACK": {
      const credentials = openCredentials({ ...connection, provider: "SLACK" }); if (!credentials) throw new Error("Re-enter the Slack credentials.");
      const result = await slackAuthTest(credentials.botToken); if (!result.ok) throw new Error(result.error);
      botExternalId = result.data.user_id; config = { ...connectionConfig({ ...connection, provider: "SLACK" }), teamId: result.data.team_id, teamName: result.data.team, botUserId: botExternalId }; break;
    }
    case "DISCORD": {
      const credentials = openCredentials({ ...connection, provider: "DISCORD" }); const stored = connectionConfig({ ...connection, provider: "DISCORD" }); if (!credentials) throw new Error("Re-enter the Discord credentials.");
      const result = await getDiscordApplication(credentials.botToken); if (!result.ok) throw new Error(result.error);
      if (result.data.verify_key !== stored.publicKey) throw new Error("The public key does not match this Discord application.");
      const commands = [{ name: "post", description: "Share a message with the bridged Space Works channel", options: [{ name: "message", description: "Message to share", type: 3, required: true }] }, { name: "ask", description: "Ask the Space Works assistant", options: [{ name: "question", description: "Your question", type: 3, required: true }] }, { name: "link", description: "Link your Space Works account", options: [{ name: "code", description: "One-time link code", type: 3, required: true }] }, { name: "unlink", description: "Unlink your Space Works account" }];
      const registered = await registerDiscordCommands(credentials.botToken, result.data.id, commands, stored.guildId); if (!registered.ok) throw new Error(registered.error);
      botExternalId = result.data.bot?.id ?? result.data.id; config = { ...stored, applicationId: result.data.id, botUserId: botExternalId }; break;
    }
    case "MATTERMOST": {
      const credentials = openCredentials({ ...connection, provider: "MATTERMOST" }); const stored = connectionConfig({ ...connection, provider: "MATTERMOST" }); if (!credentials || !stored.serverUrl) throw new Error("Re-enter the Mattermost credentials and server URL.");
      const result = await getMattermostMe(stored.serverUrl, credentials.botToken); if (!result.ok) throw new Error(result.error);
      botExternalId = result.data.id; config = { ...stored, botUserId: result.data.id, botUsername: result.data.username }; break;
    }
    case "TELEGRAM": {
      const credentials = openCredentials({ ...connection, provider: "TELEGRAM" }); if (!credentials) throw new Error("Re-enter the Telegram credentials.");
      const result = await getTelegramMe(credentials.botToken); if (!result.ok) throw new Error(result.error);
      const base = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.AUTH_URL;
      if (!base || !base.startsWith("https://")) throw new Error("Set a public HTTPS base URL before verifying Telegram.");
      const registered = await setTelegramWebhook(credentials.botToken, `${base.replace(/\/$/, "")}/api/integrations/telegram/${connection.id}/events`, credentials.webhookSecret); if (!registered.ok) throw new Error(registered.error);
      botExternalId = String(result.data.id); config = { botId: botExternalId, botUsername: result.data.username }; break;
    }
    case "WHATSAPP": {
      const credentials = openCredentials({ ...connection, provider: "WHATSAPP" }); const stored = connectionConfig({ ...connection, provider: "WHATSAPP" }); if (!credentials || !stored.phoneNumberId) throw new Error("Re-enter the WhatsApp credentials and phone number id.");
      const result = await getWhatsAppPhoneNumber(credentials.accessToken, stored.phoneNumberId, stored.graphVersion); if (!result.ok) throw new Error(result.error);
      botExternalId = result.data.id; config = { ...stored, displayNumber: result.data.display_phone_number }; break;
    }
  }
  await prisma.messagingConnection.updateMany({ where: { id: connection.id, workspaceId: connection.workspaceId, updatedAt: connection.updatedAt }, data: { botExternalId, config: config as import("@prisma/client").Prisma.InputJsonValue, status: "ACTIVE", lastVerifiedAt: new Date(), lastError: null } });
}
