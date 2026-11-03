"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { submitOnlineEnquiry } from "@/app/online-coaching/actions";
import {
  CONTACT_METHODS,
  ONLINE_EXPERIENCE,
  ONLINE_GOALS,
  TRAINING_PLACES,
  labelFor,
} from "@/lib/booking-options";
import { initialFormState, type FieldErrors, type FormState } from "@/lib/booking-request";
import type { OnlineField } from "@/lib/online-enquiry";
import { LIMITS, emailError, instagramError, messageError, nameError, phoneError } from "@/lib/form-validation";
import {
  ActionBar,
  ChoiceGroup,
  DemoNotice,
  Disclosure,
  ErrorSummary,
  PrivacyLine,
  StepHeading,
  Stepper,
  TextField,
  SubmissionMeta,
  useSubmissionMeta,
} from "./ui";

interface Answers {
  goal: string;
  goalOther: string;
  experience: string;
  trainingPlace: string;
  contactMethod: string;
  name: string;
  email: string;
  phone: string;
  instagram: string;
  message: string;
}

const STEPS = [
  { id: "goal", label: "Goal" },
  { id: "training", label: "Training" },
  { id: "contact", label: "Contact" },
  { id: "review", label: "Review" },
];

/** Which step each answer lives on, so errors and edits go to the right place. */
const STEP_OF: Record<OnlineField, number> = {
  goal: 0,
  goalOther: 0,
  experience: 1,
  trainingPlace: 1,
  contactMethod: 2,
  name: 2,
  email: 2,
  phone: 2,
  instagram: 2,
  message: 2,
};

/**
 * Online coaching is a conversation, not a calendar booking: a few short
 * questions, a review, then Alex replies personally.
 */
