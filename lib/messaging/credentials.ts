import "server-only";

import type { MessagingConnection, MessagingProvider } from "@prisma/client";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { ProviderConfig, ProviderCredentials } from "@/lib/messaging/providers";

/**
 * `MessagingConnection.credentialsEnc` (purpose "messaging-credentials"):
 * JSON of `ProviderCredentials[provider]`. Decrypt only where a request is
 * about to be made or a signature checked; never return values to the
 * browser, logs or audit metadata. `credentialsHint` holds the last four
 * characters of the main token for display.
 */

export function sealCredentials<P extends MessagingProvider>(provider: P, credentials: ProviderCredentials[P]): { credentialsEnc: string; credentialsHint: string } {
  const main = "botToken" in credentials ? credentials.botToken : "accessToken" in credentials ? credentials.accessToken : "";
  void provider;
  return { credentialsEnc: encryptSecret("messaging-credentials", JSON.stringify(credentials)), credentialsHint: main ? `…${main.slice(-4)}` : "" };
}

export function openCredentials<P extends MessagingProvider>(connection: { provider: P; credentialsEnc: string } | (MessagingConnection & { provider: P })): ProviderCredentials[P] | null {
  try {
    const value = JSON.parse(decryptSecret("messaging-credentials", connection.credentialsEnc)) as unknown;
    return value && typeof value === "object" ? (value as ProviderCredentials[P]) : null;
  } catch {
    return null;
  }
}

export function connectionConfig<P extends MessagingProvider>(connection: { provider: P; config: unknown }): ProviderConfig[P] {
  const config = connection.config;
  return (config && typeof config === "object" && !Array.isArray(config) ? config : {}) as ProviderConfig[P];
}

/** Narrow a loaded connection to one provider. */
export function isProvider<P extends MessagingProvider>(connection: { provider: MessagingProvider } | null | undefined, provider: P): connection is MessagingConnection & { provider: P } {
  return connection?.provider === provider;
}

/** Encrypt/decrypt `BridgedChannel.outboundWebhookEnc` (a Discord/Mattermost webhook URL). */
export function sealBridgeWebhook(url: string) {
  return encryptSecret("messaging-credentials", url);
}

export function openBridgeWebhook(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return decryptSecret("messaging-credentials", value);
  } catch {
    return null;
  }
}
