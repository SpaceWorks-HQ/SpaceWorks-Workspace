"use client";

import { Button, IconButton } from "@/components/ui/button";
import { Avatar, Skeleton } from "@/components/ui/display";
import { roleLabel } from "@/lib/roles";
import { formatDate } from "@/lib/format/datetime";
import type { ChannelMemberDTO } from "@/lib/chat/queries";
import type { ChannelInfo } from "@/lib/chat/types";
import type { useChat } from "./ChatProvider";

export function ChannelDetailsMembers({
  info,
  isDm,
  members,
  viewer,
  timeZone,
  setAdding,
  onMessage,
  onRemove,
}: {
  info: ChannelInfo;
  isDm: boolean;
  members: ChannelMemberDTO[] | null;
  viewer: ReturnType<typeof useChat>["viewer"];
  timeZone: string;
  setAdding: (adding: boolean) => void;
  onMessage: (member: ChannelMemberDTO) => void;
  onRemove: (member: ChannelMemberDTO) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-label text-ink">
          {isDm ? "People" : "Members"} <span className="text-ink-muted tabular-nums">{members ? members.length : info.memberCount}</span>
        </h3>
        {info.can.addMembers ? (
          <Button size="sm" variant="ghost" startIcon={null} onClick={() => setAdding(true)}>
            Add people
          </Button>
        ) : null}
      </div>
      {members === null ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {members.map((member) => (
            <li key={member.id} className="flex min-h-14 items-center gap-3 px-3 py-2">
              <Avatar name={member.name} src={member.image} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-ui font-semibold text-ink">
                  {member.name}
                  {member.id === viewer.id ? <span className="font-normal text-ink-muted"> (you)</span> : null}
                </span>
                <span className="block text-caption text-ink-muted">
                  {member.role === "FORMER" ? "Former member" : roleLabel(member.role)}
                  {member.isCreator && !isDm ? " · Created the channel" : ""}
                  {!isDm ? ` · Joined ${formatDate(member.joinedAt, timeZone)}` : ""}
                </span>
              </span>
              {member.id !== viewer.id && member.role !== "GUEST" && member.role !== "FORMER" && viewer.role !== "GUEST" ? (
                <Button
                  variant="quiet"
                  className="min-w-11 px-2"
                  size="sm"
                  onClick={() => onMessage(member)}
                >
                  Message<span className="sr-only"> {member.name}</span>
                </Button>
              ) : null}
              {info.can.removeMembers && member.id !== viewer.id ? (
                <IconButton label={`Remove ${member.name}`} size="sm" variant="danger" onClick={() => onRemove(member)}>
                  <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">×</span>
                </IconButton>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
