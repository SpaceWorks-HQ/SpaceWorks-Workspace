"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, LogOut, MessageSquareText, UserPlus, X } from "lucide-react";
import {
  addChannelMembersAction,
  leaveChannelAction,
  loadChannelMembersAction,
  loadPinnedAction,
  openDirectMessageAction,
  removeChannelMemberAction,
  setChannelArchivedAction,
  setNotifyLevelAction,
  setPinnedAction,
  updateChannelAction,
} from "@/app/actions/chat";
import { roleLabel } from "@/lib/roles";
import { formatDate } from "@/lib/format/datetime";
import type { ChannelMemberDTO } from "@/lib/chat/queries";
import type { ChannelInfo, MessageDTO } from "@/lib/chat/types";
import { Button, IconButton } from "@/components/ui/button";
import { SegmentedControl, SwitchRow } from "@/components/ui/choice";
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Avatar, Chip, EmptyState, Skeleton } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";
import { useChat, useChatEvents } from "@/components/chat/ChatProvider";
import { PersonPicker } from "@/components/chat/PersonPicker";
import { SearchResults } from "@/components/chat/SearchResults";
import { messageBodyClass } from "@/components/chat/ui";

function PanelFrame({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-14 items-center justify-between gap-2 border-b border-line pl-4 pr-2">
        <div className="min-w-0">
          <h2 className="text-title text-ink">{title}</h2>
          {subtitle ? <p className="truncate text-caption text-ink-muted">{subtitle}</p> : null}
        </div>
        <IconButton label={`Close ${title.toLowerCase()}`} onClick={onClose}>
          <X />
        </IconButton>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">{children}</div>
    </section>
  );
}

const subtitleFor = (info: ChannelInfo) => (info.kind === "DIRECT" ? info.name : `#${info.name}`);

// ───────────── Pinned ─────────────

