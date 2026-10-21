"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, LogOut } from "lucide-react";
import {
  addChannelMembersAction,
  leaveChannelAction,
  loadChannelMembersAction,
  openDirectMessageAction,
  removeChannelMemberAction,
  setChannelArchivedAction,
  setNotifyLevelAction,
  updateChannelAction,
} from "@/app/actions/chat";
import type { ChannelMemberDTO } from "@/lib/chat/queries";
import type { ChannelInfo } from "@/lib/chat/types";
import { Button } from "@/components/ui/button";
import { SegmentedControl, SwitchRow } from "@/components/ui/choice";
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Chip } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";
import { useChat, useChatEvents } from "@/components/chat/ChatProvider";
import { PersonPicker } from "@/components/chat/PersonPicker";
import { PanelFrame, subtitleFor } from "./ChannelPanelFrame";
import { ChannelDetailsMembers } from "./ChannelDetailsMembers";

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

        <ChannelDetailsMembers
          info={info}
          isDm={isDm}
          members={members}
          viewer={viewer}
          timeZone={timeZone}
          setAdding={setAdding}
          onMessage={(member) => {
            startTransition(async () => {
              const result = await openDirectMessageAction(slug, { userIds: [member.id] });
              if (result.ok) router.push(result.data!.href);
              else showToast(result.error, "error");
            });
          }}
          onRemove={(member) => setConfirm({ remove: member })}
        />

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
                  startIcon={null}
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
