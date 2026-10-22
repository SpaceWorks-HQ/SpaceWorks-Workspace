import "server-only";

import type { WorkspaceRole } from "@prisma/client";
import type { ChatPerson } from "@/lib/chat/types";
import type { ChatContext } from "@/lib/chat/access";
import { listChannelOptions, listTeamOptions, listWorkspacePeople } from "./queries/channels";
import { getSidebar } from "./queries/sidebar";

/**
 * Read side of chat. Every function takes an already-resolved workspace
 * context (and channel where relevant) and filters by workspace.
 */

export {
  browseChannels,
  listChannelMembers,
  listChannelOptions,
  listTeamOptions,
  listWorkspacePeople,
} from "./queries/channels";
export { listAround, listMessages, listPinned, listThread, messagesByIds } from "./queries/messages";
export { searchMessages } from "./queries/search";
export { getSidebar } from "./queries/sidebar";

export type ChannelMemberDTO = Omit<ChatPerson, "role"> & { role: WorkspaceRole | "FORMER"; joinedAt: string; isCreator: boolean };

// ───────────── Layout ─────────────

/** Everything the chat frame needs once per navigation. */
export async function getChatShellData(ctx: ChatContext) {
  const [sidebar, people, channels, teams] = await Promise.all([getSidebar(ctx), listWorkspacePeople(ctx), listChannelOptions(ctx), listTeamOptions(ctx)]);
  return {
    sidebar,
    people,
    channels,
    teams,
    viewer: { id: ctx.user.id, name: ctx.user.name?.trim() || ctx.user.email, role: ctx.membership.role },
  };
}
