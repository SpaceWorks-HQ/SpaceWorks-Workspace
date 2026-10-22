import { spawnSync } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  chmod,
  lstat,
  rename,
} from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
export type Credentials = {
  host: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};
export function credentialsDirectory() {
  return process.env.SWW_CONFIG_DIR ?? join(homedir(), ".config", "sww");
}
function command(program: string, args: string[], input?: string) {
  return spawnSync(program, args, {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 3000,
    windowsHide: true,
  });
}
export async function writePrivateFile(path: string, text: string) {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error("Refusing to replace an unsafe credentials path.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = path + "." + randomBytes(8).toString("hex");
  await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}
export async function saveCredentials(value: Credentials) {
  const directory = credentialsDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (stat.isSymbolicLink())
    throw new Error("Use a credentials directory without symbolic links.");
  await chmod(directory, 0o700);
  const text = JSON.stringify(value);
  let keychain = false;
  if (!process.env.SWW_DISABLE_KEYCHAIN) {
    if (process.platform === "darwin")
      keychain =
        command("security", [
          "add-generic-password",
          "-U",
          "-s",
          "spaceworks-workspace-cli",
          "-a",
          value.host,
          "-w",
          text,
        ]).status === 0;
    else if (process.platform === "linux")
      keychain =
        command(
          "secret-tool",
          [
            "store",
            "--label=Space Works Workspace CLI",
            "application",
            "sww",
            "host",
            value.host,
          ],
          text,
        ).status === 0;
  }
  await writePrivateFile(
    join(directory, "credentials.json"),
    JSON.stringify(keychain ? { host: value.host, keychain: true } : value),
  );
}
export async function loadCredentials(): Promise<Credentials | null> {
  try {
    const file = join(credentialsDirectory(), "credentials.json"),
      stat = await lstat(file);
    if (
      stat.isSymbolicLink() ||
      (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
    )
      throw new Error("Credentials file permissions must be 0600.");
    const stored = JSON.parse(await readFile(file, "utf8"));
    let value = stored;
    if (stored.keychain) {
      const result =
        process.platform === "darwin"
          ? command("security", [
              "find-generic-password",
              "-s",
              "spaceworks-workspace-cli",
              "-a",
              stored.host,
              "-w",
            ])
          : command("secret-tool", [
              "lookup",
              "application",
              "sww",
              "host",
              stored.host,
            ]);
      if (result.status !== 0)
        throw new Error("Unlock the OS keychain and try again.");
      value = JSON.parse(result.stdout);
    }
    if (
      typeof value.host !== "string" ||
      typeof value.accessToken !== "string" ||
      typeof value.refreshToken !== "string" ||
      !Number.isFinite(value.expiresAt)
    )
      throw new Error("Sign in again.");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export async function clearCredentials() {
  const stored = await loadCredentials();
  if (stored) {
    if (process.platform === "darwin")
      command("security", [
        "delete-generic-password",
        "-s",
        "spaceworks-workspace-cli",
        "-a",
        stored.host,
      ]);
    else if (process.platform === "linux")
      command("secret-tool", [
        "clear",
        "application",
        "sww",
        "host",
        stored.host,
      ]);
  }
  const { unlink } = await import("node:fs/promises");
  await unlink(join(credentialsDirectory(), "credentials.json")).catch(
    (error) => {
      if (error.code !== "ENOENT") throw error;
    },
  );
}
