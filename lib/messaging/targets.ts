import "server-only";
import type { AdapterSendInput } from "@/lib/notify/adapters/types";
import type { MessagingProvider } from "@prisma/client";
import { openCredentials } from "@/lib/messaging/credentials";
import type { ProviderCredentials } from "@/lib/messaging/providers";

export function botTarget<P extends MessagingProvider>(input: AdapterSendInput, provider: P) {
  const connection = input.target.type === "destination" ? input.target.destination.connection : input.target.identity?.connection;
  if (!connection || connection.provider !== provider || connection.status !== "ACTIVE" || !connection.lastVerifiedAt || connection.workspaceId !== input.message.workspace.id) return null;
  const credentials = openCredentials({ provider, credentialsEnc: connection.credentialsEnc }) as ProviderCredentials[P] | null;
  if (!credentials) return null;
  const config = connection.config as Record<string, string>;
  return { connection, credentials, config, identity: input.target.type === "personal" ? input.target.identity : null };
}
export const invalidTarget = { ok: false, retryable: false, error: "This destination needs an active, verified connection. Check messaging settings." } as const;
