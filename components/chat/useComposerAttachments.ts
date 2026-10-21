"use client";

import { useState } from "react";
import { uploadChatAttachmentAction } from "@/app/actions/chat";
import { MAX_ATTACHMENTS } from "@/lib/chat/client";
import type { AttachmentDTO } from "@/lib/chat/types";
import { useToast } from "@/components/feedback/ToastProvider";

export type PendingFile = { key: string; name: string; status: "uploading" | "done"; attachment?: AttachmentDTO };

export function useComposerAttachments(slug: string, channelId: string, allowUpload: boolean) {
  const { showToast } = useToast();
  const [files, setFiles] = useState<PendingFile[]>([]);
  const uploading = files.some((f) => f.status === "uploading");

  const upload = async (list: File[]) => {
    if (!allowUpload) return;
    const room = MAX_ATTACHMENTS - files.length;
    if (room <= 0) {
      showToast(`Attach up to ${MAX_ATTACHMENTS} files per message.`, "warning");
      return;
    }
    for (const file of list.slice(0, room)) {
      const key = `${file.name}-${Math.random().toString(36).slice(2)}`;
      setFiles((current) => [...current, { key, name: file.name, status: "uploading" }]);
      const form = new FormData();
      form.set("channelId", channelId);
      form.set("file", file);
      const result = await uploadChatAttachmentAction(slug, form);
      if (!result.ok) {
        showToast(result.error, "error");
        setFiles((current) => current.filter((f) => f.key !== key));
        continue;
      }
      setFiles((current) => current.map((f) => (f.key === key ? { ...f, status: "done", attachment: result.data!.attachment } : f)));
    }
  };

  return { files, setFiles, uploading, upload };
}
