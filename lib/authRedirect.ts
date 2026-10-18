/** Only application-local paths may be used after authentication. */
export function safeAuthRedirect(value: string | null | undefined) {
  const path = value?.trim();
  if (!path || !path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(path)) return "/";
  try {
    const base = "https://auth.invalid";
    const url = new URL(path, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}
