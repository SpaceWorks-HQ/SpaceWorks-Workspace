import "server-only";
import { prisma, type DbClient } from "@/lib/db";
import { sealStored, openStored } from "@/lib/vault/hierarchy";
type Location = { workspaceId: string; environmentId: string; path: string; key: string };
const environmentProjects = new WeakMap<object, Map<string, string>>();
const binding = (v: Location) => JSON.stringify([v.environmentId, v.path, v.key]);
async function project(v: Location, client: DbClient) {
  let cache = client === prisma ? undefined : environmentProjects.get(client);
  if (!cache && client !== prisma) { cache = new Map(); environmentProjects.set(client, cache); }
  const id = v.workspaceId + ":" + v.environmentId, cached = cache?.get(id);
  if (cached) return cached;
  const projectId = (await client.secretEnvironment.findFirstOrThrow({ where: { workspaceId: v.workspaceId, id: v.environmentId }, select: { projectId: true } })).projectId;
  cache?.set(id, projectId); return projectId;
}
export async function sealValue(value: string, location: Location, client: DbClient = prisma) {
  return sealStored(location.workspaceId, await project(location, client), binding(location), JSON.stringify(value), client);
}
export async function openValue(value: { secretEnc: string; dataKeyEnc: string; workspaceId: string; environmentId?: string; path?: string; key?: string; secretId?: string }, client: DbClient = prisma): Promise<string> {
  const location = value.environmentId && value.path && value.key ? value as Location : await client.applicationSecret.findFirstOrThrow({ where: { workspaceId: value.workspaceId, id: value.secretId }, select: { workspaceId: true, environmentId: true, path: true, key: true } });
  const plain: unknown = JSON.parse(await openStored(location.workspaceId, await project(location, client), binding(location), value, client));
  if (typeof plain !== "string") throw new Error("Invalid application secret envelope.");
  return plain;
}
export async function sealPayload(workspaceId: string, environmentId: string, kind: string, id: string, plaintext: string, client: DbClient = prisma) {
  const env = await client.secretEnvironment.findFirstOrThrow({ where: { workspaceId, id: environmentId } });
  return sealStored(workspaceId, env.projectId, JSON.stringify([environmentId, kind, id]), plaintext, client);
}
export async function openPayload(value: { id: string; workspaceId: string; environmentId: string; secretEnc: string; dataKeyEnc: string }, kind: string, client: DbClient = prisma) {
  const env = await client.secretEnvironment.findFirstOrThrow({ where: { workspaceId: value.workspaceId, id: value.environmentId } });
  return openStored(value.workspaceId, env.projectId, JSON.stringify([value.environmentId, kind, value.id]), value, client);
}
