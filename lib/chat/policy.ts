import type { ChannelKind, MessageAuthorKind, WorkspaceRole } from "@prisma/client";
import { z } from "zod";
import { hasRoleAtLeast } from "@/lib/roles";
import { MAX_MESSAGE_LENGTH } from "@/lib/chat/text";

/**
 * Chat permissions and input rules (pure, client-safe). Server actions check
 * these after resolving the membership and channel from the database; the UI
 * uses the same functions only to decide what to show.
 *
 * - GUEST: reads and posts only in channels they were added to; no DMs.
 * - MEMBER: joins public channels, posts, starts DMs, creates private channels.
 * - ADMIN: creates public channels, renames, archives, sets defaults, removes members.
 */

type Member = { role: WorkspaceRole } | null | undefined;
const atLeast = (m: Member, min: WorkspaceRole) => m != null && hasRoleAtLeast(m.role, min);

export function canCreateChannel(m: Member, kind: "PUBLIC" | "PRIVATE"): boolean {
  return kind === "PUBLIC" ? atLeast(m, "ADMIN") : atLeast(m, "MEMBER");
}

/** Rename, archive, default, team: workspace admins. */
export const canAdministerChannel = (m: Member) => atLeast(m, "ADMIN");

/** Members (not guests) of a channel may set its topic. */
export function canSetTopic(m: Member, isChannelMember: boolean, kind: ChannelKind): boolean {
  return kind !== "DIRECT" && atLeast(m, "MEMBER") && (isChannelMember || atLeast(m, "ADMIN"));
}

/** Join a public channel yourself. Guests are added by someone else. */
export const canJoinPublic = (m: Member) => atLeast(m, "MEMBER");

export const canStartDirectMessage = (m: Member) => atLeast(m, "MEMBER");

/** Add people to a non-DM channel: its members (not guests) or admins. */
export function canAddMembers(m: Member, isChannelMember: boolean, kind: ChannelKind): boolean {
  if (kind === "DIRECT") return false;
  return atLeast(m, "ADMIN") || (atLeast(m, "MEMBER") && isChannelMember);
}

/** Remove someone else: admins, or the person who created a private channel. */
export function canRemoveMember(m: Member, viewerId: string, channel: { kind: ChannelKind; createdById: string | null }): boolean {
  if (channel.kind === "DIRECT") return false;
  if (atLeast(m, "ADMIN")) return true;
  return channel.kind === "PRIVATE" && channel.createdById === viewerId && atLeast(m, "MEMBER");
}

type MessageLike = { authorId: string | null; authorKind: MessageAuthorKind; deletedAt: Date | string | null; origin: string | null };

/** Only the author edits, and only messages typed here. */
export function canEditMessage(message: MessageLike, viewerId: string): boolean {
  return message.deletedAt == null && message.authorKind === "USER" && message.authorId === viewerId && !message.origin;
}

/** The author, or an admin moderating a channel (never someone else's DM). */
export function canDeleteMessage(m: Member, message: MessageLike, viewerId: string, kind: ChannelKind): boolean {
  if (message.deletedAt != null) return false;
  if (message.authorId === viewerId && message.authorKind === "USER") return true;
  return kind !== "DIRECT" && atLeast(m, "ADMIN");
}

/** Pins: admins, the author, or anyone in a DM they belong to. */
export function canPinMessage(m: Member, message: MessageLike, viewerId: string, kind: ChannelKind): boolean {
  if (message.deletedAt != null) return false;
  if (kind === "DIRECT") return true;
  return atLeast(m, "ADMIN") || (message.authorId === viewerId && atLeast(m, "GUEST"));
}

/** `@channel` / `@here` in channels: members and up. */
export function canBroadcast(m: Member, kind: ChannelKind): boolean {
  return kind !== "DIRECT" && atLeast(m, "MEMBER");
}

// ───────────── Input schemas ─────────────

/** Paths under /chat that are pages, not channels. */
export const RESERVED_CHANNEL_SLUGS: ReadonlySet<string> = new Set(["browse", "new", "search", "settings", "dm", "api"]);

/** "Build Night" → "build-night". */
export function toChannelSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/^#+/, "")
    .replace(/[\s.]+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 80);
}

export const channelNameSchema = z
  .string()
  .trim()
  .transform(toChannelSlug)
  .pipe(
    z
      .string()
      .min(1, "Enter a channel name.")
      .max(80, "Keep the name under 80 characters.")
      .regex(/^[a-z0-9][a-z0-9_-]*$/, "Use lowercase letters, numbers, hyphens and underscores.")
      .refine((slug) => !RESERVED_CHANNEL_SLUGS.has(slug), "That name is reserved. Pick another one."),
  );

export const topicSchema = z.string().trim().max(250, "Keep the topic under 250 characters.");

export const notifyLevelSchema = z.enum(["ALL", "MENTIONS", "NONE"]);

export const messageBodySchema = z.string().max(MAX_MESSAGE_LENGTH * 2, "That message is too long.");

export const MAX_ATTACHMENTS = 10;
