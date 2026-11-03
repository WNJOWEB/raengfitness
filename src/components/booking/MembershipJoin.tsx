"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { submitMembershipRequest } from "@/app/memberships/join/actions";
import { BOOKING_EXPERIENCE } from "@/lib/booking-options";
import { initialFormState, type FieldErrors, type FormState } from "@/lib/booking-request";
import { emailError, messageError, nameError, phoneError } from "@/lib/form-validation";
import { formatLongDate, formatShortDate, fromDateKey, toDateKey, weekdayIndex, type DateKey } from "@/lib/availability/dates";
import { classAvailability } from "@/lib/availability/timetable";
import type { PublishedClass } from "@/lib/class-sessions";
import { useChosenPlan } from "@/lib/chosen-plan";
import { useSignedInDetails } from "@/lib/signed-in-details";
import { formatPenceShort, planFigures } from "@/lib/membership";
import type { MembershipField } from "@/lib/membership-request";
import { formatTime } from "@/lib/schedule";
import { BILLING_WEEKS, membershipPlans } from "@/content/memberships";
import { cancellationPolicy, membershipTerms } from "@/content/policy";
import { cn } from "@/lib/cn";
import { ActionBar, ChoiceGroup, DemoNotice, Disclosure, PrivacyLine, StepHeading, Stepper, SubmissionMeta, TextField, useSubmissionMeta } from "./ui";

const loadCalendar = () => import("./AvailabilityCalendar");
const AvailabilityCalendar = dynamic(() => loadCalendar().then((m) => m.AvailabilityCalendar), {
  ssr: false,
  // Holds the calendar's height, so nothing jumps when it arrives.
  loading: () => (
    <p className="min-h-[36rem] md:min-h-[29rem] text-muted" role="status">
      Loading dates…
    </p>
  ),
});

interface MembershipJoinProps {
  /**
   * "demo": previews only; nothing is sent. "request": the request reaches
   * Alex, who confirms. "pay": the member pays on Stripe's page and the
   * membership starts once Stripe confirms (owner, 2026-10-26).
   */
  mode: "demo" | "request" | "pay";
  /** Confirmed weekly classes the first class can be chosen from. */
  classes: PublishedClass[];
  /** Pay-as-you-go class price, for the saving on each plan. */
  paygGbp: number;
}

/** Each step's #hash in the address bar, so browser Back and the phone's back gesture move between steps. */
const STEP_IDS = ["plan", "first-class", "details", "check"] as const;
const STEPS = [
  { id: "plan", label: "Plan" },
  { id: "first-class", label: "First class" },
  { id: "details", label: "Details" },
  { id: "check", label: "Check" },
];
/** Which step to send the visitor back to for each answer the server questions. */
const FIELD_STEP: Record<MembershipField, number> = { plan: 0, when: 1, experience: 2, name: 2, email: 2, phone: 2, message: 2, agree: 3 };
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type Details = { experience: string; name: string; email: string; phone: string; message: string };

// Today is read on the client only, so prerendered HTML never holds a stale date.
const subscribe = () => () => {};
const getToday = () => toDateKey(new Date());
const getServerToday = () => null;

/**
 * Joining a membership (owner, 2026-10-26): its own short journey instead of
 * the booking form. Plan → first class (optional) → details → check the plan,
 * the terms and the cancellation policy, agree, then pay on Stripe's page
 * ("pay": the membership starts as soon as Stripe confirms the payment, and
 * the first class is booked then) or, where online payment isn't set up,
 * send a request that Alex confirms ("request").
 */
