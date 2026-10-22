// One policy for backend view projection, transport validation and generated DTO types.
const secretNames = new Set(["passwordHash", "mfaRecoveryCodes", "recoveryCodeHashes", "access_token", "refresh_token", "id_token", "sessionToken", "privateKey", "wrappedKey", "credentials", "token", "apiKey", "accessToken", "refreshToken", "password", "smtpPassword"]);
export function isPrivateViewField(name: string) {
  if (name === "contentHash") return false; // Public document-signing fingerprint.
  return secretNames.has(name) || /(?:Enc|Encrypted|Hash)$/.test(name) || (/Secret$/.test(name) && !/^has[A-Z]/.test(name));
}
