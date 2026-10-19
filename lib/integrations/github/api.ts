import "server-only";
import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { requestJson } from "@/lib/integrations/http";
export async function githubAppJwt() {
  const id = process.env.GITHUB_APP_ID; let key = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!key && process.env.GITHUB_APP_PRIVATE_KEY_FILE) key = await readFile(process.env.GITHUB_APP_PRIVATE_KEY_FILE, "utf8");
  if (!id || !key) throw new Error("Configure the GitHub App on this instance first.");
  const now = Math.floor(Date.now() / 1000); const encode = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 60, exp: now + 540, iss: id })}`;
  return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(key.replace(/\\n/g, "\n"), "base64url")}`;
}
export async function githubRequest<T>(path: string, token: string, body?: unknown): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid GitHub API path.");
  const result = await requestJson<T>(`https://api.github.com${path}`, { label: "GitHub", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, body });
  if (!result.ok) throw new Error(result.error); return result.data;
}
export async function installationToken(installationId: string) {
  if (!/^\d+$/.test(installationId)) throw new Error("Invalid installation id.");
  const result = await githubRequest<{ token: string }>(`/app/installations/${installationId}/access_tokens`, await githubAppJwt(), {}); return result.token;
}
export type GithubItem = { id: number; number: number; title: string; html_url: string; state: string; pull_request?: unknown };
export async function repositoryItems(installationId: string, fullName: string) {
  const token = await installationToken(installationId); const path = fullName.split("/").map(encodeURIComponent).join("/");
  return githubRequest<GithubItem[]>(`/repos/${path}/issues?state=open&per_page=50`, token);
}
