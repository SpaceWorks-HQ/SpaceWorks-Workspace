"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createBoardroomSessionAction } from "@/app/actions/boardroom";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/display";
import { Dropdown, Field, Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";
import { PERSONA_PRESETS } from "@/lib/assistant/boardroomPrompts";

type Seat = { name: string; persona: string };

const DEFAULT_SEATS: Seat[] = PERSONA_PRESETS.filter((p) => ["Treasurer", "Safety lead", "Maker"].includes(p.name)).map((p) => ({ name: p.name, persona: p.persona }));

export function BoardroomNewSession({ slug }: { slug: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [question, setQuestion] = useState("");
  const [rounds, setRounds] = useState("2");
  const [seats, setSeats] = useState<Seat[]>(DEFAULT_SEATS);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const unused = PERSONA_PRESETS.filter((preset) => !seats.some((seat) => seat.name === preset.name));

  return (
    <Card>
      <CardHeader title="Convene the panel" description="Two to five seats, one to three rounds. Each seat sees what the others said before it speaks." />
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await createBoardroomSessionAction(slug, { question, rounds: Number(rounds), seats });
            if (!result.ok) {
              setErrors(result.fieldErrors ?? {});
              showToast(result.error, "error");
              return;
            }
            setErrors({});
            showToast("The panel is in session.", "success");
            router.push(`/w/${slug}/boardroom/${result.data!.id}`);
          });
        }}
      >
        <Field label="Question" error={errors.question?.[0]} helperText="Give the context the panel needs: budget, timing, who it affects.">
          <Textarea rows={3} value={question} maxLength={2000} required onChange={(e) => setQuestion(e.target.value)} placeholder="Should we spend ₹60,000 from the kitty on a second laser cutter this quarter?" />
        </Field>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-label text-ink">Seats</legend>
          {seats.map((seat, index) => (
            <div key={index} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-start">
              <Field label={`Seat ${index + 1} name`} hideLabel>
                <Input value={seat.name} maxLength={40} required onChange={(e) => setSeats(seats.map((s, i) => (i === index ? { ...s, name: e.target.value } : s)))} />
              </Field>
              <Field label={`Seat ${index + 1} perspective`} hideLabel>
                <Textarea rows={2} value={seat.persona} maxLength={600} required onChange={(e) => setSeats(seats.map((s, i) => (i === index ? { ...s, persona: e.target.value } : s)))} />
              </Field>
              <IconButton label={`Remove ${seat.name || "seat"}`} size="sm" disabled={seats.length <= 2} onClick={() => setSeats(seats.filter((_, i) => i !== index))}>
                <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">×</span>
              </IconButton>
            </div>
          ))}
          {errors.seats?.[0] ? <p className="text-caption text-danger-fg">{errors.seats[0]}</p> : null}
          {seats.length < 5 ? (
            <div className="flex flex-wrap gap-2">
              {unused.map((preset) => (
                <Button key={preset.name} size="sm" variant="secondary" startIcon={<Plus />} onClick={() => setSeats([...seats, { name: preset.name, persona: preset.persona }])}>
                  {preset.name}
                </Button>
              ))}
              <Button size="sm" variant="ghost" startIcon={<Plus />} onClick={() => setSeats([...seats, { name: "", persona: "" }])}>Custom seat</Button>
            </div>
          ) : null}
        </fieldset>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Field label="Rounds" className="w-40">
            <Dropdown value={rounds} onChange={(e) => setRounds(e.target.value)}>
              <option value="1">1 round</option>
              <option value="2">2 rounds</option>
              <option value="3">3 rounds</option>
            </Dropdown>
          </Field>
          <Button type="submit" variant="primary" loading={pending}>Start the session</Button>
        </div>
      </form>
    </Card>
  );
}
