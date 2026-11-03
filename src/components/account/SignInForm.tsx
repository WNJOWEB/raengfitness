"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { confirmSignInCode, requestSignInLink, type SignInField } from "@/app/account/actions";
import { initialFormState, type FormState } from "@/lib/booking-request";
import { buttonClasses } from "@/components/ui/ButtonLink";
import { SubmissionMeta, TextField, useSubmissionMeta } from "@/components/booking/ui";

/**
 * Email in, "check your email" out, then the code from that email typed here
 * (owner, 2026-11-03: iPhone mail apps open the link in their own browser, so
 * the code signs in the browser the member is actually using). The same answer
 * for every address, so the form never says who has an account.
 */
export function SignInForm() {
  const [email, setEmail] = useState("");
  const meta = useSubmissionMeta();
  const [state, action, pending] = useActionState(requestSignInLink, initialFormState as FormState<SignInField>);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status !== "idle") statusRef.current?.focus();
  }, [state]);

  if (state.status === "success") {
    return (
      <div ref={statusRef} tabIndex={-1} role="status" className="card p-6 focus:outline-none sm:p-8">
        <h2 className="card-title text-xl">Check your email</h2>
        <p className="mt-2">
          If <span className="font-semibold">{state.message}</span> has an account, a sign-in code is on its way. Type it below, or tap the
          link in the email. Both work once, for 15 minutes.
        </p>
        <CodeForm email={state.message} />
        <p className="mt-6 text-sm">Nothing arrived after a few minutes? Check your junk folder, then try again.</p>
      </div>
    );
  }

  return (
    <form action={action} noValidate className="space-y-6">
      {state.status === "error" ? (
        <div ref={statusRef} tabIndex={-1} role="alert" className="rounded-2xl border-2 border-ink bg-white p-5 font-semibold focus:outline-none">
          {state.message}
        </div>
      ) : null}
      <TextField
        name="email"
        label="Your email"
        type="email"
        inputMode="email"
        autoComplete="email"
        maxLength={254}
        hint="The one you booked or joined with."
        value={email}
        onChange={setEmail}
        error={state.errors.email}
      />
      <SubmissionMeta meta={meta} />
      <button type="submit" disabled={pending} className={buttonClasses("action", "w-full px-6 sm:w-auto")}>
        {pending ? "Sending…" : "Email me a sign-in code"}
      </button>
    </form>
  );
}

/** The 6 digits from the email. iPhone offers the code above the keyboard (one-time-code). */
function CodeForm({ email }: { email: string }) {
  const [code, setCode] = useState("");
  const [state, action, pending] = useActionState(confirmSignInCode, initialFormState as FormState<SignInField>);
  return (
    <form action={action} noValidate className="mt-6 space-y-4">
      <input type="hidden" name="email" value={email} />
      <TextField
        name="code"
        label="Sign-in code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        hint="6 digits"
        value={code}
        onChange={setCode}
        error={state.status === "error" ? (state.errors.code ?? state.message) : undefined}
        className="sm:max-w-xs"
      />
      <button type="submit" disabled={pending} className={buttonClasses("action", "w-full px-6 sm:w-auto")}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
