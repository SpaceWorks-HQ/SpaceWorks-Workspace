#!/usr/bin/env node
import { hostname, constants } from "node:os";
import { spawn } from "node:child_process";
import spawnCommand from "cross-spawn";
import { scanCommand } from "./scanner.js";
import { readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { setTimeout as wait } from "node:timers/promises";
import { parseArguments, formatValues, injectedEnvironment } from "./args.js";
import { normaliseHost, request, getSecrets } from "./sdk.js";
import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
  type Credentials,
} from "./credentials.js";
const help = `Space Works Workspace CLI
sww login --host https://workspace.example.org
sww init --host HOST --project PROJECT_ID --env dev --path /
sww secrets list|get KEY|set KEY=value|delete KEY [--env dev] [--path /]
sww secrets pull --env production --format env|json|yaml > .env
sww export [same options as pull]
sww run --env dev -- npm run dev
sww login status | whoami | logout | tokens [revoke SESSION_ID]\nsww scan [--staged|--history] | scan install --pre-commit\nsww login --method=universal-auth --client-id ID --client-secret SECRET --plain --silent
Use --mfa CODE for a fresh export or production reveal. SWW_TOKEN supports CI.
`;
type Config = {
  host?: string;
  project?: string;
  environment?: string;
  projectId?: string;
  defaultEnvironment?: string;
  domain?: string;
  path?: string;
};
async function config(): Promise<Config> {
  try {
    return JSON.parse(await readFile(".sww.json", "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error("Check .sww.json contains valid JSON.");
  }
}
async function authenticated(host?: string): Promise<Credentials> {
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
async function refreshDeviceSession(stored: Credentials): Promise<Credentials> {
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
export async function runChild(
  command: string[],
  values: Record<string, string>,
) {
  if (!command.length) throw new Error("Put a command after --.");
  // cross-spawn resolves PATHEXT and safely escapes cmd/bat shims on Windows.
  const child = spawnCommand(command[0], command.slice(1), {
    stdio: "inherit",
    env: injectedEnvironment(values),
    shell: false,
  });
  const forward = (signal: NodeJS.Signals) => child.kill(signal);
  const interrupt = () => forward("SIGINT"),
    terminate = () => forward("SIGTERM"),
    hangup = () => forward("SIGHUP");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  process.on("SIGHUP", hangup);
  return new Promise<number>((resolve, reject) => {
    child.on("error", () => {
      cleanup();
      reject(new Error("Couldn't start the requested command."));
    });
    child.on("exit", (code, signal) => {
      cleanup();
      resolve(code ?? 128 + (signal ? (constants.signals[signal] ?? 1) : 1));
    });
    function cleanup() {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
      process.off("SIGHUP", hangup);
    }
  });
}
export async function main(args = process.argv.slice(2)) {
  const parsed = parseArguments(args),
    [command, sub, arg] = parsed.positionals,
    flags = parsed.flags;
  if (flags.help || !command) {
    process.stdout.write(help);
    return 0;
  }
  if (command === "scan") return scanCommand(sub, flags);
  if (command === "logout") {
    try {
      const stored = await loadCredentials();
      if (stored) {
        if (stored.accessToken.startsWith("swwu_"))
          await request(stored.host, "/api/v1/auth/universal/revoke", stored.accessToken, {});
        else if (stored.refreshToken) {
          const refreshed = await refreshDeviceSession(stored);
          await request(refreshed.host, "/api/cli/sessions", refreshed.accessToken, {});
        }
      }
    } finally { await clearCredentials(); }
    process.stderr.write("Signed out.\n"); return 0;
  }
  const cfg = await config();
  let host = typeof (flags.domain ?? flags.host) === "string" ? normaliseHost(String(flags.domain ?? flags.host)) : process.env.SWW_DOMAIN ? normaliseHost(process.env.SWW_DOMAIN) : cfg.domain ?? cfg.host;
  if (command === "login" && sub === "status") {
    const stored = await loadCredentials();
    process.stdout.write(stored ? `Signed in to ${stored.host}. Access ${stored.expiresAt > Date.now() ? "active" : "expired"}.\n` : process.env.SWW_TOKEN ? "Using SWW_TOKEN.\n" : "Signed out.\n");
    return stored || process.env.SWW_TOKEN ? 0 : 1;
  }
  if (command === "login") {
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
  if (command === "init") {
    let selectedHost = host ?? (await loadCredentials())?.host;
    let selectedProject =
      typeof (flags.projectId ?? flags.project) === "string" ? String(flags.projectId ?? flags.project) : cfg.projectId ?? cfg.project;
    if ((!selectedHost || !selectedProject) && process.stdin.isTTY) {
      const { createInterface } = await import("node:readline/promises");
      const input = createInterface({
        input: process.stdin,
        output: process.stderr,
      });
      try {
        selectedHost ??= (await input.question("Workspace host: ")).trim();
        selectedProject ??= (
          await input.question("Project ID (from Secrets): ")
        ).trim();
      } finally {
        input.close();
      }
    }
    if (!selectedHost || !selectedProject)
      throw new Error(
        "Provide --host and --project with the project ID from Secrets.",
      );
    const value = {
      domain: normaliseHost(selectedHost),
      projectId: selectedProject,
      defaultEnvironment: String(flags.env ?? "dev"),
      path: String(flags.path ?? "/"),
    };
    await writeFile(".sww.json", JSON.stringify(value, null, 2) + "\n", {
      flag: "wx",
      mode: 0o644,
    });
    process.stderr.write("Created .sww.json. It contains no secrets.\n");
    return 0;
  }
  const auth = await authenticated(host);
  if (flags.mfa)
    await request(auth.host, "/api/cli/mfa", auth.accessToken, {
      code: flags.mfa,
    });
  if (command === "whoami") {
    process.stdout.write(
      JSON.stringify(
        await (
          await request(auth.host, "/api/cli/whoami", auth.accessToken)
        ).json(),
        null,
        2,
      ) + "\n",
    );
    return 0;
  }
  if (command === "tokens") {
    const body = sub === "revoke" ? { id: arg } : undefined;
    if (sub === "revoke" && !arg)
      throw new Error("Provide the CLI session ID to revoke.");
    process.stdout.write(
      JSON.stringify(
        await (
          await request(auth.host, "/api/cli/sessions", auth.accessToken, body)
        ).json(),
        null,
        2,
      ) + "\n",
    );
    return 0;
  }
  const project = String(flags.projectId ?? flags.project ?? cfg.projectId ?? cfg.project ?? "");
  if (!project) throw new Error("Run sww init or provide --project.");
  const environment = String(flags.env ?? cfg.defaultEnvironment ?? cfg.environment ?? "dev"),
    path = String(flags.path ?? cfg.path ?? "/");
  const q = new URLSearchParams({ project, environment, path, format: "json" });
  if (command === "run") {
    const values = await getSecrets({
      host: auth.host,
      token: auth.accessToken,
      project,
      environment,
      path,
    });
    return runChild(parsed.command, values);
  }
  if (command === "export" || (command === "secrets" && sub === "pull")) {
    const values = await getSecrets({
      host: auth.host,
      token: auth.accessToken,
      project,
      environment,
      path,
    });
    process.stdout.write(formatValues(values, String(flags.format ?? "env")));
    return 0;
  }
  if (command !== "secrets")
    throw new Error("Unknown command. Run sww --help.");
  if (sub === "list") {
    q.set("list", "true");
    const body = await (
      await request(auth.host, "/api/v1/secrets?" + q, auth.accessToken)
    ).json();
    process.stdout.write(body.keys.join("\n") + "\n");
    return 0;
  }
  if (sub === "get") {
    if (!arg) throw new Error("Provide a key name.");
    q.set("key", arg);
    const values = await (
      await request(auth.host, "/api/v1/secrets?" + q, auth.accessToken)
    ).json();
    process.stdout.write(values[arg] + "\n");
    return 0;
  }
  if (sub === "set" || sub === "delete") {
    if (!arg) throw new Error("Provide a key name or KEY=value.");
    const equal = arg.indexOf("="),
      key = sub === "set" ? arg.slice(0, equal) : arg;
    if (sub === "set" && equal < 1) throw new Error("Use KEY=value.");
    const result = await (
      await request(auth.host, "/api/v1/secrets", auth.accessToken, {
        project,
        environment,
        changes: [
          {
            path,
            key,
            ...(sub === "delete"
              ? { delete: true }
              : { value: arg.slice(equal + 1) }),
          },
        ],
      })
    ).json();
    process.stderr.write(
      result.pending ? "Change submitted for approval.\n" : "Saved.\n",
    );
    return 0;
  }
  throw new Error("Unknown command. Run sww --help.");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(
        (error instanceof Error ? error.message : "The request failed.") + "\n",
      );
      process.exitCode = 1;
    });
}
