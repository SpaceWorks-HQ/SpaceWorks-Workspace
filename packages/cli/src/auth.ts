import { hostname } from "node:os";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { normaliseHost, request } from "./sdk.js";
import { loadCredentials, saveCredentials, type Credentials } from "./credentials.js";

export async function authenticated(host?: string): Promise<Credentials> {
  if (process.env.SWW_TOKEN) {
    if (!host) throw new Error("Set --host or run sww init.");
    return {
      host: normaliseHost(host),
      accessToken: process.env.SWW_TOKEN,
      refreshToken: "",
      expiresAt: Infinity,
    };
  }
  const stored = await loadCredentials();
  if (!stored) throw new Error("Run sww login first.");
  if (host && normaliseHost(host) !== stored.host)
    throw new Error("Sign in to the configured host first.");
  if (stored.expiresAt > Date.now() + 30000) return stored;
  if (!stored.refreshToken) {
    if (!stored.accessToken.startsWith("swwu_")) throw new Error("This session expired. Sign in again.");
    const result = await (await request(stored.host, "/api/v1/auth/universal/renew", stored.accessToken, {})).json();
    if (typeof result.accessToken !== "string" || !Number.isFinite(result.expiresIn)) throw new Error("Sign in again. This identity session could not renew.");
    const renewed = { ...stored, accessToken: result.accessToken, expiresAt: Date.now() + result.expiresIn * 1000 };
    await saveCredentials(renewed); return renewed;
  }
  return refreshDeviceSession(stored);
}
export async function refreshDeviceSession(stored: Credentials): Promise<Credentials> {
  const result = await (
    await request(stored.host, "/api/cli/refresh", undefined, {
      refresh_token: stored.refreshToken,
    })
  ).json();
  const next = {
    host: stored.host,
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    expiresAt: Date.now() + result.expires_in * 1000,
  };
  await saveCredentials(next);
  return next;
}
function openBrowser(url: string) {
  const program =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "rundll32"
        : "xdg-open";
  const args =
    process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = spawn(program, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}
export async function login(host: string | undefined, flags: Record<string, string | boolean>) {
  host ??= (await loadCredentials())?.host;
  if (!host && process.stdin.isTTY) {
    const { createInterface } = await import("node:readline/promises");
    const prompt = createInterface({ input: process.stdin, output: process.stderr });
    try { host = normaliseHost((await prompt.question("Instance URL: ")).trim()); } finally { prompt.close(); }
  }
  if (!host) throw new Error("Set --domain or SWW_DOMAIN to the instance URL.");
  if (flags.method === "universal-auth") {
    if (!flags["client-id"] || !flags["client-secret"]) throw new Error("Supply --client-id and --client-secret.");
    const result = await (await request(host, "/api/v1/auth/universal/login", undefined, { clientId: flags["client-id"], clientSecret: flags["client-secret"] })).json();
    if (typeof result.accessToken !== "string" || !Number.isFinite(result.expiresIn)) throw new Error("Invalid login response.");
    if (flags.plain) process.stdout.write(result.accessToken + "\n");
    else { await saveCredentials({ host, accessToken: result.accessToken, refreshToken: "", expiresAt: Date.now() + result.expiresIn * 1000 }); if (!flags.silent) process.stderr.write("Signed in with universal authentication.\n"); }
    return 0;
  }
  if (flags.method && flags.method !== "device") throw new Error("Choose device or universal-auth.");
  const result = await (
    await request(host, "/api/cli/device/code", undefined, {
      deviceName: flags.name ?? hostname(),
    })
  ).json();
  const verification = new URL(String(result.verification_uri_complete));
  if (
    verification.origin !== normaliseHost(host) ||
    verification.pathname !== "/device" ||
    !/^[A-Z0-9]{8}$/.test(result.user_code)
  )
    throw new Error(
      "The server returned an invalid device verification URL.",
    );
  process.stderr.write(
    `Open ${verification.href}\nVerify this code: ${result.user_code}\n`,
  );
  if (!flags["no-open"]) openBrowser(verification.href);
  const expires = Date.now() + result.expires_in * 1000;
  let interval = result.interval * 1000;
  while (Date.now() < expires) {
    await wait(interval);
    const response = await fetch(
      normaliseHost(host) + "/api/cli/device/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: result.device_code }),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      },
    );
    const token = await response.json();
    if (response.ok && token.access_token) {
      await saveCredentials({
        host: normaliseHost(host),
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: Date.now() + token.expires_in * 1000,
      });
      process.stderr.write("Signed in. Run sww init in your project.\n");
      return 0;
    }
    if (token.error === "slow_down") {
      interval += 5000;
      continue;
    }
    if (token.error !== "authorization_pending")
      throw new Error("Login was denied or expired. Start login again.");
  }
  throw new Error("Login expired. Start login again.");
}
