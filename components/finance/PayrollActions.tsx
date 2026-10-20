"use client";
import { useEffect, useState, useTransition } from "react";
import {
  generatePayslipAction,
  revealPayDetailsAction,
} from "@/app/actions/finance-tools";
import { Button, buttonClasses } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";

export function PayslipButton({
  slug,
  runId,
}: {
  slug: string;
  runId: string;
}) {
  const [pending, start] = useTransition(),
    [error, setError] = useState(""),
    [fileId, setFileId] = useState("");
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="secondary"
        loading={pending}
        onClick={() =>
          start(async () => {
            setError("");
            try {
              const r = await generatePayslipAction(slug, runId);
              if (!r.ok) {
                setError(r.error);
                return;
              }
              setFileId(r.data.id);
            } catch {
              setError("Couldn't generate the payslip. Try again.");
            }
          })
        }
      >
        Generate payslip PDF
      </Button>
      {fileId ? (
        <a
          href={`/api/files/${fileId}`}
          target="_blank"
          rel="noreferrer"
          className={buttonClasses({ variant: "quiet" })}
        >
          Open private payslip PDF
        </a>
      ) : null}
      {error ? (
        <Callout tone="danger" role="alert">
          {error}
        </Callout>
      ) : null}
    </div>
  );
}
export function PayDetails({
  slug,
  profileId,
}: {
  slug: string;
  profileId: string;
}) {
  const [details, setDetails] = useState<{
      pan: string;
      bank: { last4: string; ifsc: string } | null;
    } | null>(null),
    [pending, start] = useTransition(),
    [error, setError] = useState("");
  useEffect(() => {
    if (!details) return;
    const timer = setTimeout(() => setDetails(null), 30000);
    const hide = () => {
      if (document.hidden) setDetails(null);
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [details]);
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="quiet"
        loading={pending}
        onClick={() => {
          if (details) {
            setDetails(null);
            return;
          }
          start(async () => {
            setError("");
            try {
              const r = await revealPayDetailsAction(slug, profileId);
              if (!r.ok) {
                setError(r.error);
                return;
              }
              setDetails(r.data);
            } catch {
              setError("Couldn't open the pay details. Try again.");
            }
          });
        }}
      >
        {details ? "Hide private details" : "View PAN and bank reference"}
      </Button>
      {details ? (
        <div role="status" className="rounded-lg border border-line p-3">
          <p>PAN: {details.pan || "Not recorded"}</p>
          <p>Account ending: {details.bank?.last4 || "Not recorded"}</p>
          <p>IFSC: {details.bank?.ifsc || "Not recorded"}</p>
          <p className="text-caption text-ink-muted">
            This view was audited. Details hide after 30 seconds.
          </p>
        </div>
      ) : null}
      {error ? (
        <Callout tone="danger" role="alert">
          {error}
        </Callout>
      ) : null}
    </div>
  );
}
