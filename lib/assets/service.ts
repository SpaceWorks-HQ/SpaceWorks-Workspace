import "server-only";
import { z } from "zod";
import { randomToken } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { isAdmin, type OpsActor } from "@/lib/approvals/context";
import { guard, parse, id, title, optionalId, optionalDate, memberRef, lockAsset, OpsError, note, searchable } from "@/lib/approvals/ops";

export async function listAssets(actor: OpsActor) {
 await guard(actor);
 return prisma.asset.findMany({ where: { workspaceId: actor.workspace.id }, include: { checkouts: { where: { returnedAt: null } }, bookings: { where: { status: "CONFIRMED", endsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } }, maintenance: { orderBy: { at: "desc" }, take: 5 } }, orderBy: { name: "asc" }, take: 500 });
}
export async function saveAsset(actor: OpsActor, input: unknown) {
 await guard(actor, true);
 const v = parse(z.object({ id: optionalId, name: title, category: title, location: z.string().trim().max(200).optional(), condition: z.string().trim().max(200).optional(), bookable: z.boolean().default(true), checkoutable: z.boolean().default(true), status: z.enum(["AVAILABLE", "IN_MAINTENANCE", "LOST", "RETIRED"]).default("AVAILABLE") }), input);
 return prisma.$transaction(async tx => {
  if (v.id) { await lockAsset(tx, actor.workspace.id, v.id); if (await tx.assetCheckout.count({ where: { assetId: v.id, returnedAt: null, asset: { workspaceId: actor.workspace.id } } })) throw new OpsError("Return this equipment before changing its inventory status."); }
  const { id: assetId, ...data } = v;
  const row = assetId ? await tx.asset.update({ where: { id: assetId, workspaceId: actor.workspace.id }, data }) : await tx.asset.create({ data: { ...data, workspaceId: actor.workspace.id, tag: randomToken(12) } });
  await note(actor, "asset", row.id, "saved", tx); await searchable(actor, "asset", row.id, row.name, "assets", null, tx); return row.id;
 });
}
export async function bookAsset(actor: OpsActor, input: unknown) {
 await guard(actor);
 const v = parse(z.object({ assetId: id, startsAt: z.coerce.date(), endsAt: z.coerce.date(), purpose: z.string().trim().max(500).optional() }).refine(v => v.startsAt < v.endsAt && v.startsAt >= new Date(), "Choose a future time with an end after the start."), input);
 return prisma.$transaction(async tx => {
  await lockAsset(tx, actor.workspace.id, v.assetId);
  const asset = await tx.asset.findFirstOrThrow({ where: { id: v.assetId, workspaceId: actor.workspace.id } });
  if (!asset.bookable || !["AVAILABLE", "RESERVED"].includes(asset.status)) throw new OpsError("This equipment cannot be booked right now.");
  if (await tx.assetBooking.findFirst({ where: { assetId: asset.id, asset: { workspaceId: actor.workspace.id }, status: "CONFIRMED", startsAt: { lt: v.endsAt }, endsAt: { gt: v.startsAt } } })) throw new OpsError("That time is already booked. Choose another time.");
  const row = await tx.assetBooking.create({ data: { ...v, userId: actor.user.id } }); await note(actor, "asset", asset.id, "booked", tx); return row.id;
 });
}
export async function checkoutAsset(actor: OpsActor, input: unknown) {
 await guard(actor); const v = parse(z.object({ assetId: id, dueAt: z.coerce.date().refine(v => v > new Date(), "Choose a future return date.") }), input);
 return prisma.$transaction(async tx => {
  await lockAsset(tx, actor.workspace.id, v.assetId);
  const asset = await tx.asset.findFirstOrThrow({ where: { id: v.assetId, workspaceId: actor.workspace.id } });
  if (asset.status !== "AVAILABLE" || !asset.checkoutable) throw new OpsError("This equipment is not available to borrow.");
  if (asset.maxCheckoutDays && v.dueAt.getTime() > Date.now() + asset.maxCheckoutDays * 86400000) throw new OpsError(`Return it within ${asset.maxCheckoutDays} days.`);
  if (asset.requiresCertTypeId && !await tx.certification.findFirst({ where: { certTypeId: asset.requiresCertTypeId, userId: actor.user.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: v.dueAt } }], certType: { workspaceId: actor.workspace.id } } })) throw new OpsError("A current certification is required to borrow this equipment.");
  if (await tx.assetBooking.findFirst({ where: { assetId: asset.id, status: "CONFIRMED", userId: { not: actor.user.id }, startsAt: { lt: v.dueAt }, endsAt: { gt: new Date() }, asset: { workspaceId: actor.workspace.id } } })) throw new OpsError("Someone has booked this equipment before your return date.");
  await tx.asset.update({ where: { id: asset.id, workspaceId: actor.workspace.id }, data: { status: "CHECKED_OUT" } });
  const row = await tx.assetCheckout.create({ data: { assetId: asset.id, userId: actor.user.id, dueAt: v.dueAt, conditionOut: asset.condition } }); await note(actor, "asset", asset.id, "checked_out", tx); return row.id;
 });
}
export async function returnAsset(actor: OpsActor, input: unknown) {
 await guard(actor); const v = parse(z.object({ assetId: id, condition: z.string().trim().min(1).max(200) }), input);
 await prisma.$transaction(async tx => {
  await lockAsset(tx, actor.workspace.id, v.assetId);
  const row = await tx.assetCheckout.findFirst({ where: { assetId: v.assetId, asset: { workspaceId: actor.workspace.id }, returnedAt: null } });
  if (!row || (!isAdmin(actor) && row.userId !== actor.user.id)) throw new OpsError("Only the borrower or an admin can return this equipment.");
  await tx.assetCheckout.update({ where: { id: row.id }, data: { returnedAt: new Date(), conditionIn: v.condition } });
  await tx.asset.update({ where: { id: v.assetId, workspaceId: actor.workspace.id }, data: { status: "AVAILABLE", condition: v.condition } }); await note(actor, "asset", v.assetId, "returned", tx);
 });
}
export async function cancelBooking(actor: OpsActor, bookingId: string) {
 await guard(actor); parse(id, bookingId);
 const result = await prisma.assetBooking.updateMany({ where: { id: bookingId, asset: { workspaceId: actor.workspace.id }, ...(!isAdmin(actor) ? { userId: actor.user.id } : {}) }, data: { status: "CANCELLED" } });
 if (!result.count) throw new OpsError("That booking is unavailable."); await note(actor, "asset", bookingId, "booking_cancelled");
}
export async function logMaintenance(actor: OpsActor, input: unknown) {
 await guard(actor, true); const v = parse(z.object({ assetId: id, type: z.enum(["REPAIR", "SERVICE", "INSPECTION", "NOTE"]), note: z.string().trim().min(1).max(2000), nextDueAt: optionalDate }), input);
 await prisma.$transaction(async tx => { await lockAsset(tx, actor.workspace.id, v.assetId); await tx.assetMaintenanceLog.create({ data: { ...v, byUserId: actor.user.id } }); await note(actor, "asset", v.assetId, "maintained", tx); });
}
export async function saveKey(actor: OpsActor, input: unknown) {
 await guard(actor, true); const v = parse(z.object({ id: optionalId, label: title, type: z.enum(["KEY", "FOB", "CARD", "CODE"]), area: z.string().trim().max(200).optional(), holderUserId: optionalId, status: z.enum(["ISSUED", "IN_SAFE", "LOST", "RETIRED"]) }), input); await memberRef(actor, v.holderUserId);
 if (v.status === "ISSUED" && !v.holderUserId) throw new OpsError("Choose the member holding this key.");
 const { id: keyId, ...data } = v;
 const row = keyId ? await prisma.accessCredential.update({ where: { id: keyId, workspaceId: actor.workspace.id }, data: { ...data, issuedAt: v.status === "ISSUED" ? new Date() : undefined, returnedAt: v.status === "IN_SAFE" ? new Date() : null } }) : await prisma.accessCredential.create({ data: { ...data, workspaceId: actor.workspace.id, issuedAt: v.status === "ISSUED" ? new Date() : null } });
 await note(actor, "asset", row.id, "key_saved"); return row.id;
}
