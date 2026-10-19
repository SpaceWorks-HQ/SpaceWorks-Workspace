"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mutatePeople } from "@/app/actions/people";
import { Button } from "@/components/ui/button";
import { Dropdown, Field, Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";

type Profile = {
  bio: string | null; pronouns: string | null; timezone: string | null;
  location: string | null; interests: string[]; skills: { skill: string; level: number }[];
};
export function ProfileEditor({ slug, timezone, profile }: { slug: string; timezone: string; profile: Profile }) {
  const [skills, setSkills] = useState(() => profile.skills.map(s => ({ ...s, key: crypto.randomUUID() })));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();
  return <form className="flex flex-col gap-4" onSubmit={event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    start(async () => {
      setError("");
      try {
        const result = await mutatePeople(slug, "profile", {
          bio: data.get("bio"), pronouns: data.get("pronouns"), timezone: data.get("timezone"), location: data.get("location"),
          interests: String(data.get("interests") ?? "").split(",").map(v => v.trim()).filter(Boolean),
          skills: skills.map(s => ({ skill: s.skill, level: s.level })),
        });
        if (!result.ok) { setError(result.error); return; }
        showToast("Changes saved", "success"); router.refresh();
      } catch { setError("Couldn't save. Try again."); }
    });
  }}>
    <Field label="Bio"><Textarea name="bio" defaultValue={profile.bio ?? ""} maxLength={2000} disabled={pending} /></Field>
    <Field label="Pronouns" optional><Input name="pronouns" defaultValue={profile.pronouns ?? ""} maxLength={60} disabled={pending} /></Field>
    <Field label="Time zone" helperText="For example, Asia/Kolkata."><Input name="timezone" defaultValue={profile.timezone || timezone} maxLength={80} disabled={pending} /></Field>
    <Field label="Location" optional><Input name="location" defaultValue={profile.location ?? ""} maxLength={120} disabled={pending} /></Field>
    <Field label="Interests" optional helperText="Separate interests with commas."><Input name="interests" defaultValue={profile.interests.join(", ")} maxLength={1200} disabled={pending} /></Field>
    <fieldset className="flex min-w-0 flex-col gap-4"><legend className="mb-3 text-title">Skills</legend>
      {skills.map((skill, index) => <div key={skill.key} className="flex min-w-0 flex-col gap-3 border-t border-line pt-3 sm:flex-row sm:items-end">
        <Field label={`Skill ${index + 1}`} required className="min-w-0 flex-1"><Input value={skill.skill} maxLength={60} disabled={pending} onChange={e => setSkills(old => old.map(s => s.key === skill.key ? { ...s, skill: e.target.value } : s))} /></Field>
        <Field label={`Experience with skill ${index + 1}`}><Dropdown value={String(skill.level)} disabled={pending} onChange={e => setSkills(old => old.map(s => s.key === skill.key ? { ...s, level: Number(e.target.value) } : s))}><option value="1">Learning</option><option value="2">Practising</option><option value="3">Can teach</option></Dropdown></Field>
        <Button type="button" variant="quiet" disabled={pending} onClick={() => setSkills(old => old.filter(s => s.key !== skill.key))}>Remove skill {index + 1}</Button>
      </div>)}
      <div><Button type="button" variant="secondary" disabled={pending || skills.length >= 40} onClick={() => setSkills(old => [...old, { key: crypto.randomUUID(), skill: "", level: 1 }])}>Add skill</Button></div>
    </fieldset>
    {error ? <p role="alert" className="text-body-ui text-danger-fg">{error}</p> : null}
    <div><Button type="submit" loading={pending}>Save changes</Button></div>
  </form>;
}
