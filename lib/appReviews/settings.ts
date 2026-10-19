import "server-only";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret, type SecretPurpose } from "@/lib/crypto";
import { recordAuditEvent } from "@/lib/audit";
import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import type { WorkspaceContext } from "@/lib/permissions";
import { canManageAppReviews } from "@/lib/roles";
import { setScopedDestinations } from "@/lib/notify/scopedRules";
import { accountSchema, appSchema, slackConfigSchema, slackMemberSchema } from "./validation";
import { appleJwt } from "./stores/apple";
import { googleCredentials } from "./stores/google";
import { storeFor } from "./stores";
import { requestJson } from "./stores/http";
import { safeStoreError } from "./stores/types";

const seal = (purpose: SecretPurpose, fresh: string | undefined, old: string | null | undefined) => fresh ? encryptSecret(purpose, fresh) : old ?? null;
const open = (purpose: SecretPurpose, value: string | null) => value ? decryptSecret(purpose, value) : "";
export async function saveAccount(ctx: WorkspaceContext, input: unknown): Promise<ActionResult<{ id: string }>> {
  if (!canManageAppReviews(ctx.membership)) return actionError(NOT_ALLOWED);
  const parsed = accountSchema.safeParse(input); if (!parsed.success) return validationError(parsed.error); const d = parsed.data;
  const old = d.id ? await prisma.appStoreAccount.findFirst({ where: { workspaceId: ctx.workspace.id, id: d.id } }) : null;
  if (d.id && (!old || old.platform !== d.platform)) return actionError("That store account isn't available.");
  try {
    const secrets = { issuerIdEnc: seal("app-review-issuer", d.issuerId, old?.issuerIdEnc), keyIdEnc: seal("app-review-key-id", d.keyId, old?.keyIdEnc), privateKeyP8Enc: seal("app-review-private-key", d.privateKeyP8, old?.privateKeyP8Enc), serviceAccountJsonEnc: seal("app-review-service-account", d.serviceAccountJson, old?.serviceAccountJsonEnc), proxyUrlEnc: d.clearProxy ? null : seal("app-review-account-proxy", d.proxyUrl, old?.proxyUrlEnc) };
    if (d.platform === "APPLE") {
      if (!secrets.issuerIdEnc || !secrets.keyIdEnc || !secrets.privateKeyP8Enc) return actionError("Add the Apple issuer ID, key ID and private key.");
      appleJwt({ issuerId: open("app-review-issuer", secrets.issuerIdEnc), keyId: open("app-review-key-id", secrets.keyIdEnc), privateKeyP8: open("app-review-private-key", secrets.privateKeyP8Enc) });
      secrets.serviceAccountJsonEnc = null;
    } else { googleCredentials(open("app-review-service-account", secrets.serviceAccountJsonEnc)); secrets.issuerIdEnc = null; secrets.keyIdEnc = null; secrets.privateKeyP8Enc = null; }
    const row = await prisma.$transaction(async tx => {
      const data = { name: d.name, platform: d.platform, active: d.active, ...secrets };
      const saved = old ? await tx.appStoreAccount.update({ where: { id: old.id, workspaceId: ctx.workspace.id }, data }) : await tx.appStoreAccount.create({ data: { workspaceId: ctx.workspace.id, ...data } });
      await recordAuditEvent({ action: "app_review.account_saved", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "AppStoreAccount", targetId: saved.id, client: tx });
      return saved;
    });
    return { ok: true, data: { id: row.id } };
  } catch (error) { return actionError(safeStoreError(error)); }
}
export async function saveApp(ctx: WorkspaceContext, input: unknown): Promise<ActionResult<{ id: string }>> {
  if (!canManageAppReviews(ctx.membership)) return actionError(NOT_ALLOWED);
  const parsed = appSchema.safeParse(input); if (!parsed.success) return validationError(parsed.error); const d = parsed.data; const workspaceId = ctx.workspace.id;
  const [account, old, project, service] = await Promise.all([
    prisma.appStoreAccount.findFirst({ where: { workspaceId, id: d.accountId, platform: d.platform }, select: { id: true, proxyUrlEnc: true } }),
    d.id ? prisma.reviewedApp.findFirst({ where: { workspaceId, id: d.id } }) : null,
    d.linkedProjectId ? prisma.project.findFirst({ where: { workspaceId, id: d.linkedProjectId, status: { not: "ARCHIVED" } }, select: { id: true } }) : null,
    d.linkedServiceId ? prisma.serviceCatalogItem.findFirst({ where: { workspaceId, id: d.linkedServiceId }, select: { id: true } }) : null,
  ]);
  if (!account || (d.id && !old) || (old && (old.platform !== d.platform || old.appIdentifier !== d.appIdentifier))) return actionError("Choose an account for this app. Existing app identifiers cannot change.");
  if ((d.linkedProjectId && !project) || (d.linkedServiceId && !service)) return actionError("Choose a project or service in this workspace.");
  const proxyUrlEnc = d.clearProxy ? null : seal("app-review-app-proxy", d.proxyUrl, old?.proxyUrlEnc);
  if (d.active && !proxyUrlEnc && !account.proxyUrlEnc && !d.allowNoProxy) return actionError("Add an egress proxy or allow a direct connection for this app.");
  try {
    const saved = await prisma.$transaction(async tx => {
      const { id: _id, destinationIds, routingRatings, proxyUrl: _proxy, clearProxy: _clear, ...fields } = d; void _id; void _proxy; void _clear;
      const data = { ...fields, proxyUrlEnc, linkedProjectId: d.linkedProjectId || null, linkedServiceId: d.linkedServiceId || null, slackChannelId: d.slackChannelId || null, translationLanguage: d.translationLanguage || null, nextPollAt: new Date() };
      const row = old ? await tx.reviewedApp.update({ where: { id: old.id, workspaceId }, data }) : await tx.reviewedApp.create({ data: { workspaceId, ...data } });
      const routing = await setScopedDestinations(tx, { workspaceId, scopeType: "REVIEWED_APP", scopeId: row.id, destinationIds, actorId: ctx.user.id, eventTypes: ["app_review.*"] });
      if (routing.ruleId) await tx.notificationRule.update({ where: { id: routing.ruleId, workspaceId }, data: { filters: { ratings: routingRatings } } });
      await recordAuditEvent({ action: "app_review.app_saved", workspaceId, actorId: ctx.user.id, targetType: "ReviewedApp", targetId: row.id, client: tx });
      return row;
    }); return { ok: true, data: { id: saved.id } };
  } catch { return actionError("Couldn't save this app. Check for a duplicate app identifier and try again."); }
}
export async function testAppConnection(ctx: WorkspaceContext, id: string): Promise<ActionResult> {
  if (!canManageAppReviews(ctx.membership)) return actionError(NOT_ALLOWED);
  const app = await prisma.reviewedApp.findFirst({ where: { workspaceId: ctx.workspace.id, id }, include: { account: true } });
  if (!app) return actionError("That app isn't available.");
  try {
    const client = storeFor({ ...app, active: true }, { ...app.account, active: true });
    const reviews = client.reviews(); await reviews.next(); await reviews.return(undefined);
    await prisma.appStoreAccount.update({ where: { id: app.accountId, workspaceId: ctx.workspace.id }, data: { lastError: null } });
    await recordAuditEvent({ action: "app_review.connection_tested", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "ReviewedApp", targetId: app.id });
    return { ok: true };
  } catch (error) { const message = safeStoreError(error); await prisma.appStoreAccount.update({ where: { id: app.accountId, workspaceId: ctx.workspace.id }, data: { lastError: message } }); return actionError(message); }
}
export async function saveSlackConfig(ctx: WorkspaceContext, input: unknown): Promise<ActionResult> {
  if (!canManageAppReviews(ctx.membership)) return actionError(NOT_ALLOWED);
  const parsed = slackConfigSchema.safeParse(input); if (!parsed.success) return validationError(parsed.error); const d = parsed.data;
  const old = await prisma.appReviewSlackConfig.findUnique({ where: { workspaceId: ctx.workspace.id } });
  if ((!d.botToken && !old) || (!d.signingSecret && !old)) return actionError("Add a bot token and signing secret.");
  try {
    const botTokenEnc = seal("app-review-slack-token", d.botToken, old?.botTokenEnc)!;
    const signingSecretEnc = seal("app-review-slack-signing", d.signingSecret, old?.signingSecretEnc)!;
    let teamId = old?.teamId; let botUserId = old?.botUserId;
    if (d.botToken || !old) {
      const result = await requestJson<{ ok: boolean; team_id?: string; user_id?: string }>("https://slack.com/api/auth.test", { method: "POST", headers: { Authorization: `Bearer ${open("app-review-slack-token", botTokenEnc)}` } });
      if (!result.ok || !result.team_id || !result.user_id) return actionError("Slack refused this bot token. Check the app installation.");
      teamId = result.team_id; botUserId = result.user_id;
    }
    await prisma.$transaction(async tx => {
      const data = { botTokenEnc, signingSecretEnc, teamId: teamId!, botUserId: botUserId!, replyTriggerEmoji: d.replyTriggerEmoji, active: d.active };
      if (old && old.teamId !== teamId) {
        await tx.appReviewSlackMember.deleteMany({ where: { workspaceId: ctx.workspace.id } });
        await tx.appReviewSlackEvent.updateMany({ where: { workspaceId: ctx.workspace.id, status: { in: ["QUEUED", "PROCESSING"] } }, data: { status: "IGNORED", processedAt: new Date() } });
        // Old team/channel references must never authorise replies in the new team.
        await tx.appReview.updateMany({ where: { workspaceId: ctx.workspace.id, slackPostStatus: { in: ["POSTED", "POSTING"] } }, data: { slackPostStatus: "FAILED", slackMessageTs: null } });
      }
      await tx.appReviewSlackConfig.upsert({ where: { workspaceId: ctx.workspace.id }, create: { workspaceId: ctx.workspace.id, ...data }, update: data });
      await recordAuditEvent({ action: "app_review.slack_configured", workspaceId: ctx.workspace.id, actorId: ctx.user.id, client: tx });
    }); return { ok: true };
  } catch (error) { return actionError(safeStoreError(error)); }
}
export async function saveSlackMember(ctx: WorkspaceContext, input: unknown): Promise<ActionResult> {
  if (!canManageAppReviews(ctx.membership)) return actionError(NOT_ALLOWED);
  const parsed = slackMemberSchema.safeParse(input); if (!parsed.success) return validationError(parsed.error); const d = parsed.data;
  const member = await prisma.membership.findFirst({ where: { workspaceId: ctx.workspace.id, userId: d.userId, status: "ACTIVE", role: { not: "GUEST" }, user: { disabledAt: null } }, select: { userId: true } });
  if (!member) return actionError("Choose an active member of this workspace.");
  await prisma.$transaction(async tx => {
    await tx.appReviewSlackMember.upsert({ where: { workspaceId_slackUserId: { workspaceId: ctx.workspace.id, slackUserId: d.slackUserId } }, create: { workspaceId: ctx.workspace.id, ...d }, update: { userId: d.userId } });
    await recordAuditEvent({ action: "app_review.slack_member_mapped", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetId: d.userId, client: tx });
  }); return { ok: true };
}
