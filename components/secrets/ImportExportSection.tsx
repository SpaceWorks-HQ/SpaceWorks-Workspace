"use client";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Card } from "@/components/ui/display";
import type {
  Preview,
} from "@/lib/secrets/types";
import type { SecretsSectionState } from "./useSecretsWorkspace";

export function renderImportExportSection(state: SecretsSectionState) {
  const {
    section,
    setError,
    busy,
    source,
    setSource,
    preview,
    setPreview,
    env,
    path,
    writable,
    readable,
    act,
    valueRequest,
  } = state;
  return (
    section === "Import and export" ? (
      <>
        {writable ? (
          <Card>
            <h2 className="mb-4 text-h3">Import an environment file</h2>
            <div
              className="grid gap-4"
              onDragOver={(e) => e.preventDefault()}
              onDrop={async (e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f && f.size <= 200000) {
                  setSource(await f.text());
                  setPreview(null);
                } else setError("Use an environment file under 200 KB.");
              }}
            >
              <Field label="Choose a .env file or drop it here">
                <Input
                  type="file"
                  accept=".env,text/plain"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f && f.size <= 200000) {
                      setSource(await f.text());
                      setPreview(null);
                    } else
                      setError("Use an environment file under 200 KB.");
                  }}
                />
              </Field>
              <Field label="Or paste KEY=value lines">
                <Textarea
                  value={source}
                  maxLength={200000}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => {
                    setSource(e.target.value);
                    setPreview(null);
                  }}
                />
              </Field>
              <Button
                variant="secondary"
                disabled={busy || !source}
                onClick={async () => {
                  const result = await act(
                    "preview",
                    { path, source },
                    false,
                  );
                  if (result) setPreview(result as Preview);
                }}
              >
                Preview import
              </Button>
              {preview ? (
                <>
                  <ul>
                    {preview.diff.map((d) => (
                      <li key={d.key}>
                        {d.key} · {d.operation}
                      </li>
                    ))}
                  </ul>
                  <Button
                    disabled={busy}
                    onClick={async () => {
                      const result = await act("import", {
                        path,
                        source,
                        revision: preview.revision,
                      });
                      if (result) {
                        setSource("");
                        setPreview(null);
                      }
                    }}
                  >
                    {env.protected ? "Request import" : "Apply import"}
                  </Button>
                </>
              ) : null}
            </div>
          </Card>
        ) : null}
        {readable ? (
          <Card>
            <h2 className="mb-4 text-h3">Export resolved secrets</h2>
            <p className="mb-4 text-body-ui">
              Verify a fresh code above. The downloaded file contains
              secret values.
            </p>
            <div className="flex flex-wrap gap-2">
              {["env", "json", "yaml"].map((format) => (
                <Button
                  key={format}
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void valueRequest(
                      { operation: "export", format },
                      format === "env" ? ".env" : `secrets.${format}`,
                    )
                  }
                >
                  Export {format}
                </Button>
              ))}
            </div>
          </Card>
        ) : null}
      </>
    ) : null
  );
}
