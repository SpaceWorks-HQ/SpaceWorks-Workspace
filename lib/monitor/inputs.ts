import { z } from "zod";
const id = z.string().min(1).max(64);
const ids = z.array(id).max(100).default([]);
const name = z.string().trim().min(1).max(150);
const body = z.string().trim().min(1).max(20000);
const status = z.enum(["INVESTIGATING", "IDENTIFIED", "MONITORING", "RESOLVED"]);
const time = z.string().datetime({ offset: true });
export const serviceCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("pause"), id, enabled: z.boolean() }),
  z.object({ command: z.literal("deleteMonitor"), id }),
  z.object({ command: z.literal("rotateHeartbeat"), id }),
  z.object({ command: z.literal("testMonitor"), id }),
  z.object({ command: z.literal("testAlert"), id }),
  z.object({ command: z.literal("acknowledge"), id }),
  z.object({ command: z.literal("createIncident"), title: name, monitorIds: ids, impact: z.enum(["NONE", "MINOR", "MAJOR", "CRITICAL"]).default("MAJOR"), public: z.boolean().default(false), bodyMd: body, escalationPolicyId: id.nullish() }),
  z.object({ command: z.literal("updateIncident"), id, status, bodyMd: body, public: z.boolean().default(false) }),
  z.object({ command: z.literal("postmortem"), id, postmortemMd: z.string().max(50000), postmortemDocId: id.nullish() }),
  z.object({ command: z.literal("followUp"), id, title: name, projectId: id.nullish() }),
  z.object({ command: z.literal("maintenance"), title: name, descriptionMd: z.string().max(10000).optional(), startsAt: time, endsAt: time.nullish(), rrule: z.string().max(300).nullish(), durationMin: z.coerce.number().int().min(1).max(10080).optional(), timezone: z.string().max(64).default("UTC"), allMonitors: z.boolean().default(false), monitorIds: ids, suppressAlerts: z.boolean().default(true), showOnStatusPage: z.boolean().default(true) }),
  z.object({ command: z.literal("deleteMaintenance"), id }),
  z.object({ command: z.literal("settings"), membersCanAckIncidents: z.boolean(), costsVisibleToMembers: z.boolean(), monitorRetentionDays: z.coerce.number().int().min(7).max(30) }),
  z.object({ command: z.literal("allowlist"), cidrOrHost: z.string().max(253), note: z.string().max(300).optional() }),
  z.object({ command: z.literal("deleteAllowlist"), id }),
  z.object({ command: z.literal("statusPage"), enabled: z.boolean(), title: name, descriptionMd: z.string().max(5000).optional(), footerMd: z.string().max(5000).optional(), noindex: z.boolean().default(true), showUptimePercent: z.boolean().default(true), components: z.array(z.object({ monitorId: id, key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/), displayName: name, group: z.string().max(100).optional(), showLatency: z.boolean().default(false) })).max(100) }),
  z.object({ command: z.literal("cloudAccount"), id: id.optional(), provider: z.enum(["DIGITALOCEAN", "AWS", "RENDER", "CLOUDFLARE", "HETZNER", "VERCEL", "NETLIFY", "FLY", "RAILWAY", "GITHUB_ACTIONS", "PROMETHEUS", "CONTABO", "LINODE", "VULTR", "SCALEWAY", "SUPABASE"]), label: name, credentials: z.record(z.string().max(64), z.string().max(5000)), config: z.record(z.string(), z.unknown()).default({}), autoCreateMonitors: z.boolean().default(false) }),
  z.object({ command: z.literal("syncCloud"), id }),
  z.object({ command: z.literal("deleteCloud"), id }),
  z.object({ command: z.literal("budget"), connectionId: id.nullish(), monthlyLimitMinor: z.coerce.number().int().min(1).max(2000000000), currency: z.string().regex(/^[A-Z]{3}$/), thresholdsPct: z.array(z.coerce.number().int().min(1).max(1000)).max(10).default([50, 80, 100]), destinationIds: ids }),
  z.object({ command: z.literal("onCall"), name, timezone: z.string().max(64), rotation: z.enum(["DAILY", "WEEKLY"]), handoffTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), participants: ids, overrides: z.array(z.object({ userId: id, start: time, end: time })).max(100).default([]) }),
  z.object({ command: z.literal("escalationPolicy"), name, repeat: z.coerce.number().int().min(0).max(5).default(0), steps: z.array(z.object({ delayMin: z.coerce.number().int().min(0).max(1440), targets: z.array(z.object({ type: z.enum(["USER", "SCHEDULE", "DESTINATION"]), id })).min(1).max(20) })).min(1).max(10) }),
]);
export type ServiceCommand = z.infer<typeof serviceCommandSchema>;
