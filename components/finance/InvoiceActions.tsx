"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteInvoiceAction, markInvoicePaidAction, sendInvoiceAction, voidInvoiceAction } from "@/app/actions/finance";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/choice";
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Dropdown, Field, Input } from "@/components/ui/field";
import type { InvoiceStatusValue } from "@/lib/finance/invoice";

type Props = {
  slug: string;
  invoiceId: string;
  number: string;
  status: InvoiceStatusValue;
  clientEmail: string | null;
  canManage: boolean;
  today: string;
  incomeCategories: Array<{ id: string; name: string }>;
  listHref: string;
};

export function InvoiceActions({ slug, invoiceId, number, status, clientEmail, canManage, today, incomeCategories, listHref }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<null | "send" | "paid" | "void" | "delete">(null);
  const [email, setEmail] = useState(Boolean(clientEmail));
  const [paidOn, setPaidOn] = useState(today);
  const [categoryId, setCategoryId] = useState("");
  const base = `${listHref}/${invoiceId}`;

  const run = (work: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        showToast(result.error ?? "Couldn't save. Try again.", "error");
        return;
      }
      setDialog(null);
      showToast(success, "success");
      if (after) after();
      else router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-2.5 print:hidden">
      <Button asChild variant="secondary">
        <Link href={`${base}/print`}>Print</Link>
      </Button>
      {canManage && (status === "DRAFT" || status === "SENT") ? (
        <Button asChild variant="secondary">
          <Link href={`${base}/edit`}>Edit</Link>
        </Button>
      ) : null}
      {canManage && status === "DRAFT" ? (
        <>
          <Button variant="danger" onClick={() => setDialog("delete")}>Delete draft…</Button>
          <Button variant="primary" onClick={() => setDialog("send")}>Send…</Button>
        </>
      ) : null}
      {canManage && status === "SENT" ? (
        <>
          {clientEmail ? (
            <Button variant="secondary" loading={pending && dialog === null} onClick={() => run(() => sendInvoiceAction(slug, { invoiceId, email: true }), `Invoice emailed to ${clientEmail}.`)}>
              Email again
            </Button>
          ) : null}
          <Button variant="danger" onClick={() => setDialog("void")}>Void…</Button>
          <Button variant="primary" onClick={() => setDialog("paid")}>Mark paid…</Button>
        </>
      ) : null}
      {canManage && status === "PAID" ? <Button variant="danger" onClick={() => setDialog("void")}>Void…</Button> : null}

      <Dialog open={dialog === "send"} onOpenChange={(open) => !pending && setDialog(open ? "send" : null)}>
        <DialogContent>
          <DialogHeader title={`Send ${number}?`} description="The invoice is marked as sent. You can mark it paid once the money arrives." />
          <DialogBody>
            {clientEmail ? (
              <CheckboxField checked={email} onCheckedChange={(checked) => setEmail(checked === true)} label={`Email it to ${clientEmail}`} description="A copy with the lines and total, sent from Space Works." />
            ) : (
              <p className="text-body-ui text-ink-secondary">{"There's no client email, so it won't be emailed. Print it or send it yourself."}</p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDialog(null)} disabled={pending}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={() => run(() => sendInvoiceAction(slug, { invoiceId, email: Boolean(clientEmail) && email }), email && clientEmail ? `Invoice sent to ${clientEmail}.` : "Invoice marked as sent.")}>
              {email && clientEmail ? "Send invoice" : "Mark as sent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "paid"} onOpenChange={(open) => !pending && setDialog(open ? "paid" : null)}>
        <DialogContent>
          <DialogHeader title={`Mark ${number} paid?`} description="This records the total as money in on the ledger, once." />
          <DialogBody className="flex flex-col gap-4">
            <Field label="Paid on">
              <Input type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
            </Field>
            <Field label="Income category" optional>
              <Dropdown value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                <option value="">No category</option>
                {incomeCategories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Dropdown>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDialog(null)} disabled={pending}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={() => run(() => markInvoicePaidAction(slug, { invoiceId, paidOn, categoryId }), "Invoice paid. The money is on the ledger.")}>
              Mark paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={dialog === "void"}
        title={`Void ${number}?`}
        message={status === "PAID" ? "The invoice is cancelled and the money it added to the ledger is voided too. This can't be undone." : "The invoice is cancelled for good. Its number stays used."}
        confirmLabel="Void invoice"
        loading={pending}
        onConfirm={() => run(() => voidInvoiceAction(slug, { invoiceId }), "Invoice voided.")}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        title={`Delete draft ${number}?`}
        message="The draft is removed. Its number isn't reused."
        confirmLabel="Delete draft"
        loading={pending}
        onConfirm={() => run(() => deleteInvoiceAction(slug, { invoiceId }), "Draft deleted.", () => {
          router.push(listHref);
          router.refresh();
        })}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
