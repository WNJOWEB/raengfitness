"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { confirmEmailChangeCode, requestEmailChange, type EmailChangeField } from "../settings-actions";
import { initialFormState, type FormState } from "@/lib/booking-request";

/**
 * Changing the account's email (owner, 2026-11-03): the new address, then the
 * 6-digit code sent to it. Until the code is typed nothing changes.
 */
export function EmailChangeForm({ current }: { current: string }) {
  const [email, setEmail] = useState("");
  const [state, action, pending] = useActionState(requestEmailChange, initialFormState as FormState<EmailChangeField>);
  const statusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === "success") statusRef.current?.focus();
  }, [state]);

  if (state.status === "success") {
    return (
      <div ref={statusRef} tabIndex={-1} role="status" className="flex flex-col gap-3 focus:outline-none">
        <p>
          We&apos;ve sent a code to <span className="font-semibold [overflow-wrap:anywhere]">{state.message}</span>. Type it here to make it your
          email. It works once, for 15 minutes.
        </p>
        <CodeStep />
      </div>
    );
  }
  return (
    <form action={action} noValidate className="flex flex-col gap-3">
      <p className="text-sm">You sign in with {current || "your email"}. To use a different one, we&apos;ll send a code to the new address first.</p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-email" className="font-semibold">
          New email
        </label>
        <input
          id="new-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={state.errors.email ? true : undefined}
          aria-describedby={state.errors.email ? "new-email-error" : undefined}
          className="members-input"
        />
        {state.status === "error" ? (
          <p id="new-email-error" role="alert" className="text-sm font-semibold">
            {state.errors.email ?? state.message}
          </p>
        ) : null}
      </div>
      <button type="submit" disabled={pending} className="members-btn w-full sm:w-auto">
        {pending ? "Sending…" : "Send me a code"}
      </button>
    </form>
  );
}

function CodeStep() {
  const [code, setCode] = useState("");
  const [state, action, pending] = useActionState(confirmEmailChangeCode, initialFormState as FormState<EmailChangeField>);
  return (
    <form action={action} noValidate className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email-code" className="font-semibold">
          Code
        </label>
        <input
          id="email-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-invalid={state.status === "error" ? true : undefined}
          aria-describedby={state.status === "error" ? "email-code-error" : undefined}
          className="members-input sm:max-w-xs"
        />
        {state.status === "error" ? (
          <p id="email-code-error" role="alert" className="text-sm font-semibold">
            {state.errors.code ?? state.message}
          </p>
        ) : null}
      </div>
      <button type="submit" disabled={pending} className="members-btn members-btn-solid w-full sm:w-auto">
        {pending ? "Changing…" : "Change my email"}
      </button>
    </form>
  );
}
