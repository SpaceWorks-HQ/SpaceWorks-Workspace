import "server-only";
import type { DbClient } from "@/lib/db";
import { listPickableDestinations } from "@/lib/notify/scopedRules";
import { type Actor, ensure, jsonObject } from "./core";

/** Restricted meeting notes stay in personal delivery. Workspace notes may be deliberately shared. */
export async function pickDestinations(
  actor: Actor,
  destinationIds: string[],
  client: DbClient,
) {
  const pickable = await listPickableDestinations(
    actor.workspace.id,
    actor.membership.role,
    client,
  );
  ensure(
    destinationIds.every((id) => pickable.some((d) => d.id === id)),
    "Choose destinations you can send to.",
  );
  const rows = await client.notificationDestination.findMany({
    where: {
      workspaceId: actor.workspace.id,
      id: { in: destinationIds },
      enabled: true,
    },
  });
  for (const row of rows) {
    if (row.kind !== "WORKSPACE_CHANNEL") continue;
    const channelId = jsonObject(row.config).channelId;
    ensure(typeof channelId === "string");
    const channel = await client.channel.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        id: channelId,
        archivedAt: null,
        kind: { not: "DIRECT" },
      },
      include: { members: { where: { userId: actor.user.id } } },
    });
    ensure(
      channel && (channel.kind === "PUBLIC" || channel.members.length > 0),
      "Choose a channel you can open.",
    );
  }
  return rows.map((r) => r.id);
}