export function PinnedPanel({ info, onClose, onJump }: { info: ChannelInfo; onClose: () => void; onJump: (message: MessageDTO) => void }) {
  const { slug, timeZone } = useChat();
  const { showToast } = useToast();
  const [items, setItems] = useState<MessageDTO[] | null>(null);

  const load = useCallback(() => loadPinnedAction(slug, { channelId: info.id }).then((result) => setItems(result.ok ? result.data! : [])), [slug, info.id]);

  useEffect(() => {
    let alive = true;
    loadPinnedAction(slug, { channelId: info.id }).then((result) => {
      if (alive) setItems(result.ok ? result.data! : []);
    });
    return () => {
      alive = false;
    };
  }, [slug, info.id]);

  useChatEvents((event) => {
    if (event.channel === `channel:${info.id}` && (event.type === "message.updated" || event.type === "message.deleted")) void load();
  });

  const unpin = async (message: MessageDTO) => {
    const result = await setPinnedAction(slug, { messageId: message.id, pinned: false });
    if (!result.ok) showToast(result.error, "error");
    else void load();
  };

  return (
    <PanelFrame title="Pinned" subtitle={subtitleFor(info)} onClose={onClose}>
      {items === null ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="Nothing pinned yet.">Pin a message to keep it handy for everyone here.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((message) => (
            <li key={message.id} className="rounded-lg border border-line p-3">
              <div className="mb-1 flex items-center gap-2">
                <Avatar name={message.author?.name ?? "Space Works"} src={message.author?.image} size="xs" />
                <span className="min-w-0 flex-1 truncate text-label text-ink">{message.author?.name ?? "Space Works"}</span>
                <span className="text-caption text-ink-muted tabular-nums">{formatDate(message.createdAt, timeZone)}</span>
              </div>
              <div className={`${messageBodyClass} line-clamp-6`} dangerouslySetInnerHTML={{ __html: message.html }} />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => onJump(message)}>
                  Jump to message
                </Button>
                {message.canPin ? (
                  <Button size="sm" variant="quiet" onClick={() => void unpin(message)}>
                    Unpin
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </PanelFrame>
  );
}

// ───────────── Search ─────────────

export function SearchPanel({ info, onClose }: { info: ChannelInfo; onClose: () => void }) {
  return (
    <PanelFrame title="Search" subtitle={subtitleFor(info)} onClose={onClose}>
      <SearchResults channel={{ id: info.id, label: info.kind === "DIRECT" ? "This conversation" : `#${info.name}` }} autoFocus />
    </PanelFrame>
  );
}

// ───────────── Details and members ─────────────

const NOTIFY_OPTIONS = [
  { value: "ALL", label: "All" },
  { value: "MENTIONS", label: "Mentions" },
  { value: "NONE", label: "Muted" },
] as const;

const NOTIFY_HELP: Record<string, string> = {
  ALL: "Mentions, @channel and replies to threads you're in.",
  MENTIONS: "Only when someone mentions you by name.",
  NONE: "No notifications. Unread messages still show in the list.",
};

export function DetailsPanel({ info, onClose }: { info: ChannelInfo; onClose: () => void }) {
  const { slug, viewer, people, timeZone } = useChat();
  const router = useRouter();
  const { showToast } = useToast();
  const [members, setMembers] = useState<ChannelMemberDTO[] | null>(null);
  const [notify, setNotify] = useState(info.notify);
  const [topic, setTopic] = useState(info.topic ?? "");
  const [name, setName] = useState(info.name);
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<"archive" | "leave" | { remove: ChannelMemberDTO } | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(() => loadChannelMembersAction(slug, { channelId: info.id }).then((result) => setMembers(result.ok ? result.data! : [])), [slug, info.id]);

  useEffect(() => {
    let alive = true;
    loadChannelMembersAction(slug, { channelId: info.id }).then((result) => {
      if (alive) setMembers(result.ok ? result.data! : []);
    });
    return () => {
      alive = false;
    };
  }, [slug, info.id]);

  useChatEvents((event) => {
    if (event.channel === `channel:${info.id}` && event.type === "channel.members") void load();
  });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        showToast(result.error ?? "Couldn't save. Try again.", "error");
        return;
      }
      if (success) showToast(success, "success");
      after?.();
    });

  const isDm = info.kind === "DIRECT";
  const memberIds = members?.map((m) => m.id) ?? [];

  return (
    <PanelFrame title={isDm ? "Conversation details" : "Channel details"} subtitle={subtitleFor(info)} onClose={onClose}>
      <div className="flex flex-col gap-6">
        {info.isMember ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-label text-ink">Notifications</h3>
            <SegmentedControl
              ariaLabel="Notifications"
              size="sm"
              className="self-start"
              value={notify}
              onValueChange={(value) => {
                setNotify(value);
                run(() => setNotifyLevelAction(slug, { channelId: info.id, level: value }), value === "NONE" ? "Muted." : "Notifications updated.");
              }}
              options={NOTIFY_OPTIONS}
            />
            <p className="text-caption text-ink-muted">{NOTIFY_HELP[notify]}</p>
          </section>
        ) : null}

        {!isDm ? (
          <section className="flex flex-col gap-3">
            <h3 className="text-label text-ink">About</h3>
            {info.can.administer && !info.archived ? (
              <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  run(
                    () => updateChannelAction(slug, { channelId: info.id, name }),
                    "Channel renamed.",
                    () => router.refresh(),
                  );
                }}
              >
                <Field label="Name">
                  <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
                </Field>
                <Button type="submit" size="sm" variant="secondary" className="self-start" disabled={pending || name === info.name}>
                  Rename
                </Button>
              </form>
            ) : null}
            {info.can.setTopic ? (
              <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  run(() => updateChannelAction(slug, { channelId: info.id, topic }), "Topic updated.", () => router.refresh());
                }}
              >
                <Field label="Topic" optional>
                  <Input value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={250} placeholder="What this channel is for" />
                </Field>
                <Button type="submit" size="sm" variant="secondary" className="self-start" disabled={pending || topic === (info.topic ?? "")}>
                  Save topic
                </Button>
              </form>
            ) : (
              <p className="text-body-ui text-ink-secondary">{info.topic || "No topic yet."}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Chip tone={info.kind === "PRIVATE" ? "neutral" : "accent"}>{info.kind === "PRIVATE" ? "Private" : "Public"}</Chip>
              {info.isDefault ? <Chip tone="success">Default</Chip> : null}
              {info.archived ? <Chip tone="warning">Archived</Chip> : null}
              {info.teamName ? <Chip tone="outline">{info.teamName}</Chip> : null}
            </div>
            {info.can.administer && info.kind === "PUBLIC" && !info.archived ? (
              <SwitchRow
                label="Default channel"
                description="New members join it automatically."
                checked={info.isDefault}
                onCheckedChange={(checked: boolean) =>
                  run(() => updateChannelAction(slug, { channelId: info.id, isDefault: checked }), checked ? "New members will join this channel." : "No longer a default channel.", () => router.refresh())
                }
              />
            ) : null}
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-label text-ink">
              {isDm ? "People" : "Members"} <span className="text-ink-muted tabular-nums">{members ? members.length : info.memberCount}</span>
            </h3>
            {info.can.addMembers ? (
              <Button size="sm" variant="ghost" startIcon={<UserPlus />} onClick={() => setAdding(true)}>
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
                    <IconButton
                      label={`Message ${member.name}`}
                      size="sm"
                      onClick={() =>
                        startTransition(async () => {
                          const result = await openDirectMessageAction(slug, { userIds: [member.id] });
                          if (result.ok) router.push(result.data!.href);
                          else showToast(result.error, "error");
                        })
                      }
                    >
                      <MessageSquareText />
                    </IconButton>
                  ) : null}
                  {info.can.removeMembers && member.id !== viewer.id ? (
                    <IconButton label={`Remove ${member.name}`} size="sm" variant="danger" onClick={() => setConfirm({ remove: member })}>
                      <X />
                    </IconButton>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {!isDm && (info.can.leave || info.can.administer) ? (
          <section className="flex flex-col gap-2 border-t border-line pt-4">
            {info.can.leave ? (
              <Button variant="dangerOutline" size="sm" className="self-start" startIcon={<LogOut />} onClick={() => setConfirm("leave")}>
                Leave channel…
              </Button>
            ) : null}
            {info.can.administer ? (
              info.archived ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  startIcon={<ArchiveRestore />}
                  onClick={() => run(() => setChannelArchivedAction(slug, { channelId: info.id, archived: false }), "Channel unarchived.", () => router.refresh())}
                >
                  Unarchive channel
                </Button>
              ) : (
                <Button variant="dangerOutline" size="sm" className="self-start" startIcon={<Archive />} onClick={() => setConfirm("archive")}>
                  Archive channel…
                </Button>
              )
            ) : null}
          </section>
        ) : null}
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent size="md">
          <DialogHeader title={`Add people to #${info.name}`} description={info.kind === "PRIVATE" ? "They'll see the whole history of this private channel." : "They'll join the channel."} />
          <DialogBody>
            <PersonPicker people={people} selected={toAdd} onChange={setToAdd} exclude={memberIds} label="Find people to add" />
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={toAdd.length === 0}
              loading={pending}
              onClick={() =>
                run(
                  () => addChannelMembersAction(slug, { channelId: info.id, userIds: toAdd }),
                  toAdd.length === 1 ? "Added 1 person." : `Added ${toAdd.length} people.`,
                  () => {
                    setAdding(false);
                    setToAdd([]);
                    void load();
                    router.refresh();
                  },
                )
              }
            >
              Add people
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "archive" ? `Archive #${info.name}?` : confirm === "leave" ? `Leave #${info.name}?` : confirm ? `Remove ${confirm.remove.name}?` : ""}
        message={
          confirm === "archive"
            ? "Nobody can post in it any more. The history stays readable and an admin can unarchive it."
            : confirm === "leave"
              ? info.kind === "PRIVATE"
                ? "You'll lose access to this private channel until someone adds you back."
                : "You can join again from Browse channels."
              : confirm
                ? info.kind === "PRIVATE"
                  ? "They'll lose access to this private channel."
                  : "They can join again from Browse channels."
                : undefined
        }
        confirmLabel={confirm === "archive" ? "Archive channel" : confirm === "leave" ? "Leave channel" : "Remove"}
        loading={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm === "archive") {
            run(() => setChannelArchivedAction(slug, { channelId: info.id, archived: true }), "Channel archived.", () => {
              setConfirm(null);
              router.refresh();
            });
          } else if (confirm === "leave") {
            run(() => leaveChannelAction(slug, { channelId: info.id }), "You left the channel.", () => {
              setConfirm(null);
              router.push(`/w/${slug}/chat`);
            });
          } else if (confirm) {
            const target = confirm.remove;
            run(() => removeChannelMemberAction(slug, { channelId: info.id, userId: target.id }), `Removed ${target.name}.`, () => {
              setConfirm(null);
              void load();
            });
          }
        }}
      />
    </PanelFrame>
  );
}

