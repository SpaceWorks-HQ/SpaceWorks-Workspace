"use client";
import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { saveVendorBank, revealVendorBank } from "@/app/actions/governance";
import { Controls } from "./RecordControls";

export function BankForm({
  slug,
  vendorId,
}: {
  slug: string;
  vendorId: string;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const [bank, setBank] = useState<Awaited<
    ReturnType<typeof revealVendorBank>
  > | null>(null);
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const prefix = useId();
  return (
    <section className="space-y-4" aria-labelledby={`${prefix}-bank`}>
      <h3 id={`${prefix}-bank`} className="text-title">
        Bank details
      </h3>
      <p className="text-ink-muted">
        Enter a complete replacement. Each change and reveal is logged. Banking
        values stay out of search and CSV exports.
      </p>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => {
          if (bank) {
            setBank(null);
            return;
          }
          start(async () => {
            try {
              setBank(await revealVendorBank(slug, vendorId));
            } catch {
              setMessage("Couldn't reveal bank details. Try again.");
            }
          });
        }}
      >
        {bank ? "Hide bank details" : "Reveal current bank details"}
      </Button>
      {bank?.ok ? (
        <div className="whitespace-pre-wrap break-words rounded-lg border border-line p-4">
          {bank.data
            ? Object.entries(bank.data).map(([k, v]) => (
                <p key={k}>
                  {
                    (
                      {
                        accountName: "Account holder",
                        accountNumber: "Account number",
                        bankName: "Bank",
                        routingCode: "IFSC / routing code",
                      } as Record<string, string>
                    )[k]
                  }
                  : {v}
                </p>
              ))
            : "No bank details recorded."}
        </div>
      ) : bank ? (
        <p role="alert">{bank.error}</p>
      ) : null}
      <details>
        <summary className="min-h-11 cursor-pointer py-3 text-accent-text">
          Change bank details
        </summary>
        <form
          ref={form}
          className="space-y-4"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            start(async () => {
              try {
                const r = await saveVendorBank(slug, {
                  ...Object.fromEntries(fd),
                  vendorId,
                });
                setMessage(r.ok ? "Bank details saved." : r.error);
                if (r.ok) {
                  setBank(null);
                  form.current?.reset();
                  router.refresh();
                }
              } catch {
                setMessage("Couldn't save. Try again.");
              }
            });
          }}
        >
          <fieldset disabled={pending} className="space-y-4">
            <legend className="sr-only">Replacement bank details</legend>
            <Controls
              fields={[
                {
                  name: "accountName",
                  label: "Account holder",
                  required: true,
                },
                { name: "bankName", label: "Bank name", required: true },
                {
                  name: "accountNumber",
                  label: "Account number / IBAN",
                  required: true,
                },
                { name: "routingCode", label: "IFSC / routing / SWIFT code" },
                {
                  name: "reason",
                  label: "Reason for change",
                  type: "textarea",
                  required: true,
                },
              ]}
            />
            <Button variant="secondary" type="submit" disabled={pending}>
              Save bank details
            </Button>
          </fieldset>
        </form>
      </details>
      <p role="status">{message}</p>
    </section>
  );
}
