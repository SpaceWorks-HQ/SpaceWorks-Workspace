"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createTaskAction } from "@/app/actions/tasks";
import { createDocAction } from "@/app/actions/docs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
export function QuickCreateDialog({
  slug,
  userId,
  kind,
  onClose,
}: {
  slug: string;
  userId: string;
  kind: "task" | "doc" | null;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Dialog
      open={!!kind}
      onOpenChange={(open) => {
        if (!open && !pending) {
          setTitle("");
          setMessage("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader
          title={kind === "task" ? "Create task" : "Create doc"}
          description={
            kind === "task"
              ? "Start a personal task. You can add details afterwards."
              : "Start a workspace doc and add the details in the editor."
          }
        />
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              try {
                if (kind === "task") {
                  const r = await createTaskAction(slug, {
                    title,
                    assigneeIds: [userId],
                  });
                  if (!r.ok) {
                    setMessage(r.error);
                    return;
                  }
                  onClose();
                  setTitle("");
                  router.push(r.data!.url);
                } else {
                  const r = await createDocAction(slug, { title });
                  if (!r.ok) {
                    setMessage(r.error);
                    return;
                  }
                  onClose();
                  setTitle("");
                  router.push(`/w/${slug}/docs/${r.data!.id}`);
                }
                router.refresh();
              } catch {
                setMessage("Couldn't create this. Try again.");
              }
            });
          }}
        >
          <DialogBody>
            <Field label="Title" required error={message}>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Create {kind}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function QuickCreateButtons({
  slug,
  userId,
}: {
  slug: string;
  userId: string;
}) {
  const [kind, setKind] = useState<"task" | "doc" | null>(null);
  return (
    <>
      <Button onClick={() => setKind("task")}>Create task</Button>
      <Button variant="secondary" onClick={() => setKind("doc")}>
        Create doc
      </Button>
      <Link
        className="inline-flex min-h-11 items-center px-3 underline"
        href={`/w/${slug}/calendar/new`}
      >
        Create event
      </Link>
      <QuickCreateDialog
        slug={slug}
        userId={userId}
        kind={kind}
        onClose={() => setKind(null)}
      />
    </>
  );
}
