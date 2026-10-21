import { beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import {
  createUser,
  createWorkspace,
  addMember,
  cleanup,
  uniqueSuffix,
} from "@/tests/helpers/fixtures";
import {
  createProject,
} from "@/lib/secrets/service";
import { type SecretsActor } from "@/lib/secrets/access";
import { hmacHex } from "@/lib/crypto";

export const suffix = uniqueSuffix(),
  domain = `${suffix}@secrets.test`,
  slugs = [`secrets-${suffix}`, `secrets-other-${suffix}`];
export let owner: SecretsActor,
  admin: SecretsActor,
  member: SecretsActor,
  guest: SecretsActor,
  other: SecretsActor;
export const records = { counter: 0 };
export async function project() {
  const id = await createProject(owner, {
    name: `Project ${++records.counter}`,
    slug: `project-${records.counter}`,
  });
  const envs = await prisma.secretEnvironment.findMany({
    where: { workspaceId: owner.workspace.id, projectId: id },
  });
  return {
    id,
    dev: envs.find((e) => e.slug === "dev")!,
    staging: envs.find((e) => e.slug === "staging")!,
    production: envs.find((e) => e.production)!,
  };
}
export async function proof(actor: SecretsActor) {
  const now = new Date();
  const user = await prisma.user.update({
    where: { id: actor.user.id },
    data: { mfaEnabledAt: new Date(now.getTime() - 1000) },
  });
  const body = Buffer.from(
    JSON.stringify({
      u: user.id,
      v: user.sessionVersion,
      m: user.mfaEnabledAt!.getTime(),
      at: now.getTime(),
    }),
  ).toString("base64url");
  return body + "." + hmacHex(process.env.AUTH_SECRET!, `vault-step:${body}`);
}
beforeAll(async () => {
  process.env.VAULT_MASTER_KEY = Buffer.alloc(32, 17).toString("base64");
  const o = await createUser("owner-" + domain),
    a = await createUser("admin-" + domain),
    m = await createUser("member-" + domain),
    g = await createUser("guest-" + domain);
  const w = await createWorkspace(slugs[0], o.id),
    w2 = await createWorkspace(slugs[1], o.id);
  await addMember(w.id, a.id, "ADMIN");
  await addMember(w.id, m.id);
  await addMember(w.id, g.id, "GUEST");
  owner = { user: o, workspace: w, membership: { role: "OWNER" } };
  admin = { user: a, workspace: w, membership: { role: "ADMIN" } };
  member = { user: m, workspace: w, membership: { role: "MEMBER" } };
  guest = { user: g, workspace: w, membership: { role: "GUEST" } };
  other = { ...owner, workspace: w2 };
});
afterAll(async () => {
  await cleanup(slugs, domain);
  await prisma.$disconnect();
});
