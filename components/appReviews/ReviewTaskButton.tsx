"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAppReviewTaskAction } from "@/app/actions/appReviews";
import { Button } from "@/components/ui/button";

export function ReviewTaskButton({ slug, reviewId, linked }: { slug: string; reviewId: string; linked: boolean }) {
  const router = useRouter(); const [pending, start] = useTransition();
  const [message, setMessage] = useState(""); const [failed, setFailed] = useState(false);
  return <div className="mt-3 space-y-2"><Button disabled={pending || linked} onClick={() => start(async () => {
    try {
      const result = await createAppReviewTaskAction(slug, { reviewId }); setFailed(!result.ok);
      setMessage(result.ok ? `Task #${result.data?.number} created and assigned to you.` : result.error);
      if (result.ok) router.refresh();
    } catch { setFailed(true); setMessage("Couldn't create a task. Reload to check its state."); }
  })}>{pending ? "Creating" : linked ? "Task linked" : "Create task"}</Button>{message ? <p role={failed ? "alert" : "status"} className={failed ? "text-caption text-danger-fg" : "text-caption text-ink-secondary"}>{message}</p> : null}</div>;
}
