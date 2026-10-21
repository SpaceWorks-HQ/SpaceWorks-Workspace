"use client";

import { Form } from "./SecretForm";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Card } from "@/components/ui/display";
import type { SecretsSectionState } from "./useSecretsWorkspace";

export function renderSharingSection(state: SecretsSectionState) {
  const {
    section,
    busy,
    shareLink,
    setShareLink,
    readable,
    act,
  } = state;
  return (
    section === "Sharing" ? (
      <Card>
        <h2 className="mb-4 text-h3">Share secret text</h2>
        <p className="mb-4 text-body-ui">
          Paste a single secret or text. Your browser encrypts it; the key
          stays in the link fragment. Send the entire link privately.
        </p>
        {readable ? (
          <Form
            onSave={async (v, form) => {
              const key = await crypto.subtle.generateKey(
                  { name: "AES-GCM", length: 256 },
                  true,
                  ["encrypt"],
                ),
                iv = crypto.getRandomValues(new Uint8Array(12));
              const encrypted = await crypto.subtle.encrypt(
                { name: "AES-GCM", iv },
                key,
                new TextEncoder().encode(String(v.text)),
              );
              const encode = (a: ArrayBuffer | Uint8Array) =>
                btoa(
                  String.fromCharCode(
                    ...new Uint8Array(
                      a instanceof Uint8Array
                        ? (a.buffer as ArrayBuffer)
                        : a,
                    ),
                  ),
                )
                  .replaceAll("+", "-")
                  .replaceAll("/", "_")
                  .replace(/=+$/, "");
              const raw = await crypto.subtle.exportKey("raw", key),
                ciphertext = encode(iv) + "." + encode(encrypted);
              const result = await act("share", {
                ciphertext,
                hours: Number(v.hours),
                views: Number(v.views),
              });
              if (
                result &&
                typeof result === "object" &&
                "shareCapability" in result
              ) {
                setShareLink(
                  `${location.origin}/share#${result.shareCapability}.${encode(raw)}`,
                );
                form.reset();
              }
            }}
          >
            <Field label="Secret text">
              <Textarea
                name="text"
                required
                maxLength={20000}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field label="Expires in hours">
              <Input
                type="number"
                name="hours"
                min={1}
                max={168}
                defaultValue={24}
              />
            </Field>
            <Field label="Allowed views">
              <Input
                type="number"
                name="views"
                min={1}
                max={20}
                defaultValue={1}
              />
            </Field>
            <Button variant="primary" type="submit" disabled={busy}>Create private link</Button>
          </Form>
        ) : (
          <p>Read values access is required to share.</p>
        )}
        {shareLink ? (
          <div className="mt-4">
            <p>Copy the whole link now.</p>
            <pre className="code-text whitespace-pre-wrap break-all">
              {shareLink}
            </pre>
          </div>
        ) : null}
      </Card>
    ) : null
  );
}
