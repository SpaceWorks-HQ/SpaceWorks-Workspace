export type Arguments = {
  positionals: string[];
  flags: Record<string, string | boolean>;
  command: string[];
};
const VALUE_FLAGS = new Set([
  "host", "domain", "projectId", "method", "client-id", "client-secret",
  "project",
  "env",
  "path",
  "format",
  "mfa",
  "name",
]);
export function parseArguments(args: string[]): Arguments {
  const result: Arguments = { positionals: [], flags: {}, command: [] };
  for (let i = 0; i < args.length; i++) {
    const part = args[i];
    if (part === "--") {
      result.command = args.slice(i + 1);
      break;
    }
    if (part.startsWith("--")) {
      const equal = part.indexOf("=");
      const key = part.slice(2, equal < 0 ? undefined : equal);
      if (["help", "no-open", "plain", "silent", "staged", "pre-commit", "history"].includes(key)) {
        result.flags[key] = true;
        continue;
      }
      if (!VALUE_FLAGS.has(key))
        throw new Error("Unknown option. Run sww --help.");
      const value = equal < 0 ? args[++i] : part.slice(equal + 1);
      if (!value || value.startsWith("--"))
        throw new Error(`--${key} needs a value.`);
      result.flags[key] = value;
    } else if (part === "-i") result.flags["no-open"] = true;
    else result.positionals.push(part);
  }
  return result;
}
export function formatValues(values: Record<string, string>, format: string) {
  const entries = Object.entries(values).sort(([a], [b]) => a.localeCompare(b));
  if (format === "json")
    return JSON.stringify(Object.fromEntries(entries), null, 2) + "\n";
  if (format === "yaml")
    return (
      entries
        .map(([k, v]) => JSON.stringify(k) + ": " + JSON.stringify(v))
        .join("\n") + "\n"
    );
  if (format !== "env" && format !== "dotenv") throw new Error("Choose env, json or yaml.");
  return entries.map(([k, v]) => k + "=" + JSON.stringify(v)).join("\n") + "\n";
}
export function injectedEnvironment(
  values: Record<string, string>,
  base: NodeJS.ProcessEnv = process.env,
) {
  const env = { ...base };
  delete env.SWW_TOKEN;
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(key) || value.includes("\0"))
      throw new Error(
        "A secret cannot be represented as an environment variable.",
      );
    env[key] = value;
  }
  return env;
}
