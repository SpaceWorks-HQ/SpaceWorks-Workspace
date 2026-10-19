"use server";
import { headers } from "next/headers";
import { getClientIpFromHeaders } from "@/lib/rateLimit";
import { collaborationAction } from "@/lib/meetings/action";
import { mutateMeeting } from "@/lib/meetings/service";
import { mutateSignature } from "@/lib/signatures/service";
export async function meetingAction(slug: string, input: unknown) {
  return collaborationAction(
    slug,
    "meetings",
    (actor) => mutateMeeting(actor, input),
    true,
  );
}
export async function signatureAction(slug: string, input: unknown) {
  return collaborationAction(
    slug,
    "sign",
    async (actor) =>
      mutateSignature(actor, input, getClientIpFromHeaders(await headers())),
    true,
  );
}
