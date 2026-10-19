"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createApiTokenAction, revokeApiTokenAction } from "@/app/actions/apiTokens";
import { Button } from "@/components/ui/button";
import { Callout, Chip, EmptyState } from "@/components/ui/display";
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Dropdown, Field, Input, ReadOnlyValue } from "@/components/ui/field";
import { CheckboxCard } from "@/components/ui/choice";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/feedback/ToastProvider";
import { API_SCOPES, scopeLabel } from "@/lib/apiTokens/scopes";

type TokenRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdBy: string;
  created: string;
  lastUsed: string | null;
  expires: string | null;
  status: "active" | "revoked" | "expired";
};

const STATUS_TONE = { active: "success", revoked: "outline", expired: "warning" } as const;
const STATUS_LABEL = { active: "Active", revoked: "Revoked", expired: "Expired" } as const;

export function ApiTokensManager({ slug, origin, tokens }: { slug: string; origin: string; tokens: TokenRow[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read:tasks", "read:docs", "mcp"]);
  const [expiry, setExpiry] = useState("90");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<TokenRow | null>(null);

  const reset = () => {
    setName("");
    setScopes(["read:tasks", "read:docs", "mcp"]);
    setExpiry("90");
    setErrors({});
    setSecret(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[640px] text-body-ui text-ink-secondary">
          Tokens let scripts and AI clients use the machine API (<code>{origin}/api/v1</code>) and the MCP server (<code>{origin}/api/mcp</code>). A token acts for the admin who made it, limited to its scopes, and stops working if that admin leaves.
        </p>
        <Button variant="primary" startIcon={<Plus />} onClick={() => { reset(); setCreating(true); }}>New token</Button>
      </div>

      {tokens.length === 0 ? (
        <EmptyState title="No API tokens yet.">Create one to connect Claude Desktop, Claude Code or a script.</EmptyState>
      ) : (
        <Table label="API tokens">
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Token</TH>
              <TH>Scopes</TH>
              <TH>Last used</TH>
              <TH>Status</TH>
              <TH><span className="sr-only">Actions</span></TH>
            </TR>
          </THead>
          <TBody>
            {tokens.map((token) => (
              <TR key={token.id}>
                <TD>
                  <span className="block font-semibold">{token.name}</span>
                  <span className="block text-caption text-ink-muted">{token.createdBy} · {token.created}{token.expires ? ` · expires ${token.expires}` : ""}</span>
                </TD>
                <TD className="whitespace-nowrap text-ink-secondary">{token.prefix}_…</TD>
                <TD>
                  <span className="flex max-w-[320px] flex-wrap gap-1">
                    {token.scopes.map((scope) => <Chip key={scope} size="sm" tone="outline">{scopeLabel(scope)}</Chip>)}
                  </span>
                </TD>
                <TD className="whitespace-nowrap text-ink-secondary">{token.lastUsed ?? "Never"}</TD>
                <TD><Chip size="sm" tone={STATUS_TONE[token.status]}>{STATUS_LABEL[token.status]}</Chip></TD>
                <TD className="text-right">
                  {token.status === "active" ? <Button size="sm" variant="dangerOutline" onClick={() => setRevoking(token)}>Revoke…</Button> : null}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Dialog open={creating} onOpenChange={(open) => { if (!open) { setCreating(false); if (secret) router.refresh(); } }}>
        <DialogContent size="md">
          {secret ? (
            <>
              <DialogHeader title="Copy your token now" description="This is the only time it is shown. Store it in a password manager or your client's secret settings." />
              <DialogBody className="flex flex-col gap-3">
                <ReadOnlyValue
                  value={<span className="select-all [overflow-wrap:anywhere]">{secret}</span>}
                  action={
                    <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(secret).then(() => showToast("Token copied.", "success"), () => showToast("Couldn't copy. Select the text instead.", "error"))}>
                      Copy
                    </Button>
                  }
                />
                <Callout tone="info">Send it as <code>Authorization: Bearer &lt;token&gt;</code>. See docs/MCP.md and docs/API.md for client setup.</Callout>
              </DialogBody>
              <DialogFooter>
                <Button variant="primary" onClick={() => { setCreating(false); router.refresh(); }}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={(event) => {
                event.preventDefault();
                startTransition(async () => {
                  const result = await createApiTokenAction(slug, { name, scopes, expiresInDays: expiry === "never" ? null : Number(expiry) });
                  if (!result.ok) {
                    setErrors(result.fieldErrors ?? {});
                    showToast(result.error, "error");
                    return;
                  }
                  setSecret(result.data!.token);
                });
              }}
            >
              <DialogHeader title="New API token" description="Give it only the scopes it needs." />
              <DialogBody className="flex flex-col gap-4">
                <Field label="Name" helperText="What uses it, e.g. Claude Desktop on the front desk laptop." error={errors.name?.[0]}>
                  <Input value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
                </Field>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1.5 text-label text-ink">Scopes</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {API_SCOPES.map((scope) => (
                      <CheckboxCard
                        key={scope.value}
                        label={scope.label}
                        description={scope.description}
                        checked={scopes.includes(scope.value)}
                        onCheckedChange={(checked) => setScopes(checked ? [...scopes, scope.value] : scopes.filter((s) => s !== scope.value))}
                      />
                    ))}
                  </div>
                  {errors.scopes?.[0] ? <p className="text-caption text-danger-fg">{errors.scopes[0]}</p> : null}
                </fieldset>
                <Field label="Expires">
                  <Dropdown value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                    <option value="30">In 30 days</option>
                    <option value="90">In 90 days</option>
                    <option value="365">In a year</option>
                    <option value="never">Never</option>
                  </Dropdown>
                </Field>
              </DialogBody>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
                <Button type="submit" variant="primary" loading={pending}>Create token</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={revoking !== null}
        title={`Revoke ${revoking?.name ?? "this token"}?`}
        message="Anything using it stops working straight away. This can't be undone."
        confirmLabel="Revoke token"
        loading={pending}
        onCancel={() => setRevoking(null)}
        onConfirm={() =>
          revoking &&
          startTransition(async () => {
            const result = await revokeApiTokenAction(slug, { tokenId: revoking.id });
            if (!result.ok) showToast(result.error, "error");
            else showToast("Token revoked.", "success");
            setRevoking(null);
            router.refresh();
          })
        }
      />
    </div>
  );
}
