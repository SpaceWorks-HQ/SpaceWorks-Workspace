import "server-only";

import { channelInfo, type ChatContext, type ResolvedChannel } from "@/lib/chat/access";
import { PAGE_SIZE } from "@/lib/chat/cursor";
import { listAround, listMessages } from "@/lib/chat/queries";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function param(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first && ID.test(first) ? first : null;
}

/**
 * Initial data for a conversation page: channel info, the first page of
 * messages (around `?m=` when given), and the thread to open (`?thread=`).
 */
export async function loadConversation(ctx: ChatContext, resolved: ResolvedChannel, searchParams: Record<string, string | string[] | undefined>) {
  const highlightId = param(searchParams.m);
  const threadId = param(searchParams.thread);
  const info = await channelInfo(ctx, resolved);
  const around = highlightId && !threadId ? await listAround(ctx, resolved, highlightId, PAGE_SIZE) : null;
  const initial = around ?? (await listMessages(ctx, resolved, { limit: PAGE_SIZE }));
  return { info, initial, threadId, highlightId: around || threadId ? highlightId : null };
}
