import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  mutateSignature,
  signatureView,
  contentHash,
} from "@/lib/signatures/service";
import { owner, member, guest, outsider, docId } from "./fixtures";

export function registerDocumentSignatureTests() {
  it("requests and signs an immutable document acknowledgement, storing only an IP hash", async () => {
    const r = await mutateSignature(owner, {
      op: "request",
      docId,
      signerUserId: member.user.id,
    });
    expect(await signatureView(outsider, r.id)).toBeNull();
    await expect(
      mutateSignature(owner, {
        op: "sign",
        requestId: r.id,
        typedName: "Wrong signer",
        acknowledge: true,
      }),
    ).rejects.toThrow();
    await mutateSignature(
      member,
      {
        op: "sign",
        requestId: r.id,
        typedName: "Maker Member",
        acknowledge: true,
      },
      "203.0.113.42",
    );
    const signed = await prisma.signatureRequest.findUniqueOrThrow({
      where: { id: r.id },
    });
    expect(signed.status).toBe("SIGNED");
    expect(signed.typedName).toBe("Maker Member");
    expect(signed.signedAt).toBeInstanceOf(Date);
    expect(signed.ip).toMatch(/^[a-f0-9]{64}$/);
    expect(signed.ip).not.toContain("203.0.113.42");
    await expect(
      mutateSignature(member, {
        op: "sign",
        requestId: r.id,
        typedName: "Again",
        acknowledge: true,
      }),
    ).rejects.toThrow();
  });
  it("prevents acknowledging a changed version and enforces admin-only document access", async () => {
    const r = await mutateSignature(owner, {
      op: "request",
      docId,
      signerUserId: guest.user.id,
    });
    await prisma.doc.update({
      where: { id: docId },
      data: { contentHtml: "<p>Updated agreement</p>" },
    });
    expect((await signatureView(guest, r.id))?.currentMatches).toBe(false);
    await expect(
      mutateSignature(guest, {
        op: "sign",
        requestId: r.id,
        typedName: "Guest Member",
        acknowledge: true,
      }),
    ).rejects.toThrow();
    const secret = await prisma.doc.create({
      data: {
        workspaceId: owner.workspace.id,
        title: "Admin document",
        visibility: "ADMINS",
        createdById: owner.user.id,
      },
    });
    await expect(
      mutateSignature(owner, {
        op: "request",
        docId: secret.id,
        signerUserId: member.user.id,
      }),
    ).rejects.toThrow();
    expect(
      contentHash("Workshop agreement", "<p>Updated agreement</p>"),
    ).not.toBe(
      (await prisma.signatureRequest.findUniqueOrThrow({ where: { id: r.id } }))
        .contentHash,
    );
  });
}
