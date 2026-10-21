"use client";

import { Form } from "./SecretForm";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import { Card } from "@/components/ui/display";
import type { SecretsSectionState } from "./useSecretsWorkspace";

export function renderSecretEditor(state: SecretsSectionState) {
  const {
    view,
    setError,
    busy,
    editorVisible,
    editing,
    setEditing,
    env,
    path,
    writable,
    act,
    toggleEditor,
  } = state;
  return (
    writable ? (
      <Card id="secret-editor">
        <h2 className="mb-4 text-h3">
          {editing ? `Edit ${editing.key}` : "Add a key"}
        </h2>
        <Form
          key={editing?.id ?? "new"}
          onSave={async (v, form) => {
            if (editing && !editing.loaded) { setError("Reveal the current value before editing it."); return; }
            const result = await act("change", {
              changes: [
                {
                  key: v.key,
                  value: v.value,
                  path,
                  comment: v.comment,
                  tags: String(v.tags)
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                  ownerId: v.ownerId,
                  rotateEveryDays: v.rotateEveryDays
                    ? Number(v.rotateEveryDays)
                    : null,
                },
              ],
            });
            if (result) {
              form.reset();
              setEditing(null);
            }
          }}
        >
          <Field label="Key">
            <Input
              name="key"
              pattern="[A-Z_][A-Z0-9_]*"
              maxLength={128}
              required
              defaultValue={editing?.key}
              readOnly={!!editing}
              autoComplete="off"
            />
          </Field>
          {!editorVisible ? <p className="code-text" aria-label="Editor value hidden">••••••••</p> : null}
          <Button type="button" variant="quiet" aria-pressed={editorVisible} disabled={busy} onClick={() => void toggleEditor()}>{editorVisible ? "Hide editor value" : "Show editor value"}</Button>
          <Field
            label="Value"
            helperText={
              "References: ${KEY} or ${production.api.KEY}. Reference access is checked on every read."
            }
          >
            <Textarea
              key={editing ? `${editing.id}:${editing.loaded}` : "new"}
              name="value"
              className="code-text"
              maxLength={20000}
              defaultValue={editing?.value}
              hidden={!editorVisible}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field
            label="Comment"
            optional
            helperText="Keep credentials in the Value field."
          >
            <Textarea
              name="comment"
              maxLength={2000}
              defaultValue={editing?.comment}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tags" optional>
              <Input
                name="tags"
                defaultValue={editing?.tags}
                placeholder="api, website"
              />
            </Field>
            <Field label="Rotation interval in days" optional>
              <Input
                type="number"
                name="rotateEveryDays"
                min={1}
                max={3650}
                defaultValue={editing?.rotateEveryDays}
              />
            </Field>
          </div>
          <Field label="Owner">
            <Dropdown
              name="ownerId"
              defaultValue={
                editing?.ownerId ?? view.members[0]?.userId
              }
            >
              {view.members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.user.name ?? m.user.email}
                </option>
              ))}
            </Dropdown>
          </Field>
          <div className="flex gap-2">
            <Button variant="primary" type="submit" disabled={busy || (editing !== null && !editing.loaded)}>
              {env.protected ? "Request change" : "Save key"}
            </Button>
            {editing ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditing(null)}
              >
                Cancel edit
              </Button>
            ) : null}
          </div>
        </Form>
      </Card>
    ) : null
  );
}
