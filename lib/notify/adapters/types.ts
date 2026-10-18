import type { DestinationKind, ExternalIdentityLink, MessagingConnection, PersonalChannel, Prisma } from "@prisma/client";
import type { RenderedMessage } from "@/lib/notify/types";

/**
 * Destination adapters deliver one rendered notification to one target.
 * In-app delivery is not an adapter: dispatch() writes Notification rows
 * inline. Everything else is queued (outbox kind "notify.deliver") and sent
 * by the worker through the adapter registered for the destination kind or
 * personal channel in `./index.ts`.
 *
 * Adding a provider = replacing the placeholder module for it (e.g.
 * `./slack.ts`); the registry already imports every module.
 */

/** Shared destination kinds delivered through the worker. */
export type QueuedDestinationKind = Exclude<DestinationKind, "IN_APP_USERS">;
/** Personal channels delivered through the worker. */
export type ExternalPersonalChannel = Exclude<PersonalChannel, "IN_APP">;

export type DestinationTarget = {
  type: "destination";
  destination: {
    id: string;
    name: string;
    kind: DestinationKind;
    /** Non-secret settings (channelId, chatId, to, roles…). */
    config: Prisma.JsonValue;
    /** Encrypted secrets (purpose "notification-secrets"); decrypt only inside the adapter. */
    secretEnc: string | null;
    connection: MessagingConnection | null;
  };
};

export type PersonalTarget = {
  type: "personal";
  channel: ExternalPersonalChannel;
  user: { id: string; name: string | null; email: string };
  /** Verified account link for *_DM channels (null for email). */
  identity: (ExternalIdentityLink & { connection: MessagingConnection }) | null;
};

export type AdapterSendInput = {
  deliveryId: string;
  event: { id: string; type: string };
  message: RenderedMessage;
  target: DestinationTarget | PersonalTarget;
  /** Earlier delivery to the same target with the same threadKey (reply in thread / edit). */
  thread: { threadKey: string; providerMessageId: string | null; providerThreadId: string | null } | null;
  isTest: boolean;
};

export type SendResult =
  | { ok: true; providerMessageId?: string; providerThreadId?: string }
  | { ok: false; retryable: boolean; error: string; retryAfterSec?: number };

export interface DestinationAdapter {
  /** Shared destination kind this adapter serves. */
  kind: QueuedDestinationKind;
  /** Personal channel this adapter also serves, if any (e.g. SLACK_DM). */
  personalChannel?: ExternalPersonalChannel;
  /** Human name for logs and the delivery log ("Slack"). */
  label: string;
  /** False for providers that are not built yet; their deliveries fail with "not configured". */
  configured: boolean;
  send(input: AdapterSendInput): Promise<SendResult>;
  /** Optional in-place update (incident resolved → edit the original message). */
  edit?(input: AdapterSendInput & { providerMessageId: string }): Promise<SendResult>;
}

/** Placeholder for a provider that a later build implements. */
export function notConfiguredAdapter(kind: QueuedDestinationKind, label: string, personalChannel?: ExternalPersonalChannel): DestinationAdapter {
  return {
    kind,
    label,
    configured: false,
    ...(personalChannel ? { personalChannel } : {}),
    async send() {
      return { ok: false, retryable: false, error: `${label} delivery is not configured yet.` };
    },
  };
}
