/** Server peer configuration; none of these credentials are browser variables. */
export function frontendOrigin() {
  const value = process.env.NEXT_PUBLIC_BASE_URL;
  if (!value) throw new Error("NEXT_PUBLIC_BASE_URL is required.");
  const url = new URL(value);
  if (url.origin !== value || (process.env.NODE_ENV === "production" && url.protocol !== "https:" && !(process.env.CI === "true" && process.env.ALLOW_INSECURE_PRODUCTION_TESTS === "1"))) throw new Error("A canonical HTTPS origin is required.");
  return url.origin;
}

export function backendOrigin() {
  const value = process.env.BACKEND_ORIGIN;
  if (!value) throw new Error("BACKEND_ORIGIN is required.");
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password || (process.env.NODE_ENV === "production" && url.protocol !== "https:" && !(process.env.CI === "true" && process.env.ALLOW_INSECURE_PRODUCTION_TESTS === "1"))) throw new Error("BACKEND_ORIGIN must be an HTTPS origin.");
  if (url.origin === frontendOrigin()) throw new Error("Frontend and backend origins must differ in split mode.");
  return url.origin;
}

export function gatewaySecret() {
  const secret = process.env.FRONTEND_GATEWAY_SECRET;
  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) throw new Error("FRONTEND_GATEWAY_SECRET must contain 32 random bytes encoded as hex.");
  return secret;
}
