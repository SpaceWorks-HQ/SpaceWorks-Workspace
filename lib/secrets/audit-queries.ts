import "server-only";
import { prisma } from "@/lib/db";
import { guard } from "@/lib/approvals/ops";
import { canManageSecrets } from "@/lib/roles";
import { environmentAccess, type SecretsActor } from "./access";
import { zonedInputToIso } from "@/lib/timeZone";
import { SecretsError } from "./values";

export async function projectAudit(
  actor: SecretsActor,
  projectId: string,
  action?: string,
  environmentId?: string,
  from?: string,
  until?: string,
) {
  await guard(actor);
  const project = await prisma.secretProject.findFirst({
    where: { workspaceId: actor.workspace.id, id: projectId },
    include: { environments: { select: { id: true } } },
  });
  if (!project) return [];
  const ids = [];
  for (const e of project.environments)
    try {
      await environmentAccess(actor, e.id, "ADMIN");
      ids.push(e.id);
    } catch {}
  const start = from
    ? zonedInputToIso(from + "T00:00", actor.workspace.timezone)
    : null;
  const end = until
    ? zonedInputToIso(until + "T23:59", actor.workspace.timezone)
    : null;
  if ((from && !start) || (until && !end) || (start && end && start > end))
    throw new SecretsError("Choose a valid audit date range.");
  const result = await prisma.secretAudit.findMany({
    where: {
      workspaceId: actor.workspace.id,
      projectId,
      ...(action ? { action: { contains: action } } : {}),
      ...(start || end
        ? {
            createdAt: {
              ...(start ? { gte: new Date(start) } : {}),
              ...(end
                ? { lt: new Date(new Date(end).getTime() + 60_000) }
                : {}),
            },
          }
        : {}),
      OR: [
        {
          environmentId: {
            in: environmentId ? ids.filter((id) => id === environmentId) : ids,
          },
        },
        ...(canManageSecrets(actor.membership)
          ? [{ environmentId: null }]
          : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 10001,
  });
  if (result.length > 10000)
    throw new SecretsError(
      "There are too many audit records. Narrow the date range and try again.",
    );
  return result;
}
