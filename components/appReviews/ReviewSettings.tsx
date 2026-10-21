"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { reviewSettings } from "@/lib/appReviews/queries";
import type { ActionResult } from "@/lib/actionResult";
import { saveAppReviewAccountAction, saveReviewedAppAction, saveAppReviewSlackAction, saveAppReviewSlackMemberAction, testAppReviewConnectionAction } from "@/app/actions/appReviews";
import { Button } from "@/components/ui/button";
import { Card, Chip } from "@/components/ui/display";
import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import { CheckboxField } from "@/components/ui/choice";
import { formatDayTime } from "@/lib/format/datetime";
import { platformLabel } from "./ReviewNav";

type Settings = NonNullable<Awaited<ReturnType<typeof reviewSettings>>>;
type Account = Settings["accounts"][number];
type App = Settings["apps"][number];
const value = (data: FormData, name: string) => String(data.get(name) ?? "");
const optional = (data: FormData, name: string) => value(data, name) || undefined;

function SaveForm({ children, save, label = "Save changes", clearSecrets = false }: { children: ReactNode; save: (data: FormData) => Promise<ActionResult<unknown>>; label?: string; clearSecrets?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  return <form onSubmit={e => {
    e.preventDefault(); const form = e.currentTarget; const data = new FormData(form);
    start(async () => {
      try {
        const next = await save(data); setResult(next);
        if (next.ok) {
          if (clearSecrets) form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-secret]").forEach(input => { input.value = ""; });
          router.refresh();
        }
      } catch { setResult({ ok: false, error: "Couldn't save. Try again." }); }
    });
  }} className="space-y-4">
    <fieldset disabled={pending} className="min-w-0 space-y-4">{children}</fieldset>
    <Button type="submit" variant="primary" disabled={pending}>{pending ? "Saving" : label}</Button>
    {result ? <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-caption text-ink-secondary" : "text-caption text-danger-fg"}>{result.ok ? "Saved." : result.error}</p> : null}
  </form>;
}
function Toggle({ name, label, initial = false }: { name: string; label: string; initial?: boolean }) {
  return <CheckboxField name={name} label={label} defaultChecked={initial} className="min-h-11 items-center" />;
}
function ProxyFields() {
  return <><Field label="Egress proxy URL" optional helperText="Leave blank to keep the saved proxy."><Input name="proxyUrl" type="password" autoComplete="new-password" maxLength={2000} data-secret /></Field><Toggle name="clearProxy" label="Remove the saved proxy" /></>;
}
function AccountForm({ slug, account }: { slug: string; account?: Account }) {
  const [platform, setPlatform] = useState<"APPLE" | "GOOGLE">(account?.platform ?? "APPLE");
  return <SaveForm clearSecrets label={account ? "Save account" : "Add account"} save={data => saveAppReviewAccountAction(slug, {
    id: account?.id, name: value(data, "name"), platform,
    issuerId: optional(data, "issuerId"), keyId: optional(data, "keyId"), privateKeyP8: optional(data, "privateKeyP8"), serviceAccountJson: optional(data, "serviceAccountJson"), proxyUrl: optional(data, "proxyUrl"), clearProxy: data.has("clearProxy"), active: data.has("active"),
  })}>
    <Field label="Account name"><Input name="name" defaultValue={account?.name} required maxLength={100} /></Field>
    <Field label="Platform"><Dropdown value={platform} disabled={Boolean(account)} onChange={e => setPlatform(e.target.value as typeof platform)}><option value="APPLE">App Store</option><option value="GOOGLE">Google Play</option></Dropdown></Field>
    <p className="text-caption text-ink-muted">Credentials are write-only. Leave a credential blank to keep its saved value.</p>
    {platform === "APPLE" ? <>
      <Field label="Issuer ID"><Input name="issuerId" type="password" autoComplete="new-password" data-secret required={!account} /></Field>
      <Field label="Key ID"><Input name="keyId" type="password" autoComplete="new-password" data-secret required={!account} /></Field>
      <Field label="Private key (.p8)"><Textarea name="privateKeyP8" rows={5} autoComplete="off" spellCheck={false} data-secret required={!account} maxLength={30000} /></Field>
    </> : <Field label="Service account JSON"><Textarea name="serviceAccountJson" rows={6} autoComplete="off" spellCheck={false} data-secret required={!account} maxLength={30000} /></Field>}
    <ProxyFields /><Toggle name="active" label="Account active" initial={account?.active ?? true} />
  </SaveForm>;
}
function AppForm({ slug, app, data }: { slug: string; app?: App; data: Settings }) {
  const [accountId, setAccountId] = useState(app?.accountId ?? data.accounts[0]?.id ?? "");
  const account = data.accounts.find(a => a.id === accountId);
  return <SaveForm clearSecrets label={app ? "Save app" : "Add app"} save={form => saveReviewedAppAction(slug, {
    id: app?.id, name: value(form, "name"), accountId, platform: account?.platform, appIdentifier: app?.appIdentifier ?? value(form, "appIdentifier"), active: form.has("active"), pollIntervalMinutes: value(form, "pollIntervalMinutes"),
    proxyUrl: optional(form, "proxyUrl"), clearProxy: form.has("clearProxy"), allowNoProxy: form.has("allowNoProxy"), slackChannelId: value(form, "slackChannelId"), linkedProjectId: value(form, "linkedProjectId") || null, linkedServiceId: value(form, "linkedServiceId") || null,
    translationLanguage: value(form, "translationLanguage"), destinationIds: form.getAll("destinationIds").map(String), routingRatings: form.getAll("routingRatings").map(Number),
  })}>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="App name"><Input name="name" defaultValue={app?.name} required maxLength={100} /></Field>
      <Field label="Store account"><Dropdown value={accountId} onChange={e => setAccountId(e.target.value)} required>{data.accounts.filter(a => !app || a.platform === app.platform).map(a => <option key={a.id} value={a.id}>{a.name} · {platformLabel(a.platform)}</option>)}</Dropdown></Field>
      <Field label={account?.platform === "GOOGLE" ? "Google package name" : "Apple numeric app ID"}><Input name="appIdentifier" defaultValue={app?.appIdentifier} required readOnly={Boolean(app)} maxLength={250} /></Field>
      <Field label="Poll interval (minutes)"><Input type="number" name="pollIntervalMinutes" min={5} max={1440} defaultValue={app?.pollIntervalMinutes ?? 15} required /></Field>
      <Field label="Slack mirror channel ID" optional helperText="Every review goes to this channel once. Invite the bot first."><Input name="slackChannelId" defaultValue={app?.slackChannelId ?? ""} placeholder="C0123456789" maxLength={100} /></Field>
      <Field label="Translation language" optional helperText="Google only, such as en. Original text is retained when supplied."><Input name="translationLanguage" defaultValue={app?.translationLanguage ?? ""} maxLength={10} /></Field>
      <Field label="Linked project" optional><Dropdown name="linkedProjectId" defaultValue={app?.linkedProjectId ?? ""}><option value="">No project</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Dropdown></Field>
      <Field label="Linked service" optional><Dropdown name="linkedServiceId" defaultValue={app?.linkedServiceId ?? ""}><option value="">No service</option>{data.services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Dropdown></Field>
    </div>
    <ProxyFields /><Toggle name="allowNoProxy" label="Allow a direct connection when no proxy is saved" initial={app?.allowNoProxy} />
    <fieldset className="space-y-2"><legend className="text-label">Send to</legend><p className="text-caption text-ink-muted">Choose configured notification destinations. Workspace routing rules also apply.</p>{data.destinations.length ? data.destinations.map(d => <CheckboxField key={d.id} name="destinationIds" value={d.id} label={`${d.name} · ${d.kind.toLowerCase().replaceAll("_", " ")}`} defaultChecked={app?.destinationIds.includes(d.id)} className="min-h-11 items-center" />) : <p className="text-caption text-ink-muted">No destinations configured yet.</p>}</fieldset>
    <fieldset className="space-y-2"><legend className="text-label">Ratings sent to these destinations</legend><p className="text-caption text-ink-muted">Leave all unchecked for every rating. Select 1 and 2 to route low ratings to your on-call destination.</p><div className="flex flex-wrap gap-4">{[1, 2, 3, 4, 5].map(r => <CheckboxField key={r} name="routingRatings" value={String(r)} label={`${r} out of 5`} defaultChecked={app?.routingRatings.includes(r)} className="min-h-11 items-center" />)}</div></fieldset>
    <Toggle name="active" label="App active (uncheck to pause polling and replies)" initial={app?.active ?? true} />
  </SaveForm>;
}
function TestConnection({ slug, appId }: { slug: string; appId: string }) {
  const [pending, start] = useTransition(); const [result, setResult] = useState<ActionResult | null>(null);
  return <div className="mt-4 space-y-2"><Button disabled={pending} onClick={() => start(async () => { try { setResult(await testAppReviewConnectionAction(slug, appId)); } catch { setResult({ ok: false, error: "Couldn't test the connection. Try again." }); } })}>{pending ? "Testing" : "Test connection"}</Button>{result ? <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-caption text-ink-secondary" : "text-caption text-danger-fg"}>{result.ok ? "Connected. Review access confirmed." : result.error}</p> : null}</div>;
}
export function ReviewSettings({ slug, data, timezone, eventUrl }: { slug: string; data: Settings; timezone: string; eventUrl: string }) {
  return <div className="space-y-6">
    <section className="space-y-3" aria-labelledby="review-accounts"><h2 id="review-accounts" className="text-h3">Store accounts</h2>{data.accounts.map(a => <Card key={a.id}><details><summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-3 text-title">{a.name}<Chip tone={a.active ? "success" : "neutral"}>{a.active ? "Active" : "Paused"}</Chip></summary><div className="mt-4"><AccountForm slug={slug} account={a} /></div></details>{a.lastError ? <p className="mt-3 text-caption text-danger-fg">{a.lastError}</p> : null}</Card>)}<Card><details open={!data.accounts.length}><summary className="min-h-11 cursor-pointer text-title">Add store account</summary><AccountForm slug={slug} /></details></Card></section>
    <section className="space-y-3" aria-labelledby="review-apps"><h2 id="review-apps" className="text-h3">Apps</h2>{data.apps.map(app => <Card key={app.id}><details><summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-3 text-title">{app.name}<Chip tone={app.active ? "success" : "neutral"}>{app.active ? "Active" : "Paused"}</Chip></summary><div className="mt-4"><AppForm slug={slug} app={app} data={data} /></div></details><p className="mt-3 text-caption text-ink-muted">{app.lastPolledAt ? `Last polled ${formatDayTime(app.lastPolledAt, timezone)}` : "Not polled yet"}</p>{app.lastError ? <p className="mt-2 text-caption text-danger-fg">{app.lastError}</p> : null}<TestConnection slug={slug} appId={app.id} /></Card>)}<Card>{data.accounts.length ? <details open={!data.apps.length}><summary className="min-h-11 cursor-pointer text-title">Add app</summary><AppForm slug={slug} data={data} /></details> : <p>Add a store account to connect your first app.</p>}</Card></section>
    <Card><h2 className="mb-3 text-h3">Slack replies</h2><p className="mb-4 text-body-ui">Reply in a review thread, then react to your own reply with the trigger emoji to send it to the store.</p>
      <SaveForm clearSecrets label="Save Slack configuration" save={form => saveAppReviewSlackAction(slug, { botToken: optional(form, "botToken"), signingSecret: optional(form, "signingSecret"), replyTriggerEmoji: value(form, "replyTriggerEmoji"), active: form.has("active") })}>
        <Field label="Bot token" helperText="Leave blank to keep the saved token."><Input name="botToken" type="password" autoComplete="new-password" data-secret required={!data.slack} /></Field>
        <Field label="Signing secret" helperText="Leave blank to keep the saved secret."><Input name="signingSecret" type="password" autoComplete="new-password" data-secret required={!data.slack} /></Field>
        <Field label="Trigger emoji name"><Input name="replyTriggerEmoji" defaultValue={data.slack?.replyTriggerEmoji ?? "white_check_mark"} required maxLength={80} /></Field>
        <Toggle name="active" label="Enable Slack replies and mirroring" initial={data.slack?.active ?? true} />
      </SaveForm>
      <p className="mt-4 break-all text-caption text-ink-muted">Slack event request URL: {eventUrl}</p>
    </Card>
    <Card><h2 className="mb-3 text-h3">Slack member access</h2><p className="mb-4 text-body-ui">Map a Slack user ID to an active workspace member before they can send replies. Saving an existing Slack ID replaces its mapping.</p>
      <ul className="mb-4 space-y-2 text-caption">{data.slackMembers.map(m => <li key={m.slackUserId}>{m.slackUserId} → {data.members.find(u => u.userId === m.userId)?.user.name ?? "Former member"}</li>)}</ul>
      <SaveForm label="Save member mapping" save={form => saveAppReviewSlackMemberAction(slug, { slackUserId: value(form, "slackUserId"), userId: value(form, "userId") })}>
        <Field label="Slack user ID"><Input name="slackUserId" placeholder="U0123456789" required maxLength={100} /></Field>
        <Field label="Workspace member"><Dropdown name="userId" required>{data.members.map(m => <option key={m.userId} value={m.userId}>{m.user.name ?? m.user.email}</option>)}</Dropdown></Field>
      </SaveForm>
    </Card>
  </div>;
}
