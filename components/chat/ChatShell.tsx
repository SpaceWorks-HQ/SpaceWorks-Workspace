"use client";

import type { ReactNode } from "react";
import { useSelectedLayoutSegment } from "next/navigation";
import { cn } from "@/lib/cn";
import type { ChannelOption, ChatPerson, SidebarData } from "@/lib/chat/types";
import type { TeamOption } from "@/components/chat/ChannelDialogs";
import { ChatProvider, type ChatViewer } from "@/components/chat/ChatProvider";
import { ChatSidebar } from "@/components/chat/ChatSidebar";

/**
 * Full-height chat frame: conversation list on the left, the page on the
 * right. Below `md` it is two screens: the list on the index page, the
 * conversation (with a back button) everywhere else.
 */
export function ChatShell({
  slug,
  timeZone,
  viewer,
  people,
  channels,
  teams,
  sidebar,
  listOnIndex,
  children,
}: {
  slug: string;
  timeZone: string;
  viewer: ChatViewer;
  people: Array<ChatPerson & { role: string }>;
  channels: ChannelOption[];
  teams: TeamOption[];
  sidebar: SidebarData;
  /** On phones, show the list (not the page) at the area's index route. */
  listOnIndex: boolean;
  children: ReactNode;
}) {
  const segment = useSelectedLayoutSegment();
  const showList = listOnIndex && segment === null;
  return (
    <ChatProvider slug={slug} timeZone={timeZone} viewer={viewer} people={people} channels={channels}>
      <div className="flex h-[calc(100dvh-104px)] min-h-[480px] overflow-hidden rounded-xl border border-line bg-panel md:h-[calc(100dvh-72px)]">
        <aside className={cn("w-full shrink-0 border-line bg-panel md:block md:w-[272px] md:border-r", showList ? "block" : "hidden")}>
          <ChatSidebar initial={sidebar} teams={teams} />
        </aside>
        <div className={cn("min-w-0 flex-1 flex-col md:flex", showList ? "hidden" : "flex")}>{children}</div>
      </div>
    </ChatProvider>
  );
}
