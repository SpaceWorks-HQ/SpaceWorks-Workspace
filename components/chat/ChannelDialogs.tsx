"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createChannelAction, openDirectMessageAction } from "@/app/actions/chat";
import { Button } from "@/components/ui/button";
import { RadioCard, RadioGroup } from "@/components/ui/choice";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Dropdown, Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";
import { MAX_DM_PARTICIPANTS, canCreateChannel, toChannelSlug } from "@/lib/chat/client";
import { useChat } from "@/components/chat/ChatProvider";
import { PersonPicker } from "@/components/chat/PersonPicker";

export type TeamOption = { id: string; name: string };

/** New channel: name, public/private, topic, optional team and (private) first members. */
export function CreateChannelDialog({ open, onOpenChange, teams }: { open: boolean; onOpenChange: (open: boolean) => void; teams: TeamOption[] }) {
  const { slug, viewer, people } = useChat();
  const router = useRouter();
  const canPublic = canCreateChannel(viewer, "PUBLIC");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"PUBLIC" | "PRIVATE">(canPublic ? "PUBLIC" : "PRIVATE");
  const [topic, setTopic] = useState("");
  const [teamId, setTeamId] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setName("");
    setTopic("");
    setTeamId("");
    setMembers([]);
    setErrors({});
    setError(null);
  };

  const submit = () => {
    startTransition(async () => {
      const result = await createChannelAction(slug, { name, kind, topic, teamId: teamId || null, memberIds: kind === "PRIVATE" ? members : [] });
      if (!result.ok) {
        setError(result.error);
        setErrors(result.fieldErrors ?? {});
        return;
      }
      reset();
      onOpenChange(false);
      router.push(result.data!.href);
    });
  };

  const preview = toChannelSlug(name);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent size="md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogHeader title="Create a channel" description="Channels keep a topic's conversation in one place." />
          <DialogBody className="flex flex-col gap-5">
            <Field label="Name" error={errors.name?.[0]} helperText={preview && preview !== name ? `It will be #${preview}` : "Lowercase, no spaces. For example: laser-cutter."}>
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus autoComplete="off" placeholder="build-night" />
            </Field>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-label text-ink">Who can find it</legend>
              <RadioGroup value={kind} onValueChange={(value) => setKind(value as "PUBLIC" | "PRIVATE")} className="grid gap-2 sm:grid-cols-2">
                <RadioCard value="PUBLIC" label="Public" description={canPublic ? "Every member can find and join it." : "Only admins create public channels."} disabled={!canPublic} />
                <RadioCard value="PRIVATE" label="Private" description="Only people you add can see it." />
              </RadioGroup>
            </fieldset>
            <Field label="Topic" optional error={errors.topic?.[0]}>
              <Input value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={250} placeholder="What this channel is for" />
            </Field>
            {teams.length > 0 ? (
              <Field label="Team" optional helperText="A private team's channels stay hidden from people outside the team.">
                <Dropdown value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                  <option value="">Whole workspace</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Dropdown>
              </Field>
            ) : null}
            {kind === "PRIVATE" ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-label text-ink">Add people</p>
                <PersonPicker people={people} selected={members} onChange={setMembers} exclude={[viewer.id]} label="Find people to add" />
              </div>
            ) : null}
            {error && !Object.keys(errors).length ? <p role="alert" className="text-caption text-danger-fg">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending} loadingLabel="Creating…" disabled={!preview}>
              Create channel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Start (or reopen) a DM with up to seven people. */
export function NewMessageDialog({ open, onOpenChange, initial = [] }: { open: boolean; onOpenChange: (open: boolean) => void; initial?: string[] }) {
  const { slug, viewer, people } = useChat();
  const router = useRouter();
  const { showToast } = useToast();
  const [selected, setSelected] = useState<string[]>(initial);
  const [pending, startTransition] = useTransition();
  const eligible = people.filter((p) => p.role !== "GUEST");

  const open_ = () => {
    startTransition(async () => {
      const result = await openDirectMessageAction(slug, { userIds: selected });
      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }
      onOpenChange(false);
      setSelected([]);
      router.push(result.data!.href);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title="New message" description="Pick one person for a direct message, or a few for a small group." />
        <DialogBody>
          <PersonPicker people={eligible} selected={selected} onChange={setSelected} exclude={[viewer.id]} max={MAX_DM_PARTICIPANTS - 1} label="Find people to message" />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={open_} loading={pending} loadingLabel="Opening…" disabled={selected.length === 0}>
            Open conversation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
