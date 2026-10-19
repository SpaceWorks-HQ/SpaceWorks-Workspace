import crypto from "crypto";

/**
 * Shared crypto helpers. Bearer capabilities (invite, reset, API tokens) are
 * random and stored only as SHA-256 hashes; configuration secrets are
 * AES-256-GCM encrypted with a domain-separated HKDF subkey so ciphertext
 * from one purpose can never be decrypted as another.
 */

/** URL-safe random token with `bytes` of entropy (default 32 bytes = 256 bits). */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/** Constant-time comparison of two strings (false on length mismatch). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function hmacHex(key: string | Buffer, value: string): string {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest("hex");
}

/** Decode a base64 env value that must be exactly 32 bytes. */
export function decodeAes256Key(raw: string | undefined, name: string): Buffer {
  const value = raw ?? "";
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    throw new Error(`${name} must be valid base64 for a 32-byte key.`);
  }
  return key;
}

/** Purposes for derived subkeys. Never reuse one purpose for another kind of data. */
export type SecretPurpose = "instance-settings" | "integration-tokens";

const PURPOSE_INFO: Record<SecretPurpose, string> = {
  "instance-settings": "sww-instance-settings-v1",
  "integration-tokens": "sww-integration-tokens-v1",
};

function rootKeyFor(purpose: SecretPurpose): Buffer {
  if (purpose === "integration-tokens" && process.env.INTEGRATION_ENCRYPTION_KEY) {
    return decodeAes256Key(process.env.INTEGRATION_ENCRYPTION_KEY, "INTEGRATION_ENCRYPTION_KEY");
  }
  return decodeAes256Key(process.env.MFA_ENCRYPTION_KEY, "MFA_ENCRYPTION_KEY");
}

function subkey(purpose: SecretPurpose): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", rootKeyFor(purpose), Buffer.alloc(0), PURPOSE_INFO[purpose], 32));
}

export function encryptWithKey(key: Buffer, plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptWithKey(key: Buffer, value: string): string {
  const [version, iv, tag, encrypted, ...rest] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted || rest.length > 0) throw new Error("Invalid encrypted value.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

/** Encrypt a configuration secret (SMTP password, AI key, OAuth token…). */
export function encryptSecret(purpose: SecretPurpose, plaintext: string): string {
  return encryptWithKey(subkey(purpose), plaintext);
}

export function decryptSecret(purpose: SecretPurpose, value: string): string {
  return decryptWithKey(subkey(purpose), value);
}
