"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceRole } from "@prisma/client";
import { createInvitationAction, resendInvitationAction, revokeInvitationAction } from "@/app/actions/workspace-settings";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Chip, EmptyState } from "@/components/ui/display";
import { Dropdown, Field, Input } from "@/components/ui/field";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/feedback/ToastProvider";
import { roleLabel } from "@/lib/roles";

export type InvitationRow = {
  id: string;
  email: string;
  role: WorkspaceRole;
  state: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  sentLabel: string;
  invitedBy: string | null;
};

const STATE: Record<InvitationRow["state"], { label: string; tone: "info" | "success" | "neutral" | "warning" }> = {
  PENDING: { label: "Pending", tone: "info" },
  ACCEPTED: { label: "Accepted", tone: "success" },
  REVOKED: { label: "Revoked", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "warning" },
};

export function InvitationsPanel({ slug, roles, invitations }: { slug: string; roles: WorkspaceRole[]; invitations: InvitationRow[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>(roles.includes("MEMBER") ? "MEMBER" : roles[0]!);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) showToast(result.error ?? "Couldn't save. Try again.", "error");
      else {
        showToast(success, "success");
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader title="Invite someone" description="They get an email with a link that works for 7 days." />
        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await createInvitationAction(slug, { email, role });
              if (!result.ok) {
                setError(result.fieldErrors?.email?.[0] ?? result.error);
                return;
              }
              setError(undefined);
              setEmail("");
              showToast(`Invitation sent to ${email}.`, "success");
              router.refresh();
            });
          }}
        >
          <Field label="Email" error={error}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="maker@example.org" required />
          </Field>
          <Field label="Role">
            <Dropdown value={role} onChange={(e) => setRole(e.target.value as WorkspaceRole)}>
              {roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </Dropdown>
          </Field>
          <Button type="submit" variant="primary" loading={pending}>Send invitation</Button>
        </form>
      </Card>

      {invitations.length === 0 ? (
        <EmptyState title="No invitations yet.">Invite the crew to get started.</EmptyState>
      ) : (
        <Table label="Invitations">
          <THead>
            <tr>
              <TH>Email</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH>Sent</TH>
              <TH><span className="sr-only">Actions</span></TH>
            </tr>
          </THead>
          <TBody>
            {invitations.map((invitation) => (
              <TR key={invitation.id}>
                <TD>
                  <span className="block truncate">{invitation.email}</span>
                  {invitation.invitedBy ? <span className="block text-caption text-ink-muted">by {invitation.invitedBy}</span> : null}
                </TD>
                <TD>{roleLabel(invitation.role)}</TD>
                <TD><Chip tone={STATE[invitation.state].tone} size="sm">{STATE[invitation.state].label}</Chip></TD>
                <TD className="whitespace-nowrap text-ink-muted">{invitation.sentLabel}</TD>
                <TD className="whitespace-nowrap text-right">
                  {invitation.state === "PENDING" || invitation.state === "EXPIRED" ? (
                    <span className="inline-flex gap-2">
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => resendInvitationAction(slug, { invitationId: invitation.id }), "Invitation resent.")}>Resend</Button>
                      {invitation.state === "PENDING" ? (
                        <Button size="sm" variant="dangerOutline" disabled={pending} onClick={() => act(() => revokeInvitationAction(slug, { invitationId: invitation.id }), "Invitation revoked.")}>Revoke</Button>
                      ) : null}
                    </span>
                  ) : null}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
