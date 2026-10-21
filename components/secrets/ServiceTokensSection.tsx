"use client";

import { Form } from "./SecretForm";
import { CheckboxCard } from "@/components/ui/choice";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Card, Chip } from "@/components/ui/display";
import { formatDate } from "@/lib/format/datetime";
import type { SecretsSectionState } from "./useSecretsWorkspace";

export function renderServiceTokensSection(state: SecretsSectionState) {
  const {
    view,
    timezone,
    section,
    busy,
    now,
    issued,
    setIssued,
    setConfirm,
    env,
    project,
    path,
    admin,
    act,
  } = state;
  return (
    section === "Service tokens" && admin ? (
      <>
        <Card>
          <h2 className="mb-4 text-h3">Legacy service tokens</h2><p className="mb-4">Move applications to Machine identities for short-lived access tokens. Existing service tokens continue to work.</p>
          <Form
            onSave={async (v, form) => {
              const result = await act("token", {
                name: v.name,
                path: v.path,
                writable: v.writable === "on",
                expiresAt: v.expiresAt
                  ? new Date(String(v.expiresAt)).toISOString()
                  : null,
                ipAllowlist: String(v.ipAllowlist)
                  .split(/[\s,]+/)
                  .filter(Boolean),
              });
              if (
                result &&
                typeof result === "object" &&
                "issuedCredential" in result
              ) {
                setIssued(String(result.issuedCredential));
                form.reset();
              }
            }}
          >
            <Field label="Name">
              <Input name="name" required maxLength={100} />
            </Field>
            <Field label="Exact folder path">
              <Input name="path" defaultValue={path} required />
            </Field>
            <Field label="Expires on" optional>
              <Input type="date" name="expiresAt" />
            </Field>
            <Field label="IP addresses or CIDR ranges" optional>
              <Textarea name="ipAllowlist" placeholder="One per line" />
            </Field>
            <CheckboxCard label="Allow writes" name="writable" />
            <Button variant="primary" type="submit" disabled={busy}>Create token</Button>
          </Form>
          {issued ? (
            <div className="mt-4">
              <p>Copy this token now. It is shown only once.</p>
              <pre className="code-text whitespace-pre-wrap break-all">
                {issued}
              </pre>
              <Button variant="quiet" onClick={() => setIssued("")}>
                Hide token
              </Button>
            </div>
          ) : null}
        </Card>
        {view.tokens.map((t) => (
          <Card key={t.id}>
            <h2 className="text-title">{t.name}</h2>
            <p>
              {t.path} · {t.writable ? "Read and write" : "Read only"} ·{" "}
              {t.expiresAt
                ? `Expires ${formatDate(t.expiresAt, timezone)}`
                : "No expiry"}{" "}
              ·{" "}
              {t.lastUsedAt
                ? `Used ${formatDate(t.lastUsedAt, timezone)}`
                : "Never used"}
            </p>
            <Chip>
              {t.revokedAt
                ? "Revoked"
                : t.expiresAt &&
                    new Date(t.expiresAt).getTime() <= now
                  ? "Expired"
                  : "Active"}
            </Chip>
            {!t.revokedAt ? (
              <Button
                variant="dangerQuiet"
                onClick={() =>
                  setConfirm({
                    title: "Revoke this service token?",
                    operation: "revoke-token",
                    input: { id: t.id },
                  })
                }
              >
                Revoke…
              </Button>
            ) : null}
          </Card>
        ))}
        <pre className="code-text overflow-x-auto rounded-lg bg-surface p-4 text-caption">
          {'curl -fsSL -H "Authorization: Bearer $SWW_SECRETS_TOKEN" \\\n  "https://workspace.example.org/api/v1/secrets?project=' +
            project.id +
            "&environment=" +
            env.slug +
            '&path=/&format=env" > .env'}
        </pre>
      </>
    ) : null
  );
}
