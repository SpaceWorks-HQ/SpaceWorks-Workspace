import "server-only";
import { prisma } from "@/lib/db";
import { runChatTurn, type ChatStreamEvent } from "@/lib/assistant/chat";
import type { Principal } from "@/lib/assistant/principal";
import type { MessagingAssistantInput } from "@/lib/integrations/assistant";

const MESSAGING_TITLE = "New conversation";

/**
 * One assistant turn for a linked Slack/Discord/Mattermost/Telegram/WhatsApp
 * user. The caller (lib/integrations/assistant.ts) has already checked the
 * membership and rate limit; this runs with the member's own role, and writes
 * still need confirmation, which only the web chat can give.
 */
export async function runMessagingTurn(input: MessagingAssistantInput): Promise<{ text: string; conversationId: string }> {
  const membership = await prisma.membership.findFirst({
    where: { workspaceId: input.workspaceId, userId: input.userId, status: "ACTIVE" },
    select: { role: true, user: { select: { name: true } }, workspace: { select: { id: true, slug: true, name: true, timezone: true, currency: true, financeVisibleToMembers: true } } },
  });
  if (!membership) throw new Error("Your workspace access has changed. Contact an admin.");

  const principal: Principal = { kind: "user", workspace: membership.workspace, userId: input.userId, userName: membership.user.name, role: membership.role };
  const conversationId =
    input.conversationId ??
    (await prisma.assistantConversation.create({ data: { workspaceId: input.workspaceId, userId: input.userId, title: MESSAGING_TITLE }, select: { id: true } })).id;

  let text = "";
  let error: string | null = null;
  let needsConfirmation = false;
  await runChatTurn({
    principal,
    conversationId,
    text: input.text,
    emit: (event: ChatStreamEvent) => {
      if (event.type === "text") text += event.text;
      else if (event.type === "error") error = event.message;
      else if (event.type === "confirm") needsConfirmation = true;
    },
  });

  const workspaceLink = `${(process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/$/, "")}/w/${membership.workspace.slug}/assistant/c/${conversationId}`;
  const parts = [text.trim()];
  if (needsConfirmation) parts.push(`This needs your confirmation before I change anything. Open the assistant in Space Works to approve it: ${workspaceLink}`);
  if (error) parts.push(error);
  return { text: parts.filter(Boolean).join("\n\n") || "I don't have an answer for that yet.", conversationId };
}
