"use client";
import { useState } from "react";
import { approveSecretsDevice } from "@/app/actions/secrets";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormPageLayout } from "@/components/ui/layouts";
import { Card, PageHeader, Callout } from "@/components/ui/display";
export function DeviceApproval({
  userCode,
  device,
  mfaEnabled,
}: {
  userCode: string;
  device: {
    deviceName: string;
    scope: string;
  } | null;
  mfaEnabled: boolean;
}) {
  const [result, setResult] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [code, setCode] = useState("");
  async function decide(approve: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await approveSecretsDevice(userCode, approve, code);
      if (r.ok)
        setResult(
          approve
            ? "Device authorised. Return to your terminal."
            : "Device denied.",
        );
      else setError(r.error ?? "Couldn't authorise the device.");
    } catch {
      setError("Couldn't authorise the device. Try again.");
    } finally {
      setCode("");
      setBusy(false);
    }
  }
  return (
    <FormPageLayout className="max-w-xl" header={<PageHeader title="Authorise a CLI device" />}>
      <Card>
        {result ? <Callout tone="info" role="status">{result}</Callout> : device ? (
          <div className="mt-4 grid gap-4">
            <p>
              Code: <strong>{userCode}</strong>
            </p>
            <p>
              Device: <strong className="break-all">{device.deviceName}</strong>
            </p>
            <p>
              This grants Secrets access across your workspaces, limited by your
              current project and environment permissions. The device can read
              values and request changes where you have access.
            </p>
            <p>
              Approve only if you started this login and the code matches your
              terminal.
            </p>
            {mfaEnabled ? (
              <Field label="Fresh authenticator code">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  pattern="[0-9]{6}"
                  maxLength={6}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                />
              </Field>
            ) : null}
            {error ? (
              <p role="alert" className="text-danger-fg">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" loading={busy} disabled={busy} onClick={() => void decide(true)}>
                Authorise device
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void decide(false)}
              >
                Deny device
              </Button>
            </div>
          </div>
        ) : (
          <form method="get" className="mt-4 grid gap-4">
            <p>
              Enter the code printed by your terminal. Codes expire after ten
              minutes.
            </p>
            <Field label="Device code">
              <Input
                name="code"
                pattern="[A-Za-z0-9]{8}"
                minLength={8}
                maxLength={8}
                required
                autoComplete="off"
                defaultValue={userCode}
              />
            </Field>
            <Button variant="primary" type="submit">Find device</Button>
          </form>
        )}
      </Card>
    </FormPageLayout>
  );
}
