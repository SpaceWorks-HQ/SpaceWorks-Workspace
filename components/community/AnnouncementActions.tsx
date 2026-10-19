"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ellipsis } from "lucide-react";
import { deleteAnnouncementAction, pinAnnouncementAction } from "@/app/actions/community";
import { useToast } from "@/components/feedback/ToastProvider";
import { IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";

/** Admin menu on an announcement: edit, pin or unpin, delete (with confirmation). */
export function AnnouncementActions({ slug, id, title, pinned, afterDelete }: { slug: string; id: string; title: string; pinned: boolean; afterDelete?: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  const togglePin = () =>
    startTransition(async () => {
      const result = await pinAnnouncementAction(slug, { id, pinned: !pinned });
      if (!result.ok) showToast(result.error, "error");
      else {
        showToast(pinned ? "Unpinned." : "Pinned to the top.", "success");
        router.refresh();
      }
    });

  const remove = () =>
    startTransition(async () => {
      const result = await deleteAnnouncementAction(slug, { id });
      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }
      setConfirming(false);
      showToast("Announcement deleted.", "success");
      if (afterDelete) router.push(afterDelete);
      router.refresh();
    });

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <IconButton label={`Actions for ${title}`} disabled={pending}>
            <Ellipsis />
          </IconButton>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem asChild>
            <Link href={`/w/${slug}/announcements/${id}/edit`}>Edit</Link>
          </MenuItem>
          <MenuItem onSelect={togglePin}>{pinned ? "Unpin" : "Pin to the top"}</MenuItem>
          <MenuSeparator />
          <MenuItem danger onSelect={() => setConfirming(true)}>Delete…</MenuItem>
        </MenuContent>
      </Menu>
      <ConfirmDialog
        open={confirming}
        title="Delete this announcement?"
        message={`"${title}" disappears for everyone. Messages already sent to other destinations stay where they are.`}
        confirmLabel="Delete announcement"
        loading={pending}
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
