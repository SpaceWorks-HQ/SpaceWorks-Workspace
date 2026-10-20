import "server-only";
import { z } from "zod";
import { prisma, type DbClient } from "@/lib/db";
import { nextWorkspaceSequence } from "@/lib/counters";
import { activity, admin, adminIds, adminRef, audit, guard, index, OperationsError, parse, unavailable, write, type OpsActor } from "./context";
import { body, CATEGORIES, canTransitionTicket, id, requestKey, ticketDueAt, title } from "./rules";

export const ticketSchema = z.object({ title, description: body, category: z.enum(CATEGORIES), handlerId: z.string().max(100).default(""), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]), requestKey });
const triageSchema = z.object({ id, priority: ticketSchema.shape.priority, status: z.enum(["OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"]), assigneeId: z.string().max(100).default(""), dueAt: z.coerce.date().optional(), expectedUpdatedAt: z.iso.datetime() });
export function ticketWhere(actor: OpsActor) { return { workspaceId: actor.workspace.id, OR: [{ requesterId: actor.user.id }, ...(admin(actor) ? [{ handlerIds: { has: actor.user.id } }, { confidential: false }] : [])] }; }
export const ticketHandlers = (ticket: { confidential: boolean; handlerIds: string[] }, workspaceId: string, tx: DbClient) => ticket.confidential ? Promise.resolve(ticket.handlerIds) : adminIds(workspaceId,tx);
export async function listTickets(actor: OpsActor, query = "", status = "", page = 1) {
  await guard(actor);
  const where = { ...ticketWhere(actor), ...(query ? { title: { contains: query.slice(0, 160), mode: "insensitive" as const } } : {}), ...(triageSchema.shape.status.safeParse(status).success ? { status: triageSchema.shape.status.parse(status) } : {}) };
  const [rows, total] = await Promise.all([prisma.helpTicket.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 25, skip: (page - 1) * 25 }), prisma.helpTicket.count({ where })]);
  return { rows, total };
}
export async function getTicket(actor: OpsActor, ticketId: string, client: DbClient = prisma, page = 1) {
  await guard(actor, false, client);
  const ticket = await client.helpTicket.findFirst({ where: { ...ticketWhere(actor), id: ticketId } });
  if (!ticket) return null;
  const where = { workspaceId: actor.workspace.id, ticketId, ...(admin(actor) ? {} : { internal: false }) };
  const [comments, commentCount] = await Promise.all([
    client.helpTicketComment.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, skip: (page - 1) * 50 }),
    client.helpTicketComment.count({ where }),
  ]);
  return { ...ticket, comments: comments.reverse(), commentCount };
}
export async function createTicket(actor: OpsActor, input: unknown) {
  const v = parse(ticketSchema, input);
  return write(actor, `ticket-new:${actor.user.id}:${v.requestKey}`, false, async (tx, emit) => {
    const previous = await tx.helpTicket.findFirst({ where: { workspaceId: actor.workspace.id, requesterId: actor.user.id, requestKey: v.requestKey } });
    if (previous) return previous;
    const { handlerId, ...data } = v;
    const confidential = v.category === "Confidential";
    if (confidential) await adminRef(actor,handlerId,tx);
    const ticket = await tx.helpTicket.create({ data: { ...data, confidential, handlerIds: confidential ? [handlerId] : [], workspaceId: actor.workspace.id, requesterId: actor.user.id, number: await nextWorkspaceSequence(tx, actor.workspace.id, "ops_ticket"), slaDueAt: ticketDueAt(v.priority, new Date()) } });
    await index(actor, "ops_ticket", ticket.id, ticket.title, "helpdesk", tx, actor.user.id);
    await activity(actor, "ops_ticket", ticket.id, "Internal request created", tx, true);
    await audit(actor, "ticket", ticket.id, "created", tx);
    await emit("ops.ticket_changed", ticket.id, "An internal request needs triage", "helpdesk", await ticketHandlers(ticket,actor.workspace.id,tx));
    return ticket;
  });
}
export async function triageTicket(actor: OpsActor, input: unknown) {
  const v = parse(triageSchema, input);
  return write(actor, `ticket:${v.id}`, true, async (tx, emit) => {
    const ticket = await tx.helpTicket.findFirst({ where: { ...ticketWhere(actor), id: v.id } });
    if (!ticket) throw unavailable();
    if (ticket.updatedAt.toISOString() !== v.expectedUpdatedAt) throw new OperationsError("This request changed. Refresh before saving.");
    if (!canTransitionTicket(ticket.status, v.status)) throw new OperationsError("That status change is unavailable. Reopen the request first.");
    if (v.assigneeId) { await adminRef(actor, v.assigneeId, tx); if(ticket.confidential && !ticket.handlerIds.includes(v.assigneeId)) throw new OperationsError("Choose a designated handler for this confidential request."); }
    const reopened = ["RESOLVED", "CLOSED"].includes(ticket.status) && v.status === "OPEN";
    const closed = ["RESOLVED", "CLOSED"].includes(v.status);
    const updated = await tx.helpTicket.update({ where: { workspaceId_id: { workspaceId: actor.workspace.id, id: v.id } }, data: { priority: v.priority, status: v.status, assigneeId: v.assigneeId || null, slaDueAt: v.dueAt ?? (reopened ? ticketDueAt(v.priority, new Date()) : ticket.priority === v.priority ? ticket.slaDueAt : ticketDueAt(v.priority, ticket.createdAt)), resolvedAt: closed ? ticket.resolvedAt ?? new Date() : null } });
    await audit(actor, "ticket", v.id, "triaged", tx);
    await emit("ops.ticket_changed", v.id, "Your internal request has an update", "helpdesk", [ticket.requesterId, ...(v.assigneeId ? [v.assigneeId] : [])]);
    return updated;
  });
}
export async function commentTicket(actor: OpsActor, input: unknown) {
  const v = parse(z.object({ id, body, internal: z.boolean().default(false) }), input);
  return write(actor, `ticket:${v.id}`, false, async (tx, emit) => {
    const ticket = await tx.helpTicket.findFirst({ where: { ...ticketWhere(actor), id: v.id } });
    if (!ticket) throw unavailable();
    if (v.internal && !admin(actor)) throw new OperationsError("Only admins can add an internal note.");
    if (ticket.status === "CLOSED") throw new OperationsError("This request is closed. Ask an admin to reopen it before replying.");
    const comment = await tx.helpTicketComment.create({ data: { workspaceId: actor.workspace.id, ticketId: v.id, authorId: actor.user.id, body: v.body, internal: v.internal } });
    await audit(actor, "ticket", v.id, "commented", tx);
    await emit("ops.ticket_changed", v.id, "An internal request has a new reply", "helpdesk", v.internal ? await ticketHandlers(ticket,actor.workspace.id,tx) : [ticket.requesterId, ...await ticketHandlers(ticket,actor.workspace.id,tx)]);
    return comment;
  });
}