export function MembershipJoin({ mode, classes, paygGbp }: MembershipJoinProps) {
  const demo = mode === "demo";
  const pay = mode === "pay";
  const router = useRouter();
  const urlPlan = useChosenPlan();
  const [planChoice, setPlanChoice] = useState("");
  // The plan tapped on the plan list arrives as ?plan=; the visitor can still change it here.
  const planId = planChoice || urlPlan?.id || "";
  const plan = membershipPlans.find((p) => p.id === planId) ?? null;

  const [step, setStepState] = useState(0);
  const [moved, setMoved] = useState(false);
  const stack = useRef<number[]>([0]);
  const showStep = (next: number) => {
    setMoved(true);
    setStepState(next);
  };
  const setStep = (next: number) => {
    if (next > step) {
      stack.current.push(next);
      window.history.pushState(null, "", `#${STEP_IDS[next]}`);
      showStep(next);
      return;
    }
    const at = stack.current.lastIndexOf(next);
    if (at >= 0 && at < stack.current.length - 1) {
      window.history.go(at - (stack.current.length - 1));
      return;
    }
    stack.current[stack.current.length - 1] = next;
    window.history.replaceState(null, "", `#${STEP_IDS[next]}`);
    showStep(next);
  };
  const leave = () => {
    if (window.history.length > 1) window.history.back();
    else router.push("/memberships");
  };
  // A plan already chosen on the plan list (?plan=) skips "Choose your plan" (owner,
  // 2026-10-27): the journey opens on the first class. The plan stays changeable from
  // the step bar and the summary. Before paint, so the plan step never flashes.
  const skipped = useRef(false);
  useLayoutEffect(() => {
    if (!urlPlan || skipped.current) return;
    skipped.current = true;
    stack.current = [1];
    setStepState(1);
  }, [urlPlan]);

  // First class
  const today = useSyncExternalStore(subscribe, getToday, getServerToday);
  const [full, setFull] = useState<{ full: string[]; cancelled: string[] }>({ full: [], cancelled: [] });
  const [date, setDate] = useState<DateKey | null>(null);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [later, setLater] = useState(false);
  const avail = today && classes.length > 0 ? classAvailability(classes, today, new Set(full.full), new Set(full.cancelled)) : null;
  const chosenSlot = avail?.days.find((d) => d.date === date)?.slots.find((s) => s.id === slotId && s.available) ?? null;
  const chosenClass = date && chosenSlot ? (classes.find((c) => c.start === chosenSlot.time && c.day === WEEKDAY_NAMES[weekdayIndex(date)]) ?? null) : null;
  const firstClassText = chosenClass && date ? `${formatShortDate(date)} · ${formatTime(chosenClass.start)}` : later ? "Book later" : "";

  // Details and agreement
  const [details, setDetails] = useState<Details>({ experience: BOOKING_EXPERIENCE[0].value, name: "", email: "", phone: "", message: "" });
  const [clientErrors, setClientErrors] = useState<FieldErrors<MembershipField>>({});
  // Signed in (a past booking made the account): fill in what's still empty.
  const signedIn = useSignedInDetails((d) =>
    setDetails((prev) => ({ ...prev, name: prev.name || d.name, email: prev.email || d.email, phone: prev.phone || d.phone })),
  );

  const [agreed, setAgreed] = useState(false);
  const [demoDone, setDemoDone] = useState(false);
  const meta = useSubmissionMeta();
  const [serverState, formAction, pending] = useActionState(submitMembershipRequest, initialFormState as FormState<MembershipField>);
  const done = demo ? demoDone : serverState.status === "success";

  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  // Which class dates are full or cancelled (best effort; Alex confirms every place anyway).
  useEffect(() => {
    let live = true;
    fetch("/api/classes/full")
      .then((r) => (r.ok ? (r.json() as Promise<{ full?: unknown; cancelled?: unknown }>) : { full: [], cancelled: [] }))
      .then((body) => {
        const keys = (list: unknown) => (Array.isArray(list) ? list.filter((k): k is string => typeof k === "string") : []);
        if (live) setFull({ full: keys(body.full), cancelled: keys(body.cancelled) });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const onPop = () => {
      const id = window.location.hash.slice(1);
      const target = STEP_IDS.indexOf(id as (typeof STEP_IDS)[number]);
      if (id && target < 0) return;
      const next = target >= 0 ? target : stack.current[0];
      const at = stack.current.lastIndexOf(next);
      if (at >= 0) stack.current.length = at + 1;
      else stack.current.push(next);
      setMoved(true);
      setStepState(next);
    };
    // A reload keeps the #step but not the answers: start cleanly.
    if (STEP_IDS.includes(window.location.hash.slice(1) as (typeof STEP_IDS)[number])) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Focus follows the step change, for keyboard and screen-reader users.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step, done]);

  useEffect(() => {
    if (serverState.status === "error") summaryRef.current?.focus();
  }, [serverState]);

  const validateDetails = (): FieldErrors<MembershipField> => {
    const errors: FieldErrors<MembershipField> = {};
    if (!details.experience) errors.experience = "Choose the option that best describes you.";
    const checks = {
      name: nameError(details.name.trim()),
      email: emailError(details.email.trim().toLowerCase()),
      phone: phoneError(details.phone.trim()),
      message: messageError(details.message),
    };
    for (const [field, error] of Object.entries(checks)) if (error) errors[field as MembershipField] = error;
    return errors;
  };
  const update = (field: keyof Details) => (value: string) => {
    setDetails((d) => ({ ...d, [field]: value }));
    if (clientErrors[field as MembershipField]) setClientErrors((e) => ({ ...e, [field]: undefined }));
  };

  if (done && plan) {
    return (
      <Outcome
        demo={demo}
        headingRef={headingRef}
        plan={`${plan.name} membership`}
        firstClass={chosenClass && date ? `${formatLongDate(date)} ${fromDateKey(date).getFullYear()}, ${formatTime(chosenClass.start)}` : "You'll book it later"}
        email={demo ? details.email.trim() : serverState.message}
      />
    );
  }

  const errors: FieldErrors<MembershipField> = { ...serverState.errors, ...clientErrors };
  const serverErrors = Object.entries(serverState.errors).filter((e): e is [MembershipField, string] => Boolean(e[1]));
  const rows = [
    { label: "Plan", value: plan ? `${plan.name} · £${plan.priceGbp} / ${BILLING_WEEKS} weeks` : "", step: 0 },
    { label: "First class", value: firstClassText, step: 1 },
    { label: "Your details", value: step > 2 ? details.name.trim() : "", step: 2 },
  ];

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-14">
      <div className="min-w-0 lg:col-span-8">
        <Stepper steps={STEPS} current={step} onSelect={setStep} label="Membership steps" />

        <div key={step} className={moved ? "mt-8 animate-step-in" : "mt-8"}>
          {step === 0 ? (
            <section aria-labelledby="step-heading">
              <StepHeading ref={headingRef} intro="Every plan renews every 4 weeks with new class credits. One credit is one class.">
                <span id="step-heading">Choose your plan</span>
              </StepHeading>
              <div className="mt-6">
                <ChoiceGroup
                  type="radio"
                  name="plan-choice"
                  legend="Membership plan"
                  hideLegend
                  options={membershipPlans.map((p) => {
                    const f = planFigures(p, paygGbp);
                    return {
                      value: p.id,
                      label: `${p.name} · £${p.priceGbp} / ${BILLING_WEEKS} weeks`,
                      detail: `${p.credits} class credits · ${formatPenceShort(f.perClassPence)} per class · Save ${formatPenceShort(f.savingPence)}`,
                    };
                  })}
                  value={planId}
                  onChange={(v) => {
                    void loadCalendar();
                    setPlanChoice(v);
                  }}
                />
              </div>
              <ActionBar
                onBack={leave}
                next={{ label: "Continue", disabled: !plan, onClick: () => setStep(1) }}
                hint={plan ? undefined : "Choose a plan to continue."}
              />
            </section>
          ) : null}

          {step === 1 ? (
            <section aria-labelledby="step-heading">
              <StepHeading ref={headingRef} intro={
                  pay
                    ? "Pick the class you'd like to start with, or book it later. It's booked as soon as you've paid, if there's still a space."
                    : "Pick the class you'd like to start with, or book it later. Alex confirms every place."
                }>
                <span id="step-heading">Your first class</span>
              </StepHeading>
              <div className="mt-6">
                {avail ? (
                  <AvailabilityCalendar
                    window={avail}
                    date={date}
                    slotId={slotId}
                    noun="class"
                    onDate={(d) => {
                      setDate(d);
                      setSlotId(null);
                      setLater(false);
                      if (matchMedia("(max-width: 47.99rem)").matches) {
                        document.getElementById("times")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
                      }
                    }}
                    onSlot={(id) => {
                      setSlotId(id);
                      setLater(false);
                    }}
                  />
                ) : (
                  <p className="min-h-[36rem] md:min-h-[29rem] text-muted" role="status">
                    Loading class dates…
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setDate(null);
                  setSlotId(null);
                  setLater(true);
                  setStep(2);
                }}
                className="mt-6 inline-flex min-h-11 items-center text-base font-semibold underline underline-offset-4 hover:no-underline"
              >
                Skip: I&apos;ll book my first class later
              </button>
              <ActionBar
                onBack={() => setStep(0)}
                next={{ label: "Continue", disabled: !chosenClass, onClick: () => setStep(2) }}
                hint={chosenClass ? undefined : date ? "Choose a time, or skip for now." : "Choose a date, or skip for now."}
              />
            </section>
          ) : null}

          {step === 2 ? (
            <section aria-labelledby="step-heading">
              <StepHeading ref={headingRef} intro={pay ? "For your membership and receipt. Your browser can fill these in." : "So Alex can reply to confirm your membership. Your browser can fill these in."}>
                <span id="step-heading">Your details</span>
              </StepHeading>
              <div className="mt-6 space-y-8">
                <ChoiceGroup
                  type="radio"
                  name="experience"
                  legend="Your kettlebell experience"
                  options={BOOKING_EXPERIENCE}
                  value={details.experience}
                  onChange={(v) => update("experience")(v)}
                  error={errors.experience}
                />
                {signedIn ? (
                  <p className="text-sm">Filled in from your account.</p>
                ) : null}
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <TextField name="name" label="Name" autoComplete="name" maxLength={100} value={details.name} onChange={update("name")} error={errors.name} />
                  <TextField name="email" label="Email" type="email" inputMode="email" autoComplete="email" maxLength={254} value={details.email} onChange={update("email")} error={errors.email} />
                </div>
                <TextField name="phone" label="Phone" type="tel" inputMode="tel" autoComplete="tel" optional maxLength={30} value={details.phone} onChange={update("phone")} error={errors.phone} className="sm:max-w-sm" />
                <Disclosure label="Add a note for Alex" initiallyOpen={Boolean(details.message || errors.message)}>
                  <TextField
                    name="message"
                    label="Note"
                    optional
                    multiline
                    maxLength={1000}
                    hint="Questions or anything Alex should know. Please don't include medical details."
                    value={details.message}
                    onChange={update("message")}
                    error={errors.message}
                  />
                </Disclosure>
              </div>
              <ActionBar
                onBack={() => setStep(1)}
                next={{
                  label: "Continue",
                  onClick: () => {
                    const found = validateDetails();
                    setClientErrors(found);
                    if (Object.keys(found).length > 0) {
                      requestAnimationFrame(() => document.getElementById(Object.keys(found)[0])?.focus());
                      return;
                    }
                    setStep(3);
                  },
                }}
              />
            </section>
          ) : null}

          {step === 3 && plan ? (
            <section aria-labelledby="step-heading">
              <StepHeading
                ref={headingRef}
                intro={pay ? `Read how your membership works, then pay for your first ${BILLING_WEEKS} weeks.` : "Read how your membership works, then send your request. Nothing to pay now."}
              >
                <span id="step-heading">{pay ? "Check and pay" : "Check and send"}</span>
              </StepHeading>
              <form
                action={formAction}
                noValidate
                onSubmit={(e) => {
                  if (!agreed) {
                    e.preventDefault();
                    setClientErrors((x) => ({ ...x, agree: "Please confirm you've read and agree to the membership terms and cancellation policy." }));
                    requestAnimationFrame(() => document.getElementById("agree")?.focus());
                    return;
                  }
                  if (demo) {
                    e.preventDefault();
                    setDemoDone(true);
                  }
                }}
                className="mt-6 space-y-6"
              >
                {demo ? <DemoNotice>Demonstration: this request isn&apos;t sent anywhere.</DemoNotice> : null}
                {serverState.status === "error" ? (
                  <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-2xl border-2 border-ink bg-white p-5 focus:outline-none">
                    <p className="font-bold">{serverState.message}</p>
                    {serverErrors.length > 0 ? (
                      <ul className="mt-3 space-y-1">
                        {serverErrors.map(([field, text]) => (
                          <li key={field}>
                            <button type="button" onClick={() => setStep(FIELD_STEP[field])} className="text-left underline underline-offset-4">
                              {text}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}

                <dl className="card divide-y divide-line px-5 sm:px-6">
                  {rows.map((row) => (
                    <div key={row.label} className="py-3">
                      <dt className="text-sm">{row.label}</dt>
                      <dd className="flex items-center justify-between gap-4">
                        <span className="min-w-0 font-semibold">{row.label === "Your details" ? `${details.name.trim()} · ${details.email.trim()}` : row.value}</span>
                        <button type="button" onClick={() => setStep(row.step)} className="-my-2 inline-flex min-h-11 shrink-0 items-center text-sm font-semibold underline underline-offset-4 hover:no-underline">
                          Change<span className="sr-only"> {row.label.toLowerCase()}</span>
                        </button>
                      </dd>
                    </div>
                  ))}
                </dl>

                <div className="card px-5 py-5 sm:px-6">
                  <h3 className="card-title">How your membership works</h3>
                  <ul className="mt-3 space-y-2">
                    {membershipTerms.map((t) => (
                      <li key={t} className="flex gap-2">
                        <span aria-hidden="true">·</span>
                        {t}
                      </li>
                    ))}
                  </ul>
                  <h3 className="card-title mt-6">Cancelling a class</h3>
                  <ul className="mt-3 space-y-2">
                    {cancellationPolicy.cancellations.map((c) => (
                      <li key={c.when} className="flex gap-2">
                        <span aria-hidden="true">·</span>
                        <span>
                          <span className="font-semibold">{c.when}:</span> {c.outcome}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Link href="/memberships#cancellation" target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4 hover:no-underline">
                    Read the full policy<span className="sr-only"> (opens in a new tab)</span>
                  </Link>
                </div>

                <div className="card px-5 py-5 sm:px-6">
                  {pay ? (
                    <>
                      <h3 className="card-title">Pay securely with Stripe</h3>
                      <p className="mt-1.5">
                        Next, Stripe&apos;s secure page takes £{plan.priceGbp} for your first {BILLING_WEEKS} weeks. Your membership starts as soon as
                        it&apos;s paid{chosenClass ? " and your first class is booked" : ""}. After that, your membership renews automatically every{" "}
                        {BILLING_WEEKS} weeks until you cancel.
                      </p>
                    </>
                  ) : (
                    <>
                      <h3 className="card-title">Nothing to pay now</h3>
                      <p className="mt-1.5">
                        Alex confirms your membership by email, sets it up and tells you how to pay for your first {BILLING_WEEKS} weeks
                        (£{plan.priceGbp}).
                      </p>
                    </>
                  )}
                </div>

                <div>
                  <label className={cn("card flex cursor-pointer items-start gap-4 px-5 py-4 sm:px-6", errors.agree && "outline-2 outline-ink")}>
                    <input
                      id="agree"
                      type="checkbox"
                      name="agree"
                      value="yes"
                      checked={agreed}
                      onChange={(e) => {
                        setAgreed(e.target.checked);
                        if (e.target.checked) setClientErrors((x) => ({ ...x, agree: undefined }));
                      }}
                      aria-invalid={errors.agree ? true : undefined}
                      aria-describedby={errors.agree ? "agree-error" : undefined}
                      className="mt-0.5 size-6 shrink-0 accent-ink"
                    />
                    <span>I&apos;ve read and agree to the membership terms and the class cancellation policy, and understand my membership renews every {BILLING_WEEKS} weeks.</span>
                  </label>
                  {errors.agree ? (
                    <p id="agree-error" className="mt-2 text-sm font-semibold">
                      <span aria-hidden="true">✕ </span>
                      {errors.agree}
                    </p>
                  ) : null}
                </div>

                {/* Every answer travels with the form; the server checks them all again. */}
                <input type="hidden" name="plan" value={plan.id} />
                {chosenClass && date ? (
                  <>
                    <input type="hidden" name="session" value={chosenClass.label} />
                    <input type="hidden" name="classDate" value={date} />
                  </>
                ) : null}
                <input type="hidden" name="experience" value={details.experience} />
                <input type="hidden" name="name" value={details.name} />
                <input type="hidden" name="email" value={details.email} />
                <input type="hidden" name="phone" value={details.phone} />
                <input type="hidden" name="message" value={details.message} />
                <SubmissionMeta meta={meta} />

                {pay && !demo ? (
                  <p className="flex items-baseline justify-between gap-4 text-base font-semibold">
                    <span>Total today</span>
                    <span>£{plan.priceGbp}</span>
                  </p>
                ) : null}
                <PrivacyLine action={demo ? "continuing" : pay ? "paying" : "sending this request"} />
                <ActionBar
                  onBack={() => setStep(2)}
                  next={{ label: demo ? "Finish demo" : pay ? (pending ? "Opening Stripe…" : "Continue to payment") : "Send request", type: "submit", pending }}
                />
              </form>
            </section>
          ) : null}
        </div>
      </div>

      {/* A plain block, not an <aside>: it repeats what's on the page, and a landmark mustn't sit inside the page's section. */}
      <div className="hidden lg:col-span-4 lg:block">
        <div className="sticky top-28 card overflow-hidden">
          <p className="px-5 pt-5 pb-2 font-semibold">Your membership</p>
          <dl className="divide-y divide-line">
            {rows.slice(0, 2).map((row) => (
              <div key={row.label} className="min-h-14 px-5 py-3">
                <dt className="text-xs">{row.label}</dt>
                <dd className={cn("font-semibold", !row.value && "font-normal")}>{row.value || "Not chosen yet"}</dd>
              </div>
            ))}
          </dl>
          <p className="border-t border-line px-5 py-4 text-sm">
            {pay ? "Pay on Stripe's secure page. Your membership starts as soon as it's paid." : "Nothing to pay now. Alex confirms every membership personally."}
          </p>
        </div>
      </div>
    </div>
  );
}

function Outcome({ demo, headingRef, plan, firstClass, email }: { demo: boolean; headingRef: React.Ref<HTMLHeadingElement>; plan: string; firstClass: string; email: string }) {
  return (
    <div className="animate-step-in" role="status">
      <div className="rounded-3xl bg-ink p-8 text-paper sm:p-12">
        <p className="eyebrow text-white">{demo ? "Demonstration complete" : "Request sent"}</p>
        <h2 ref={headingRef} tabIndex={-1} className="mt-4 font-display text-h2 text-balance focus:outline-none">
          {demo ? "Nothing has been sent." : "Thanks. Alex will reply to confirm."}
        </h2>
        <p className="mt-5 max-w-xl text-lede text-white">
          {demo
            ? "This was a preview, so no request was sent."
            : `Your membership request is with Alex. He'll reply to ${email} to confirm it, set it up and tell you how to pay. Nothing to pay now.`}
        </p>
        <dl className="mt-8 grid max-w-xl grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <div>
            <dt className="eyebrow text-white">Plan</dt>
            <dd className="mt-1 font-semibold">{plan}</dd>
          </div>
          <div>
            <dt className="eyebrow text-white">First class</dt>
            <dd className="mt-1 font-semibold">{firstClass}</dd>
          </div>
        </dl>
      </div>
      <Link href="/" className="mt-6 inline-flex min-h-11 items-center text-sm font-semibold underline-offset-4 hover:underline">
        Back to the homepage
      </Link>
    </div>
  );
}
