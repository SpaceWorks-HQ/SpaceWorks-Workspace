/**
 * Direct messages (pure). A DM is a Channel of kind DIRECT whose `dmKey` is
 * "<workspaceId>:<sorted participant ids joined by ':'>", so the same group
 * of people always lands in the same conversation.
 */

/** Participants including the person starting it. */
export const MAX_DM_PARTICIPANTS = 8;

export function dmParticipants(starterId: string, others: string[]): string[] {
  return [...new Set([starterId, ...others].map((id) => id.trim()).filter(Boolean))].sort();
}

export function dmKey(workspaceId: string, participantIds: string[]): string {
  const ids = [...new Set(participantIds)].sort();
  if (ids.length === 0) throw new Error("A direct message needs at least one participant.");
  return `${workspaceId}:${ids.join(":")}`;
}

/** Participant ids stored in a dmKey (empty when the key belongs to another workspace). */
export function participantsFromKey(key: string, workspaceId: string): string[] {
  const [owner, ...ids] = key.split(":");
  return owner === workspaceId ? ids.filter(Boolean) : [];
}

/** "Meera Nair, Joel Thomas" from the viewer's side; a note-to-self says so. */
export function dmTitle(participants: Array<{ id: string; name: string | null }>, viewerId: string): string {
  const others = participants.filter((p) => p.id !== viewerId);
  if (others.length === 0) {
    const self = participants.find((p) => p.id === viewerId);
    return `${self?.name ?? "You"} (you)`;
  }
  const names = others.map((p) => p.name?.trim() || "Former member");
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`;
}
