"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AttendanceStatus } from "@prisma/client";
import { rsvpAction } from "@/app/actions/community";
import { useToast } from "@/components/feedback/ToastProvider";
import { cn } from "@/lib/cn";
import type { RsvpChoice } from "@/lib/community/rsvp";

const OPTIONS: { value: RsvpChoice; label: string }[] = [
  { value: "GOING", label: "Going" },
  { value: "MAYBE", label: "Maybe" },
  { value: "NOT_GOING", label: "Not going" },
];

function statusLine(status: AttendanceStatus | null, position: number | null, full: boolean) {
  if (status === "GOING") return "You're going. See you there.";
  if (status === "WAITLIST") return position ? `You're number ${position} on the waitlist. We'll tell you when a spot opens.` : "You're on the waitlist.";
  if (status === "MAYBE") return "You might come. Change it any time.";
  if (status === "NOT_GOING") return "You're not going.";
  return full ? "It's full. Reply going to join the waitlist." : "Let the organiser know if you're coming.";
}

/** Going / Maybe / Not going. A full event puts "going" replies on the waitlist. */
export function RsvpControl({ slug, eventId, status, position, full }: { slug: string; eventId: string; status: AttendanceStatus | null; position: number | null; full: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState({ status, position });
  const selected: RsvpChoice | null = current.status === "WAITLIST" ? "GOING" : (current.status as RsvpChoice | null);

  const choose = (choice: RsvpChoice) =>
    startTransition(async () => {
      const result = await rsvpAction(slug, { eventId, status: choice });
      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }
      setCurrent({ status: result.data!.status, position: result.data!.waitlistPosition });
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Your reply" className="grid grid-cols-3 gap-2">
        {OPTIONS.map((option) => {
          const active = selected === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              disabled={pending}
              onClick={() => choose(option.value)}
              className={cn(
                "min-h-11 rounded-md border px-3 text-[15px] font-semibold transition-colors duration-[120ms] disabled:cursor-wait",
                active ? "border-primary bg-primary text-on-primary" : "border-line-strong bg-panel text-ink hover:bg-muted",
              )}
            >
              {option.value === "GOING" && current.status === "WAITLIST" ? "Waitlisted" : option.label}
            </button>
          );
        })}
      </div>
      <p className="text-caption text-ink-muted" aria-live="polite">
        {pending ? "Saving your reply…" : statusLine(current.status, current.position, full)}
      </p>
    </div>
  );
}
