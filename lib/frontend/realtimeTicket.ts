import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { getRedis } from "@/lib/redis";
const ticketKey = (token: string) => `sww:realtime-ticket:${createHash("sha256").update(token).digest("hex")}`;
export async function issueRealtimeTicket(workspaceSlug: string, userId: string, sessionVersion: number) {
  const redis = getRedis();
  if (!redis) throw new Error("Realtime requires Redis in split hosting.");
  const token = randomBytes(32).toString("hex");
  const saved = await redis.set(ticketKey(token), JSON.stringify({ workspaceSlug, userId, sessionVersion }), "EX", 60, "NX");
  if (saved !== "OK") throw new Error("Stream ticket could not be issued.");
  return token;
}
export async function consumeRealtimeTicket(token: string, workspaceSlug: string): Promise<{ userId: string; sessionVersion: number } | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const redis = getRedis();
  if (!redis) return null;
  const value = await redis.getdel(ticketKey(token));
  if (!value) return null;
  const claim = JSON.parse(value);
  return claim.workspaceSlug === workspaceSlug && typeof claim.userId === "string" && Number.isInteger(claim.sessionVersion) ? claim : null;
}
