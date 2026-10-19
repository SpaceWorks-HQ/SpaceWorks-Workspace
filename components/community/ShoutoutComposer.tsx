"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { giveShoutoutAction } from "@/app/actions/community";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/display";
import { Dropdown, Field, Textarea } from "@/components/ui/field";

export type MemberOption = { id: string; name: string };

/** Give a shoutout: pick a member, say what they did. */
export function ShoutoutComposer({ slug, members, defaultToId }: { slug: string; members: MemberOption[]; defaultToId?: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [toId, setToId] = useState(defaultToId && members.some((member) => member.id === defaultToId) ? defaultToId : "");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  if (members.length === 0) {
    return (
      <Card>
        <CardHeader title="Give a shoutout" titleAs="h2" />
        <p className="text-body-ui text-ink-muted">Once more people join the workspace, you can thank them here.</p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Give a shoutout" description="Thank someone for a fix, a hand, a great idea." titleAs="h2" />
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await giveShoutoutAction(slug, { toId, message });
            if (!result.ok) {
              setErrors(result.fieldErrors ?? {});
              showToast(result.error, "error");
              return;
            }
            setErrors({});
            setMessage("");
            showToast("Shoutout sent. They'll be glad to hear it.", "success");
            router.refresh();
          });
        }}
      >
        <Field label="Who" error={errors.toId?.[0]}>
          <Dropdown value={toId} onChange={(event) => setToId(event.target.value)} required>
            <option value="" disabled>
              Pick a member
            </option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Dropdown>
        </Field>
        <Field label="What they did" error={errors.message?.[0]} helperText={`${message.trim().length}/500`}>
          <Textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={500} rows={4} placeholder="For staying late to fix the 3D printer before the workshop." required />
        </Field>
        <Button type="submit" variant="primary" loading={pending} disabled={!toId || !message.trim()} className="self-start">
          Send shoutout
        </Button>
      </form>
    </Card>
  );
}
