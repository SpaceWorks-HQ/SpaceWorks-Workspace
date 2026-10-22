"use client";

import { useState, type ReactNode } from "react";

function data(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form));
}
export function Form({
  children,
  onSave,
}: {
  children: ReactNode;
  onSave: (
    values: Record<string, FormDataEntryValue>,
    form: HTMLFormElement,
  ) => Promise<unknown>;
}) {
  const [formError, setFormError] = useState("");
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        setFormError("");
        void onSave(data(form), form).catch(() =>
          setFormError("Couldn't complete the action. Try again."),
        );
      }}
    >
      {children}
      {formError ? (
        <p role="alert" className="text-danger-fg">
          {formError}
        </p>
      ) : null}
    </form>
  );
}
