"use client";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, Chip } from "@/components/ui/display";
import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import type { SecretsView } from "@/lib/secrets/types";
type Action = (operation: string, input?: Record<string, unknown>, refresh?: boolean) => Promise<unknown>;
export function IdentitySettings({ view, act, busy }: { view: SecretsView; act: Action; busy: boolean }) {
  const [issued, setIssued] = useState("");
  const [now] = useState(() => Date.now());
  const [confirm, setConfirm] = useState<{ operation: string; input: Record<string, unknown> } | null>(null);
  useEffect(() => {
    const hide = () => setIssued("");
    const timer = setTimeout(hide, 60000);
    const hidden = () => { if (document.hidden) hide(); };
    window.addEventListener("blur", hide); document.addEventListener("visibilitychange", hidden);
    return () => { clearTimeout(timer); window.removeEventListener("blur", hide); document.removeEventListener("visibilitychange", hidden); };
  }, [issued]);
  return <fieldset disabled={busy} aria-label="Machine identities" className="min-w-0 grid gap-4">
    <Card><h2 className="text-h3">Machine identities</h2><p className="mb-4">Use short-lived access tokens for CI and applications. Client secrets are shown once.</p>
      <form className="grid gap-4" onSubmit={async e => {
        e.preventDefault(); const form = e.currentTarget, v = new FormData(form);
        const optional = (name: string) => v.get(name) ? Number(v.get(name)) : null;
        await act("identity", { name: v.get("name"), path: v.get("path"), role: v.get("role"), accessTtl: Number(v.get("hours")) * 3600, maxTtl: Number(v.get("days")) * 86400, tokenUses: optional("tokenUses"), secretUses: optional("secretUses"), secretTtl: optional("secretDays") === null ? null : Number(v.get("secretDays")) * 86400, loginIps: String(v.get("loginIps")).split(/[\s,]+/).filter(Boolean), tokenIps: String(v.get("tokenIps")).split(/[\s,]+/).filter(Boolean), failureLimit: Number(v.get("failureLimit")), lockoutSeconds: Number(v.get("lockMinutes")) * 60 });
      }}>
        <Field label="Identity name"><Input name="name" required maxLength={100} /></Field>
        <Field label="Exact folder path"><Input name="path" defaultValue={view.path} required /></Field>
        <Field label="Permission in this environment"><Dropdown name="role"><option value="KEYS">Key names only</option><option value="READ">Read values</option><option value="WRITE">Read and write</option></Dropdown></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Access token lifetime (hours)"><Input name="hours" type="number" min={1} max={720} defaultValue={2} required /></Field>
          <Field label="Maximum renewable lifetime (days)"><Input name="days" type="number" min={1} max={30} defaultValue={30} required /></Field>
          <Field label="Uses per access token" optional helperText="Blank means unlimited."><Input name="tokenUses" type="number" min={1} max={1000000} /></Field>
          <Field label="Logins per client secret" optional helperText="Blank means unlimited."><Input name="secretUses" type="number" min={1} max={1000000} /></Field>
          <Field label="Client secret lifetime (days)" optional><Input name="secretDays" type="number" min={1} max={30} /></Field>
          <Field label="Failed logins before lockout"><Input name="failureLimit" type="number" min={1} max={20} defaultValue={3} required /></Field>
          <Field label="Lockout duration (minutes)"><Input name="lockMinutes" type="number" min={1} max={1440} defaultValue={5} required /></Field>
        </div>
        <Field label="Trusted login IP ranges" optional helperText="IP addresses or CIDR ranges, one per line. Blank permits any IP."><Textarea name="loginIps" /></Field>
        <Field label="Trusted token-use IP ranges" optional><Textarea name="tokenIps" /></Field>
        <Button type="submit" variant="primary">Create identity</Button>
      </form>
      <p className="mt-4 text-body-ui">Log in at /api/v1/auth/universal/login with the client ID and a client secret. Use the returned short-lived bearer token as SWW_TOKEN.</p>
      <pre className="code-text mt-3 overflow-x-auto rounded-lg bg-surface p-3 text-caption">sww login --method=universal-auth --client-id ID --client-secret SECRET --plain --silent</pre>
    </Card>
    {issued && <Card><p>Copy this client secret now. It is shown only once.</p><pre className="whitespace-pre-wrap break-all code-text">{issued}</pre><Button variant="quiet" onClick={() => setIssued("")}>Hide client secret</Button></Card>}
    {view.identities.map(identity => <Card key={identity.id}>
      <h3 className="text-title">{identity.name}</h3><Chip>{identity.revokedAt ? "Revoked" : identity.lockedUntil && new Date(identity.lockedUntil).getTime() > now ? "Locked" : "Active"}</Chip>
      <p className="break-all">Client ID: {identity.clientId}</p><p>Tokens last {identity.accessTtl / 3600} hours, renewable for {identity.maxTtl / 86400} days.</p>
      {identity.permissions.map(p => <p key={p.environmentId + p.path}>{view.project?.environments.find(e => e.id === p.environmentId)?.name ?? "Restricted environment"} · {p.path} · {p.role.toLowerCase()}</p>)}
      {!identity.revokedAt && <div className="mt-4 grid gap-3">
        <details><summary className="min-h-11 cursor-pointer">Edit identity settings</summary>
          <form className="grid gap-3" onSubmit={async e => { e.preventDefault(); const v = new FormData(e.currentTarget); const optional = (name: string) => v.get(name) ? Number(v.get(name)) : null;
            await act("identity-settings", { id: identity.id, name: v.get("name"), accessTtl: Number(v.get("hours")) * 3600, maxTtl: Number(v.get("days")) * 86400, tokenUses: optional("tokenUses"), secretUses: optional("secretUses"), secretTtl: optional("secretDays") === null ? null : Number(v.get("secretDays")) * 86400, loginIps: String(v.get("loginIps")).split(/[\s,]+/).filter(Boolean), tokenIps: String(v.get("tokenIps")).split(/[\s,]+/).filter(Boolean), failureLimit: Number(v.get("failureLimit")), lockoutSeconds: Number(v.get("lockMinutes")) * 60 });
          }}>
            <p>Saving settings revokes current access tokens. New client-secret limits apply to secrets issued afterwards.</p>
            <Field label="Name"><Input name="name" defaultValue={identity.name} required maxLength={100} /></Field>
            <div className="grid gap-3 sm:grid-cols-2"><Field label="Access lifetime (hours)"><Input type="number" name="hours" min={1} max={720} defaultValue={identity.accessTtl / 3600} required /></Field><Field label="Maximum lifetime (days)"><Input type="number" name="days" min={1} max={30} defaultValue={identity.maxTtl / 86400} required /></Field>
            <Field label="Uses per token" optional><Input type="number" name="tokenUses" min={1} max={1000000} defaultValue={identity.tokenUses ?? ""} /></Field><Field label="Logins per new client secret" optional><Input type="number" name="secretUses" min={1} max={1000000} defaultValue={identity.secretUses ?? ""} /></Field>
            <Field label="New client secret lifetime (days)" optional><Input type="number" name="secretDays" min={1} max={30} defaultValue={identity.secretTtl ? identity.secretTtl / 86400 : ""} /></Field><Field label="Failures before lockout"><Input type="number" name="failureLimit" min={1} max={20} defaultValue={identity.failureLimit} required /></Field><Field label="Lockout (minutes)"><Input type="number" name="lockMinutes" min={1} max={1440} defaultValue={identity.lockoutSeconds / 60} required /></Field></div>
            <Field label="Trusted login IP ranges" optional><Textarea name="loginIps" defaultValue={identity.loginIps.join("\n")} /></Field><Field label="Trusted token-use IP ranges" optional><Textarea name="tokenIps" defaultValue={identity.tokenIps.join("\n")} /></Field><Button type="submit" variant="secondary">Save settings and revoke tokens</Button>
          </form>
        </details>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={async () => { const result = await act("identity-credential", { id: identity.id }); if (result && typeof result === "object" && "issuedCredential" in result) setIssued(String(result.issuedCredential)); }}>Issue client secret</Button><Button variant="quiet" onClick={() => void act("identity-reset", { id: identity.id })}>Reset lockout</Button></div>
        <form className="grid gap-3 sm:grid-cols-3" onSubmit={async e => { e.preventDefault(); const v = new FormData(e.currentTarget); await act("identity-permission", { id: identity.id, role: v.get("role"), path: v.get("path") }); }}><Field label="Folder in this environment"><Input name="path" defaultValue={view.path} required /></Field><Field label="Permission"><Dropdown name="role"><option value="NONE">No access</option><option value="KEYS">Key names</option><option value="READ">Read</option><option value="WRITE">Write</option></Dropdown></Field><Button type="submit" variant="secondary">Save permission</Button></form>
        {identity.clientSecretMetadata.filter(c => !c.revokedAt).map(c => <div key={c.id} className="flex flex-wrap items-center gap-2"><span className="break-all">Client secret {c.id} · {c.remainingUses ?? "Unlimited"} logins remaining</span><Button variant="dangerQuiet" onClick={() => setConfirm({ operation: "identity-revoke-credential", input: { id: identity.id, credentialId: c.id } })}>Revoke client secret</Button></div>)}
        {identity.tokens.map(t => <div key={t.id} className="flex flex-wrap items-center gap-2"><span className="break-all">Access token {t.id} · {t.remainingUses ?? "Unlimited"} uses remaining</span><Button variant="dangerQuiet" onClick={() => setConfirm({ operation: "identity-revoke-access", input: { id: identity.id, tokenId: t.id } })}>Revoke access token</Button></div>)}
        <Button variant="dangerQuiet" onClick={() => setConfirm({ operation: "identity-revoke", input: { id: identity.id } })}>Revoke identity</Button>
      </div>}
    </Card>)}
    <ConfirmDialog loading={busy} open={!!confirm} title="Revoke this credential or identity?" message="Applications using it will lose access immediately." confirmLabel="Revoke access" onCancel={() => setConfirm(null)} onConfirm={async () => { if (confirm && await act(confirm.operation, confirm.input)) setConfirm(null); }} />
  </fieldset>;
}
