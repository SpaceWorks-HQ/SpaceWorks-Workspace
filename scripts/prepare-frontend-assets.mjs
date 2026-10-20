// Export public files and the allow-listed, prerendered metadata bodies to nginx.
// Never copy page HTML, RSC payloads, build manifests or private server artifacts.
import { cpSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
export function prepareFrontendAssets(root) {
  const target = join(root, "frontend-public");
  mkdirSync(target, { recursive: true });
  cpSync(join(root, "public"), target, { recursive: true });
  for (const name of ["robots.txt", "manifest.webmanifest", "favicon.ico", "icon.svg", "apple-icon.png"]) {
    const source = join(root, ".next/server/app", `${name}.body`);
    // Metadata that is dynamic in a future build stays on the backend proxy path.
    if (existsSync(source)) copyFileSync(source, join(target, name));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) prepareFrontendAssets(process.cwd());
