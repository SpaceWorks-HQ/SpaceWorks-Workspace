import "server-only";

/**
 * Write side of chat. Server actions (app/actions/chat.ts) authenticate,
 * rate-limit and parse input, then call these functions with the resolved
 * workspace context. Each function re-checks channel access itself.
 */

export { createChannel, setChannelArchived, updateChannel } from "./service/channels";
export { markRead, sendTyping, setPinned, toggleReaction, uploadAttachment } from "./service/interactions";
export {
  addChannelMembers,
  joinChannel,
  leaveChannel,
  openDirectMessage,
  removeChannelMember,
  setNotifyLevel,
} from "./service/memberships";
export { deleteMessage, editMessage, postMessage } from "./service/messages";
