"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateProfile } from "@/app/actions/account";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/display";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";

type Profile = { name: string; pronouns: string; bio: string; skills: string[]; timezone: string };

export function ProfileForm({ initial }: { initial: Profile }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [values, setValues] = useState(initial);
  const [skill, setSkill] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const addSkill = () => {
    const next = skill.trim();
    if (!next || values.skills.includes(next) || values.skills.length >= 30) return;
    setValues((v) => ({ ...v, skills: [...v.skills, next.slice(0, 40)] }));
    setSkill("");
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await updateProfile(values);
          if (!result.ok) {
            setErrors(result.fieldErrors ?? {});
            showToast(result.error, "error");
            return;
          }
          setErrors({});
          showToast("Profile saved.", "success");
          router.refresh();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
        <Field label="Name" required error={errors.name?.[0]}>
          <Input value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} maxLength={80} autoComplete="name" />
        </Field>
        <Field label="Pronouns" optional error={errors.pronouns?.[0]}>
          <Input value={values.pronouns} onChange={(e) => setValues({ ...values, pronouns: e.target.value })} maxLength={40} placeholder="she/her" />
        </Field>
      </div>
      <Field label="Bio" optional helperText="A line or two about what you make." error={errors.bio?.[0]}>
        <Textarea value={values.bio} onChange={(e) => setValues({ ...values, bio: e.target.value })} rows={3} maxLength={1000} />
      </Field>
      <Field label="Skills" optional helperText="Press Enter to add. Others can find you by skill.">
        <Input
          value={skill}
          onChange={(e) => setSkill(e.target.value)}
          maxLength={40}
          placeholder="Soldering, CAD or Python"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addSkill();
            }
          }}
        />
      </Field>
      {values.skills.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Your skills">
          {values.skills.map((item) => (
            <li key={item} className="inline-flex items-center gap-1">
              <Chip tone="accent">{item}</Chip>
              <button type="button" aria-label={`Remove ${item}`} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-muted" onClick={() => setValues((v) => ({ ...v, skills: v.skills.filter((s) => s !== item) }))}>
                <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Field label="Time zone" optional helperText="IANA name, e.g. Asia/Kolkata. Leave empty to use the workspace's." error={errors.timezone?.[0]}>
        <Input value={values.timezone} onChange={(e) => setValues({ ...values, timezone: e.target.value })} />
      </Field>
      <Button type="submit" variant="primary" loading={pending} className="self-start">Save profile</Button>
    </form>
  );
}
