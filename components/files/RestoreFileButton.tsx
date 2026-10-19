"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { restoreFileAction } from "@/app/actions/files";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";

export function RestoreFileButton({ slug, fileId }: { slug: string; fileId: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await restoreFileAction(slug, { fileId });
          if (!result.ok) showToast(result.error, "error");
          else {
            showToast("File restored.", "success");
            router.refresh();
          }
        })
      }
    >
      Restore
    </Button>
  );
}
