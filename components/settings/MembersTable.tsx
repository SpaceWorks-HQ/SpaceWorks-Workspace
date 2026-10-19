"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ellipsis } from "lucide-react";
import type { MembershipStatus, WorkspaceRole } from "@prisma/client";
import { changeMemberRoleAction, removeMemberAction, setMemberStatusAction } from "@/app/actions/workspace-settings";
import { IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Avatar, Chip } from "@/components/ui/display";
import { Dropdown } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/feedback/ToastProvider";
import { assignableRoles, canActOnMember, roleLabel } from "@/lib/roles";

export type MemberRow = {
  membershipId: string;
  name: string | null;
  email: string;
  image: string | null;
  role: WorkspaceRole;
  status: MembershipStatus;
  title: string | null;
  joined: string;
  isSelf: boolean;
};

export function MembersTable({ slug, actorRole, members }: { slug: string; actorRole: WorkspaceRole; members: MemberRow[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [removing, setRemoving] = useState<MemberRow | null>(null);
  const actor = { role: actorRole };
  const roles = assignableRoles(actor);

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) showToast(result.error ?? "Couldn't save. Try again.", "error");
      else {
        showToast(success, "success");
        router.refresh();
      }
    });

  return (
    <>
      <Table label="Members">
        <THead>
          <tr>
            <TH>Member</TH>
            <TH>Role</TH>
            <TH>Status</TH>
            <TH>Joined</TH>
            <TH><span className="sr-only">Actions</span></TH>
          </tr>
        </THead>
        <TBody>
          {members.map((member) => {
            const editable = !member.isSelf && canActOnMember(actor, member.role);
            return (
              <TR key={member.membershipId}>
                <TD>
                  <span className="flex items-center gap-3">
                    <Avatar name={member.name ?? member.email} src={member.image} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{member.name ?? member.email}{member.isSelf ? " (you)" : ""}</span>
                      <span className="block truncate text-caption text-ink-muted">{member.title ? `${member.title} · ` : ""}{member.email}</span>
                    </span>
                  </span>
                </TD>
                <TD className="min-w-[150px]">
                  {editable ? (
                    <Dropdown
                      aria-label={`Role for ${member.name ?? member.email}`}
                      value={member.role}
                      disabled={pending}
                      onChange={(event) => run(() => changeMemberRoleAction(slug, { membershipId: member.membershipId, role: event.target.value }), "Role updated.")}
                    >
                      {[...new Set([member.role, ...roles])].map((role) => (
                        <option key={role} value={role} disabled={!roles.includes(role)}>{roleLabel(role)}</option>
                      ))}
                    </Dropdown>
                  ) : (
                    roleLabel(member.role)
                  )}
                </TD>
                <TD>{member.status === "ACTIVE" ? <Chip tone="success" size="sm">Active</Chip> : <Chip tone="warning" size="sm">Suspended</Chip>}</TD>
                <TD className="whitespace-nowrap tabular-nums text-ink-muted">{member.joined}</TD>
                <TD className="w-12 text-right">
                  {editable ? (
                    <Menu>
                      <MenuTrigger asChild>
                        <IconButton label={`Actions for ${member.name ?? member.email}`} size="sm" variant="quiet"><Ellipsis /></IconButton>
                      </MenuTrigger>
                      <MenuContent align="end">
                        {member.status === "ACTIVE" ? (
                          <MenuItem onSelect={() => run(() => setMemberStatusAction(slug, { membershipId: member.membershipId, status: "SUSPENDED" }), "Member suspended.")}>Suspend access</MenuItem>
                        ) : (
                          <MenuItem onSelect={() => run(() => setMemberStatusAction(slug, { membershipId: member.membershipId, status: "ACTIVE" }), "Access restored.")}>Restore access</MenuItem>
                        )}
                        <MenuItem onSelect={() => setRemoving(member)}>Remove from workspace…</MenuItem>
                      </MenuContent>
                    </Menu>
                  ) : null}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.name ?? removing?.email ?? "this member"}?`}
        message="They lose access to every channel, project and doc in this workspace. Their messages and tasks stay."
        confirmLabel="Remove member"
        loading={pending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing;
          if (!target) return;
          startTransition(async () => {
            const result = await removeMemberAction(slug, { membershipId: target.membershipId });
            setRemoving(null);
            if (!result.ok) showToast(result.error, "error");
            else {
              showToast("Member removed.", "success");
              router.refresh();
            }
          });
        }}
      />
    </>
  );
}
