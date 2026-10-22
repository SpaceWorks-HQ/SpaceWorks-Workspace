#!/usr/bin/env node
import { constants } from "node:os";
import spawnCommand from "cross-spawn";
import { scanCommand } from "./scanner.js";
import { readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArguments, formatValues, injectedEnvironment } from "./args.js";
import { normaliseHost, request, getSecrets } from "./sdk.js";
import {
  loadCredentials,
  clearCredentials,
} from "./credentials.js";
import { authenticated, refreshDeviceSession, login } from "./auth.js";
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
  const host = typeof (flags.domain ?? flags.host) === "string" ? normaliseHost(String(flags.domain ?? flags.host)) : process.env.SWW_DOMAIN ? normaliseHost(process.env.SWW_DOMAIN) : cfg.domain ?? cfg.host;
  if (command === "login" && sub === "status") {
    const stored = await loadCredentials();
    process.stdout.write(stored ? `Signed in to ${stored.host}. Access ${stored.expiresAt > Date.now() ? "active" : "expired"}.\n` : process.env.SWW_TOKEN ? "Using SWW_TOKEN.\n" : "Signed out.\n");
    return stored || process.env.SWW_TOKEN ? 0 : 1;
  }
  if (command === "login") return login(host, flags);
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
