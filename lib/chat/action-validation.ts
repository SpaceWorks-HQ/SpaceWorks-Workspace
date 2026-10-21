import "server-only";
import { z } from "zod";
import { idSchema } from "@/lib/validation";
import { channelNameSchema, MAX_ATTACHMENTS, messageBodySchema, notifyLevelSchema, topicSchema } from "@/lib/chat/policy";

export const slugSchema = z.string().min(1).max(64);

export const pageSchema = z.object({
  channelId: idSchema,
  before: z.string().max(200).optional(),
  after: z.string().max(200).optional(),
  around: idSchema.optional(),
  limit: z.number().int().optional(),
});

export const byIdsSchema = z.object({ channelId: idSchema, ids: z.array(idSchema).min(1).max(50) });

export const threadSchema = z.object({ channelId: idSchema, parentId: idSchema, after: z.string().max(200).optional() });

export const channelOnlySchema = z.object({ channelId: idSchema });

export const searchSchema = z.object({ query: z.string().trim().min(2, "Type at least two characters.").max(200), channelId: idSchema.optional() });

export const createSchema = z.object({
  name: channelNameSchema,
  kind: z.enum(["PUBLIC", "PRIVATE"]),
  topic: topicSchema.default(""),
  teamId: idSchema.nullable().default(null),
  memberIds: z.array(idSchema).max(200).default([]),
});

export const updateSchema = z.object({
  channelId: idSchema,
  name: channelNameSchema.optional(),
  topic: topicSchema.optional(),
  isDefault: z.boolean().optional(),
});

export const archiveSchema = z.object({ channelId: idSchema, archived: z.boolean() });

export const membersSchema = z.object({ channelId: idSchema, userIds: z.array(idSchema).min(1, "Pick at least one person.").max(100) });

export const removeSchema = z.object({ channelId: idSchema, userId: idSchema });

export const notifySchema = z.object({ channelId: idSchema, level: notifyLevelSchema });

export const dmSchema = z.object({ userIds: z.array(idSchema).max(20) });

export const postSchema = z.object({
  channelId: idSchema,
  body: messageBodySchema,
  parentId: idSchema.nullable().default(null),
  attachmentIds: z.array(idSchema).max(MAX_ATTACHMENTS).default([]),
});

export const editSchema = z.object({ messageId: idSchema, body: messageBodySchema });

export const messageOnlySchema = z.object({ messageId: idSchema });

export const reactionSchema = z.object({ messageId: idSchema, emoji: z.string().min(1).max(16) });

export const pinSchema = z.object({ messageId: idSchema, pinned: z.boolean() });

export const typingSchema = z.object({ channelId: idSchema, parentId: idSchema.nullable().default(null) });
