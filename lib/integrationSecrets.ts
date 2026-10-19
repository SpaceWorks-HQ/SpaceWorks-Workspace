import "server-only";

import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * OAuth access/refresh tokens for IntegrationConnection rows. Encrypted with
 * INTEGRATION_ENCRYPTION_KEY (falls back to a subkey of MFA_ENCRYPTION_KEY).
 * Never return these values to the browser, logs or audit metadata.
 */
export function encryptIntegrationToken(token: string) {
  return encryptSecret("integration-tokens", token);
}

export function decryptIntegrationToken(value: string) {
  return decryptSecret("integration-tokens", value);
}
