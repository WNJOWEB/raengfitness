"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { joinWaitlistAction, type WaitlistField } from "@/app/book/waitlist/actions";
import { initialFormState, type FormState } from "@/lib/booking-request";
import { buttonClasses } from "@/components/ui/ButtonLink";
import { PrivacyLine, SubmissionMeta, TextField, useSubmissionMeta } from "./ui";

/**
 * Joining a full class's waitlist (owner, 2026-11-04): the same three required
 * answers as booking (name, email, phone), then the queue place and what
 * happens next. Free; nothing is paid or booked.
 */
export function WaitlistForm({ slot, date, when }: { slot: string; date: string; when: string }) {
  const [details, setDetails] = useState({ name: "", email: "", phone: "" });
  const meta = useSubmissionMeta();
  const [state, action, pending] = useActionState(joinWaitlistAction, initialFormState as FormState<WaitlistField>);
  const statusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status !== "idle") statusRef.current?.focus();
  }, [state]);
  const set = (field: keyof typeof details) => (value: string) => setDetails((d) => ({ ...d, [field]: value }));

  if (state.status === "success") {
    const [position, , email] = state.message.split("|");
    return (
      <div ref={statusRef} tabIndex={-1} role="status" className="card p-6 focus:outline-none sm:p-8">
        <h2 className="card-title text-xl">You&apos;re on the waitlist.</h2>
        <p className="mt-2">
          You&apos;re number {position} in the queue for <span className="font-semibold">{when}</span>. We&apos;ve emailed {email} with a link to leave if you change your mind.
        </p>
        <p className="mt-3">If a place opens, we&apos;ll email you straight away. Places aren&apos;t held: they go to whoever books first, so book soon when you hear from us.</p>
        <Link href="/classes" className={buttonClasses("secondary", "mt-6 w-full px-6 sm:w-auto")}>
          See the classes
        </Link>
      </div>
    );
  }

  const errors = state.errors;
  return (
    <form action={action} noValidate className="space-y-6">
      {state.status === "error" ? (
        <div ref={statusRef} tabIndex={-1} role="alert" className="rounded-2xl border-2 border-ink bg-white p-5 font-semibold focus:outline-none">
          {state.message}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <TextField name="name" label="Name" autoComplete="name" maxLength={100} value={details.name} onChange={set("name")} error={errors.name} />
        <TextField name="email" label="Email" type="email" inputMode="email" autoComplete="email" maxLength={254} value={details.email} onChange={set("email")} error={errors.email} />
      </div>
      <TextField name="phone" label="Phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={30} value={details.phone} onChange={set("phone")} error={errors.phone} className="sm:max-w-sm" />
      <input type="hidden" name="class" value={slot} />
      <input type="hidden" name="date" value={date} />
      <SubmissionMeta meta={meta} />
      <PrivacyLine action="joining the waitlist" />
      <button type="submit" disabled={pending} className={buttonClasses("action", "w-full px-6 sm:w-auto")}>
        {pending ? "Joining…" : "Join the waitlist"}
      </button>
    </form>
  );
}
