import type { ChannelKind, MessageAuthorKind, NotifyLevel, WorkspaceRole } from "@prisma/client";
import type { ReactionSummary } from "@/lib/chat/reactions";

/** Data shapes the chat server code sends to the browser (client-safe). */

export type ChatPerson = { id: string; name: string; image: string | null; role?: WorkspaceRole };

export type SidebarItem = {
  id: string;
  kind: ChannelKind;
  name: string;
  slug: string;
  href: string;
  topic: string | null;
  isDefault: boolean;
  teamName: string | null;
  notify: NotifyLevel;
  unread: number;
  mentions: number;
  lastMessageAt: string | null;
  /** DMs: the other people (or yourself for a note-to-self). */
  people?: ChatPerson[];
};

export type SidebarData = { channels: SidebarItem[]; dms: SidebarItem[] };

export type AttachmentDTO = { id: string; filename: string; contentType: string; size: number; url: string; downloadUrl: string; isImage: boolean };

export type MessageOrigin = { kind: "notify" } | { kind: "bridge"; label: string } | null;

export type MessageDTO = {
  id: string;
  channelId: string;
  parentId: string | null;
  author: ChatPerson | null;
  authorKind: MessageAuthorKind;
  origin: MessageOrigin;
  /** Sanitised HTML (server-rendered); empty when deleted. */
  html: string;
  /** Composer text for the author's own editable messages. */
  source: { text: string; mentions: Array<{ id: string; name: string }> } | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  pinned: boolean;
  pinnedByName: string | null;
  replyCount: number;
  lastReplyAt: string | null;
  replyPeople: ChatPerson[];
  reactions: ReactionSummary[];
  attachments: AttachmentDTO[];
  mentionsMe: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canPin: boolean;
  cursor: string;
};

export type MessagePage = {
  messages: MessageDTO[];
  /** Older messages exist before the first one. */
  hasOlder: boolean;
  /** Newer messages exist after the last one (only when not at the latest). */
  hasNewer: boolean;
};

export type ChannelInfo = {
  id: string;
  kind: ChannelKind;
  name: string;
  slug: string;
  href: string;
  topic: string | null;
  isDefault: boolean;
  archived: boolean;
  teamId: string | null;
  teamName: string | null;
  createdById: string | null;
  memberCount: number;
  isMember: boolean;
  notify: NotifyLevel;
  lastReadAt: string | null;
  people: ChatPerson[];
  can: {
    post: boolean;
    join: boolean;
    leave: boolean;
    setTopic: boolean;
    administer: boolean;
    addMembers: boolean;
    removeMembers: boolean;
    broadcast: boolean;
    upload: boolean;
  };
};

export type BrowseChannel = {
  id: string;
  name: string;
  slug: string;
  href: string;
  kind: ChannelKind;
  topic: string | null;
  memberCount: number;
  isMember: boolean;
  isDefault: boolean;
  archived: boolean;
  teamName: string | null;
  lastMessageAt: string | null;
};

export type SearchHit = {
  id: string;
  channelId: string;
  channelName: string;
  channelKind: ChannelKind;
  href: string;
  author: ChatPerson | null;
  html: string;
  createdAt: string;
  inThread: boolean;
};

export type ChannelOption = { id: string; name: string; slug: string };