export function OnlineOnboarding({ mode }: { mode: "send" | "demo" }) {
  const demo = mode === "demo";
  const [step, setStepState] = useState(0);
  // The first step appears without the fade; later steps fade in so the change is noticed.
  const [moved, setMoved] = useState(false);
  const setStep = (next: number) => {
    setMoved(true);
    setStepState(next);
  };
  const [a, setA] = useState<Answers>({
    goal: "",
    goalOther: "",
    experience: "",
    trainingPlace: "",
    contactMethod: "email",
    name: "",
    email: "",
    phone: "",
    instagram: "",
    message: "",
  });
  const [clientErrors, setClientErrors] = useState<FieldErrors<OnlineField>>({});
  const [demoDone, setDemoDone] = useState(false);
  const meta = useSubmissionMeta();
  const [serverState, formAction, pending] = useActionState(submitOnlineEnquiry, initialFormState as FormState<OnlineField>);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  const done = demo ? demoDone : serverState.status === "success";

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

  const set = (field: keyof Answers) => (value: string) => {
    setA((prev) => ({ ...prev, [field]: value }));
    if (clientErrors[field]) setClientErrors((e) => ({ ...e, [field]: undefined }));
  };

  const contactErrors = (): FieldErrors<OnlineField> => {
    const found: FieldErrors<OnlineField> = {
      name: nameError(a.name.trim()),
      email: emailError(a.email.trim().toLowerCase()),
      phone: phoneError(a.phone.trim(), a.contactMethod === "phone"),
      instagram: a.contactMethod === "instagram" ? instagramError(a.instagram.trim()) : undefined,
      message: messageError(a.message),
    };
    return Object.fromEntries(Object.entries(found).filter(([, v]) => v)) as FieldErrors<OnlineField>;
  };

  const goalComplete = a.goal !== "" && (a.goal !== "other" || a.goalOther.trim() !== "");
  const errors = { ...serverState.errors, ...clientErrors };

  if (done) {
    return (
      <div className="animate-step-in" role="status">
        <div className="bg-ink p-8 text-paper sm:p-12">
          <p className="eyebrow text-white">{demo ? "Demonstration complete" : "Enquiry sent"}</p>
          <h2 ref={headingRef} tabIndex={-1} className="mt-4 font-display text-h2 text-balance focus:outline-none">
            {demo ? "Nothing was sent" : "Thanks — Alex will reply personally"}
          </h2>
          <p className="mt-5 max-w-xl text-lede text-white">
            {demo
              ? "This was a demonstration, so your answers weren't sent. Once sending is switched on, they go straight to Alex."
              : `Alex will read your answers and get back to you${
                  a.contactMethod === "phone" ? " by phone" : a.contactMethod === "instagram" ? " on Instagram" : ""
                }${a.contactMethod === "email" ? ` at ${serverState.message}` : ""} to talk through your training.`}
          </p>
          {!demo && serverState.reference ? (
            <p className="mt-5 max-w-xl text-white">
              Your reference: <span className="font-semibold">{serverState.reference}</span>. We&apos;ve emailed you a copy.
            </p>
          ) : null}
        </div>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center text-sm font-semibold underline-offset-4 hover:underline"
        >
          Back to the homepage
        </Link>
      </div>
    );
  }

  const goalText = a.goal === "other" ? a.goalOther.trim() : labelFor(ONLINE_GOALS, a.goal);
  const contactText =
    a.contactMethod === "phone"
      ? `Phone: ${a.phone.trim()}`
      : a.contactMethod === "instagram"
        ? `Instagram: ${a.instagram.trim().replace(/^@?/, "@")}`
        : `Email`;

  return (
    <div>
      <Stepper steps={STEPS} current={step} onSelect={setStep} label="Online coaching steps" />
      <div key={step} className={moved ? "mt-8 animate-step-in" : "mt-8"}>
        {step === 0 ? (
          <section aria-labelledby="step-heading">
            <StepHeading ref={headingRef}>
              <span id="step-heading">What&apos;s your main goal?</span>
            </StepHeading>
            <div className="mt-6 space-y-6">
              <ChoiceGroup type="radio" name="goal" legend="Main goal" hideLegend options={ONLINE_GOALS} value={a.goal} onChange={set("goal")} />
              {a.goal === "other" ? (
                <div className="animate-step-in">
                  <TextField
                    name="goalOther"
                    label="Tell Alex what you'd like to achieve"
                    maxLength={LIMITS.short}
                    value={a.goalOther}
                    onChange={set("goalOther")}
                    error={errors.goalOther}
                  />
                </div>
              ) : null}
            </div>
            <ActionBar
              next={{ label: "Continue", disabled: !goalComplete, onClick: () => setStep(1) }}
              hint={goalComplete ? undefined : a.goal === "other" ? "Describe your goal to continue." : "Choose a goal to continue."}
            />
          </section>
        ) : null}

        {step === 1 ? (
          <section aria-labelledby="step-heading">
            <StepHeading ref={headingRef}>
              <span id="step-heading">Your training</span>
            </StepHeading>
            <div className="mt-6 space-y-8">
              <ChoiceGroup
                type="radio"
                name="experience"
                legend="Your kettlebell experience"
                options={ONLINE_EXPERIENCE}
                value={a.experience}
                onChange={set("experience")}
              />
              <ChoiceGroup
                type="radio"
                name="trainingPlace"
                legend="Where will you train?"
                optional
                layout="chips"
                options={TRAINING_PLACES}
                value={a.trainingPlace}
                onChange={set("trainingPlace")}
              />
            </div>
            <ActionBar
              onBack={() => setStep(0)}
              next={{ label: "Continue", disabled: !a.experience, onClick: () => setStep(2) }}
              hint={a.experience ? undefined : "Choose your experience to continue."}
            />
          </section>
        ) : null}

        {step === 2 ? (
          <section aria-labelledby="step-heading">
            <StepHeading ref={headingRef} intro="So Alex can reply. Your browser can fill these in.">
              <span id="step-heading">How can Alex reach you?</span>
            </StepHeading>
            <div className="mt-6 space-y-8">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <TextField name="name" label="Name" autoComplete="name" maxLength={100} value={a.name} onChange={set("name")} error={errors.name} />
                <TextField
                  name="email"
                  label="Email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  maxLength={254}
                  value={a.email}
                  onChange={set("email")}
                  error={errors.email}
                />
              </div>
              <ChoiceGroup
                type="radio"
                name="contactMethod"
                legend="Preferred way to talk"
                layout="chips"
                options={CONTACT_METHODS}
                value={a.contactMethod}
                onChange={set("contactMethod")}
              />
              {a.contactMethod === "phone" ? (
                <div className="animate-step-in">
                  <TextField
                    name="phone"
                    label="Phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={30}
                    value={a.phone}
                    onChange={set("phone")}
                    error={errors.phone}
                    className="sm:max-w-sm"
                  />
                </div>
              ) : null}
              {a.contactMethod === "instagram" ? (
                <div className="animate-step-in">
                  <TextField
                    name="instagram"
                    label="Instagram username"
                    maxLength={31}
                    placeholder="@yourname"
                    value={a.instagram}
                    onChange={set("instagram")}
                    error={errors.instagram}
                    className="sm:max-w-sm"
                  />
                </div>
              ) : null}
              <Disclosure label="Add a note for Alex" initiallyOpen={Boolean(a.message || errors.message)}>
                <TextField
                  name="message"
                  label="Note"
                  optional
                  multiline
                  maxLength={1000}
                  hint="Anything else Alex should know. Please don't include medical details."
                  value={a.message}
                  onChange={set("message")}
                  error={errors.message}
                />
              </Disclosure>
            </div>
            <ActionBar
              onBack={() => setStep(1)}
              next={{
                label: "Review",
                onClick: () => {
                  const found = contactErrors();
                  setClientErrors(found);
                  const first = Object.keys(found)[0];
                  if (first) document.getElementById(first)?.focus();
                  else setStep(3);
                },
              }}
            />
          </section>
        ) : null}

        {step === 3 ? (
          <section aria-labelledby="step-heading">
            <StepHeading ref={headingRef} intro="Check your answers, then send them to Alex. He reviews every enquiry and replies personally.">
              <span id="step-heading">Review and send</span>
            </StepHeading>
            <form
              action={formAction}
              noValidate
              onSubmit={(e) => {
                if (demo) {
                  e.preventDefault();
                  setDemoDone(true);
                }
              }}
              className="mt-6 space-y-6"
            >
              {demo ? <DemoNotice>Demonstration: sending isn&apos;t switched on, so nothing will be sent.</DemoNotice> : null}
              {serverState.status === "error" ? (
                <ErrorSummary focusRef={summaryRef} message={serverState.message} errors={[]} />
              ) : null}
              <dl className="card divide-y divide-line px-5">
                {[
                  { label: "Main goal", value: goalText, step: 0, field: "goal" as const },
                  {
                    label: "Training",
                    value: [labelFor(ONLINE_EXPERIENCE, a.experience), a.trainingPlace ? labelFor(TRAINING_PLACES, a.trainingPlace) : ""]
                      .filter(Boolean)
                      .join(" · "),
                    step: 1,
                    field: "experience" as const,
                  },
                  { label: "Contact", value: `${a.name.trim()} · ${a.email.trim()} · ${contactText}`, step: 2, field: "name" as const },
                  ...(a.message.trim() ? [{ label: "Note", value: a.message.trim(), step: 2, field: "message" as const }] : []),
                ].map((row) => (
                  <div key={row.label} className="py-4">
                    <dt className="text-xs text-muted">{row.label}</dt>
                    <dd className="mt-0.5 flex items-start justify-between gap-4">
                      <span className="min-w-0">
                        <span className="block font-semibold break-words">{row.value}</span>
                        {Object.entries(serverState.errors)
                          .filter(([f, msg]) => msg && STEP_OF[f as OnlineField] === row.step)
                          .map(([f, msg]) => (
                            <span key={f} className="mt-1 block text-sm font-semibold">
                              <span aria-hidden="true">✕ </span>
                              {msg}
                            </span>
                          ))}
                      </span>
                      <button
                        type="button"
                        onClick={() => setStep(row.step)}
                        className="-mt-3 inline-flex min-h-11 shrink-0 items-center text-sm font-semibold underline underline-offset-4 hover:no-underline"
                      >
                        Edit<span className="sr-only"> {row.label.toLowerCase()}</span>
                      </button>
                    </dd>
                  </div>
                ))}
              </dl>

              {(Object.keys(a) as (keyof Answers)[]).map((field) => (
                <input key={field} type="hidden" name={field} value={a[field]} />
              ))}
              <SubmissionMeta meta={meta} />
              <PrivacyLine action={demo ? "continuing" : "sending your answers"} />
              <ActionBar
                onBack={() => setStep(2)}
                next={{ label: demo ? "Finish demo" : "Send to Alex", type: "submit", pending }}
              />
            </form>
          </section>
        ) : null}
      </div>
    </div>
  );
}
