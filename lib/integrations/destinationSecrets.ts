import "server-only";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { destinationSecretsSchema, type DestinationSecrets } from "@/lib/integrations/destinationConfig";

/**
 * `NotificationDestination.secretEnc` (purpose "notification-secrets"):
 * JSON `{ webhookUrl?, signingSecret? }`. Decrypt only inside adapters and
 * the save path; never return the values to the browser, logs or audit.
 */

export function sealDestinationSecrets(secrets: DestinationSecrets): string | null {
  const clean = Object.fromEntries(Object.entries(secrets).filter(([, value]) => typeof value === "string" && value.length > 0));
  return Object.keys(clean).length === 0 ? null : encryptSecret("notification-secrets", JSON.stringify(clean));
}

export function openDestinationSecrets(secretEnc: string | null | undefined): DestinationSecrets {
  if (!secretEnc) return {};
  try {
    const parsed = destinationSecretsSchema.safeParse(JSON.parse(decryptSecret("notification-secrets", secretEnc)));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Host name only, for the non-secret `urlHint` shown in lists. */
export function urlHint(raw: string): string {
  try {
    return new URL(raw).hostname.slice(0, 200);
  } catch {
    return "";
  }
}
