import crypto from "node:crypto";
/**
 * @param {string | undefined} raw
 * @param {string} name
 * @returns {Buffer}
 */
export function decodeAes256Key(raw, name) {
  const value = raw ?? "";
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    throw new Error(`${name} must be valid base64 for a 32-byte key.`);
  }
  return key;
}

/**
 * @param {Buffer} key
 * @param {string} plaintext
 * @param {string | undefined} [aad]
 * @returns {string}
 */
export function encryptWithKey(key, plaintext, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  if (aad !== undefined) cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

/**
 * @param {Buffer} key
 * @param {string} value
 * @param {string | undefined} [aad]
 * @returns {string}
 */
export function decryptWithKey(key, value, aad) {
  const [version, iv, tag, encrypted, ...rest] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted || rest.length > 0) throw new Error("Invalid encrypted value.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  if (aad !== undefined) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

/** @returns {{ version: number; key: Buffer }[]} */
export function vaultRootKeys() {
  const list = process.env.VAULT_MASTER_KEYS;
  if (!list) return [{ version: 1, key: decodeAes256Key(process.env.VAULT_MASTER_KEY, "VAULT_MASTER_KEY") }];
  const entries = list.split(",").map(entry => {
    const [version, raw, extra] = entry.split(":");
    if (!/^[1-9]\d*$/.test(version) || !Number.isSafeInteger(Number(version)) || extra) throw new Error("Invalid vault root key list.");
    return { version: Number(version), key: decodeAes256Key(raw, "VAULT_MASTER_KEYS") };
  });
  if (new Set(entries.map(e => e.version)).size !== entries.length) throw new Error("Duplicate root key version.");
  return entries;
}
