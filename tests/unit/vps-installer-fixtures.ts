import { spawnSync } from "node:child_process";
import path from "node:path";

export const root = path.resolve(import.meta.dirname, "../..");
export const scripts = [
  "install.sh", "scripts/vps-lib.sh", "scripts/setup-vps.sh", "scripts/update-vps.sh", "scripts/vps-backup.sh",
  "scripts/vps-restore.sh", "scripts/vps-status.sh", "scripts/install-docker.sh", "scripts/vps-backup-settings.sh",
  "scripts/vps-reconfigure.sh", "scripts/vps-harden.sh", "scripts/vps-recover.sh", "scripts/vps-renew-certs.sh",
  "scripts/vps-support.sh", "scripts/vps-uninstall.sh",
];
// Run a snippet with the shared VPS helpers loaded; prints whatever the snippet echoes.
export const lib = (snippet: string) =>
  spawnSync("bash", ["-c", `. scripts/vps-lib.sh; ${snippet}`], { cwd: root, encoding: "utf8" });
