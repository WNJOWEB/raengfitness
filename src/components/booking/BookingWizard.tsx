"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { submitBookingRequest } from "@/app/book/actions";
import {
  BOOKABLE_SERVICES,
  BOOKING_EXPERIENCE,
  PREFERRED_DAYS,
  PREFERRED_TIMES,
  labelFor,
  type BookableService,
} from "@/lib/booking-options";
import { describePreferences, initialFormState, type BookingField, type FieldErrors, type FormState } from "@/lib/booking-request";
import { emailError, messageError, nameError, phoneError } from "@/lib/form-validation";
import { formatLongDate, formatShortDate, fromDateKey, toDateKey, weekdayIndex, type DateKey } from "@/lib/availability/dates";
import { classAvailability } from "@/lib/availability/timetable";
import type { AvailabilityWindow } from "@/lib/availability/types";
import type { PublishedClass } from "@/lib/class-sessions";
import { addMinutes, formatTime } from "@/lib/schedule";
import { membershipPlans } from "@/content/memberships";
import { classWaiver } from "@/content/policy";
import { formatPenceShort } from "@/lib/membership";
import { cn } from "@/lib/cn";
import { useChosenPlan, useQueryParam } from "@/lib/chosen-plan";
import { useSignedInDetails } from "@/lib/signed-in-details";
import {
  ActionBar,
  ChoiceGroup,
  DemoLabel,
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

/** Lazy: the calendar only loads when a date step needs it; choosing a service starts the download. */
const loadCalendar = () => import("./AvailabilityCalendar");
const AvailabilityCalendar = dynamic(() => loadCalendar().then((m) => m.AvailabilityCalendar), {
  ssr: false,
  // The placeholder holds the calendar's height, so nothing jumps when it arrives (measured 2026-10-26).
  loading: () => (
    <p className="min-h-[36rem] md:min-h-[29rem] text-muted" role="status">
      Loading dates…
    </p>
  ),
});

interface BookingWizardProps {
  /**
   * "demo": labelled sample availability; nothing is sent or booked.
   * "request": group classes show real dates from the confirmed timetable,
   * one-to-one asks for preferred days; the request reaches Alex, who confirms.
   */
  mode: "demo" | "request";
  initialService?: BookableService;
  /** Confirmed weekly classes (request mode); empty → preferred days/times. */
  classes: PublishedClass[];
  /** Shown once a class date is chosen, like Alex's own class listing. */
  classInfo: ClassInfo;
  /**
   * Group classes are booked and paid online (lib/class-checkout.ts): the
   * class price (e.g. "£12") and the hold and cancellation rules. Absent →
   * every booking is a request Alex confirms. One-to-one is always a request.
   */
  pay?: { price: string; hold: string; cancel: string } | null;
}

export interface ClassInfo {
  name: string;
  description: string;
  payment: string;
  /** e.g. "All levels"; shown in place of the price (owner, 2026-10-28). */
  level: string;
}

/** Each step's #hash in the address bar, so browser Back moves between steps. */
const STEP_IDS = ["service", "when", "details"] as const;

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type Details = { experience: string; name: string; email: string; phone: string; message: string };

// The date is read on the client only, so prerendered HTML never holds a stale "today".
const subscribe = () => () => {};
const getToday = () => toDateKey(new Date());
const getServerToday = () => null;
/** A class credit link (/book/group-class?credit=…), read on the client so the page itself stays static. */
const getCredit = () => {
  const token = new URLSearchParams(window.location.search).get("credit");
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
};

export function BookingWizard({ mode, initialService, classes, classInfo, pay = null }: BookingWizardProps) {
  const demo = mode === "demo";
  const chosenPlan = useChosenPlan();
  const [full, setFull] = useState<{ full: string[]; cancelled: string[] }>({ full: [], cancelled: [] });
  // Places left per "slot|date" (only dates with a row) and the usual class size, for "N places left" on each class.
  const [places, setPlaces] = useState<{ left: Record<string, number>; size: number | null }>({ left: {}, size: null });
  const fullSet = new Set(full.full);
  const cancelledSet = new Set(full.cancelled);
  const initialStep = initialService ? 1 : 0;
  const [step, setStepState] = useState(initialStep);
  // The participation and risk terms, ticked just before booking (owner, 2026-10-30).
  const [waiver, setWaiver] = useState(false);
  // The first step appears without the fade; later steps fade in so the change is noticed.
  const [moved, setMoved] = useState(false);
  const router = useRouter();
  /**
   * The steps as they sit in the browser history (one entry per step moved
   * forward, marked by a #hash), so the phone's back gesture and the browser's
   * Back button return to the previous step instead of leaving the page.
   */
  const stack = useRef<number[]>([initialStep]);
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
    // Going back: step back through history when the target step is in it.
    const at = stack.current.lastIndexOf(next);
    if (at >= 0 && at < stack.current.length - 1) {
      window.history.go(at - (stack.current.length - 1));
      return;
    }
    stack.current[stack.current.length - 1] = next;
    window.history.replaceState(null, "", `#${STEP_IDS[next]}`);
    showStep(next);
  };
  /** Back on the first step leaves the wizard: to the page they came from, else home. */
  const leave = () => {
    if (window.history.length > 1) window.history.back();
    else router.push("/");
  };
  const [service, setService] = useState<BookableService | "">(initialService ?? "");
  // Demo availability
  const today = useSyncExternalStore(subscribe, getToday, getServerToday);
  const [loaded, setLoaded] = useState<{ key: string; window: AvailabilityWindow } | null>(null);
  const [pickedDate, setPickedDate] = useState<DateKey | null>(null);
  const [pickedSlot, setPickedSlot] = useState<string | null>(null);
  // Once the visitor picks (or changes service), the class from the address no longer applies.
  const [picked, setPicked] = useState(false);
  const setDate = (d: DateKey | null) => {
    setPicked(true);
    setPickedDate(d);
  };
  const setSlotId = (id: string | null) => {
    setPicked(true);
    setPickedSlot(id);
  };
  // Request preferences
  const [days, setDays] = useState<string[]>([]);
  const [times, setTimes] = useState<string[]>([]);
  // Details
  const [details, setDetails] = useState<Details>({ experience: BOOKING_EXPERIENCE[0].value, name: "", email: "", phone: "", message: "" });
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  // Signed in (a past booking made the account): fill in what's still empty.
  const signedIn = useSignedInDetails((d) =>
    setDetails((prev) => ({ ...prev, name: prev.name || d.name, email: prev.email || d.email, phone: prev.phone || d.phone })),
  );
  const [demoDone, setDemoDone] = useState(false);
  const meta = useSubmissionMeta();
  const [serverState, formAction, pending] = useActionState(submitBookingRequest, initialFormState as FormState<BookingField>);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  // Group classes in request mode: real dates from the confirmed timetable.
  const usesSessions = !demo && service === "group-class" && classes.length > 0;
  const calendar = demo || usesSessions;
  const availabilityKey = `${service}:${today}`;
  const avail = demo
    ? loaded?.key === availabilityKey
      ? loaded.window
      : null
    : usesSessions && today
      ? classAvailability(classes, today, fullSet, cancelledSet)
      : null;
  // A class chosen on the home page's day tiles (?class=<timetable id>, owner 2026-10-28):
  // its next bookable date and time arrive already chosen, until the visitor picks another.
  // From the members area's Book cards, &date=<YYYY-MM-DD> picks that date of the class.
  const classParam = useQueryParam("class");
  const dateParam = useQueryParam("date");
  const fromLink = (() => {
    if (picked || !classParam || !usesSessions || !avail) return null;
    const cls = classes.find((c) => c.id === classParam);
    if (!cls) return null;
    for (const d of avail.days) {
      if (WEEKDAY_NAMES[weekdayIndex(d.date)] !== cls.day) continue;
      if (dateParam && d.date !== dateParam && avail.days.some((x) => x.date === dateParam)) continue;
      const slot = d.slots.find((s) => s.time === cls.start && s.available);
      if (slot) return { date: d.date, slotId: slot.id };
    }
    return null;
  })();
  const date = picked ? pickedDate : (fromLink?.date ?? pickedDate);
  const slotId = picked ? pickedSlot : (fromLink?.slotId ?? pickedSlot);
  const chosenSlot = avail?.days.find((d) => d.date === date)?.slots.find((s) => s.id === slotId && s.available) ?? null;
  const chosenClass =
    usesSessions && date && chosenSlot
      ? (classes.find((c) => c.start === chosenSlot.time && c.day === WEEKDAY_NAMES[weekdayIndex(date)]) ?? null)
      : null;

  const done = demo ? demoDone : serverState.status === "success";

  // Booked and paid online, not requested: group classes without a membership plan.
  const payNow = Boolean(pay) && usesSessions && !chosenPlan;
  // The paying screens in the labelled demo (previews only), so they can be seen before Stripe is on.
  const demoPay = demo && Boolean(pay) && service === "group-class";
  const linkCredit = useSyncExternalStore(subscribe, getCredit, getServerToday);
  const [creditDropped, setCreditDropped] = useState(false);
  const credit = payNow && !creditDropped ? linkCredit : null;


  // Live classes: which dates are full (capacity reached in the coach portal) or cancelled by Alex.
  // Best effort: if it can't be read, every date stays open and Alex confirms.
  useEffect(() => {
    if (demo || service !== "group-class") return;
    let live = true;
    fetch("/api/classes/full")
      .then((r) => (r.ok ? (r.json() as Promise<{ full?: unknown; cancelled?: unknown; left?: unknown; size?: unknown; known?: unknown }>) : { full: [], cancelled: [] }))
      .then((body) => {
        const keys = (list: unknown) => (Array.isArray(list) ? list.filter((k): k is string => typeof k === "string") : []);
        if (!live) return;
        setFull({ full: keys(body.full), cancelled: keys(body.cancelled) });
        const left: Record<string, number> = {};
        const raw = "left" in body && typeof body.left === "object" && body.left !== null ? (body.left as Record<string, unknown>) : {};
        for (const [k, v] of Object.entries(raw)) if (typeof v === "number" && Number.isInteger(v) && v >= 0) left[k] = v;
        const size = "size" in body && typeof body.size === "number" && Number.isInteger(body.size) && body.size > 0 ? body.size : null;
        // Only trust the counts when the server could read them.
        setPlaces("known" in body && body.known === true ? { left, size } : { left: {}, size: null });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [demo, service]);

  useEffect(() => {
    if (!demo || !service || !today) return;
    let live = true;
    // Loaded on demand: the demonstration data never reaches visitors in request mode.
    import("@/lib/availability/demo")
      .then(({ demoAvailabilityProvider }) => demoAvailabilityProvider.getAvailability(service, today))
      .then((w) => {
        if (live) setLoaded({ key: `${service}:${today}`, window: w });
      });
    return () => {
      live = false;
    };
  }, [demo, service, today]);

  useEffect(() => {
    const onPop = () => {
      const id = window.location.hash.slice(1);
      const target = STEP_IDS.indexOf(id as (typeof STEP_IDS)[number]);
      // Other in-page links (e.g. the error summary's #email) aren't steps.
      if (id && target < 0) return;
      const next = target >= 0 ? target : stack.current[0];
      const at = stack.current.lastIndexOf(next);
      if (at >= 0) stack.current.length = at + 1;
      else stack.current.push(next);
      setMoved(true);
      setStepState(next);
    };
    // A reload keeps the #step in the address bar but not the answers: start cleanly.
    if (STEP_IDS.includes(window.location.hash.slice(1) as (typeof STEP_IDS)[number])) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Move focus to the new step's heading so keyboard and screen-reader users follow the change.
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

  const serviceLabel = service ? labelFor(BOOKABLE_SERVICES, service) : "";
  const noun = service === "group-class" ? "class" : "session";

  const whenComplete = demo ? chosenSlot !== null : usesSessions ? chosenClass !== null : days.length > 0;
  const whenText = calendar
    ? chosenSlot && date
      ? `${formatShortDate(date)} · ${formatTime(chosenSlot.time)}`
      : ""
    : days.length > 0
      ? describePreferences(days, times)
      : "";

  const steps = [
    { id: "service", label: "Service" },
    { id: "when", label: calendar ? "Date & time" : "When" },
    { id: "details", label: "Details" },
  ];

  const chooseService = (value: string) => {
    void loadCalendar();
    setService(value as BookableService);
    setDate(null);
    setSlotId(null);
  };

  const toggle = (list: string[], value: string, checked: boolean) =>
    checked ? [...list.filter((v) => v !== value), value] : list.filter((v) => v !== value);

  const validateDetails = (): FieldErrors => {
    const errors: FieldErrors = {};
    if (!details.experience) errors.experience = "Choose the option that best describes you.";
    const checks = {
      name: nameError(details.name.trim()),
      email: emailError(details.email.trim().toLowerCase()),
      phone: phoneError(details.phone.trim(), true),
      message: messageError(details.message),
    };
    for (const [field, error] of Object.entries(checks)) if (error) errors[field as BookingField] = error;
    // Last, so the first problem the page jumps to is the first field on it.
    if (!waiver) errors.waiver = classWaiver.error;
    return errors;
  };

  const update = (field: keyof Details) => (value: string) => {
    setDetails((d) => ({ ...d, [field]: value }));
    if (clientErrors[field as BookingField]) setClientErrors((e) => ({ ...e, [field]: undefined }));
  };

  const reset = () => {
    setStep(0);
    setWaiver(false);
    setService("");
    setDate(null);
    setSlotId(null);
    setDemoDone(false);
  };

  if (done) {
    return (
      <Outcome
        demo={demo}
        headingRef={headingRef}
        service={serviceLabel}
        when={whenText}
        longWhen={calendar && date && chosenSlot ? `${formatLongDate(date)} at ${formatTime(chosenSlot.time)}` : whenText}
        email={demo ? details.email.trim() : serverState.message}
        plan={service === "group-class" && chosenPlan ? `${chosenPlan.name} membership` : ""}
        onRestart={reset}
      />
    );
  }

  const errors: FieldErrors = { ...serverState.errors, ...clientErrors };
  const serverErrorList = Object.entries(serverState.errors).filter((e): e is [BookingField, string] => Boolean(e[1]));

  const summary = (
    <Summary
      demo={demo}
      pay={payNow}
      rows={[
        { label: "Service", value: serviceLabel, step: 0 },
        { label: calendar ? "Date & time" : "When", value: whenText, step: 1 },
      ]}
      currentStep={step}
      onEdit={setStep}
    />
  );

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-14">
      <div className="min-w-0 lg:col-span-8">
        <Stepper steps={steps} current={step} onSelect={setStep} label="Booking steps" />

        {step > 0 ? (
          <div className="mt-6 lg:hidden">
            <CompactSummary
              demo={demo}
              items={[
                { label: "Service", value: serviceLabel, step: 0 },
                ...(step > 1 ? [{ label: calendar ? "Date & time" : "When", value: whenText, step: 1 }] : []),
              ]}
              onEdit={setStep}
            />
          </div>
        ) : null}

        <div key={step} className={moved ? "mt-8 animate-step-in" : "mt-8"}>
          {step === 0 ? (
            <section aria-labelledby="step-heading">
              <StepHeading ref={headingRef}>
                <span id="step-heading">Choose a service</span>
              </StepHeading>
              <div className="mt-6">
                <ChoiceGroup
                  type="radio"
                  name="service"
                  legend="Service"
                  hideLegend
                  options={BOOKABLE_SERVICES.map((s) => ({ value: s.value, label: s.label, detail: s.detail }))}
                  value={service}
                  onChange={chooseService}
                />
              </div>
              <ActionBar
                onBack={leave}
                next={{ label: "Continue", disabled: !service, onClick: () => setStep(1) }}
                hint={service ? undefined : "Choose a service to continue."}
              />
            </section>
          ) : null}

          {step === 1 ? (
            <section aria-labelledby="step-heading">
              <StepHeading
                ref={headingRef}
                intro={
                  demo
                    ? undefined
                    : payNow
                      ? credit
                        ? "Pick a date. Your class credit pays for it."
                        : `Pick a date. You pay ${pay?.price} online to book your place.`
                      : usesSessions
                      ? "Pick a date. Alex confirms every place personally."
                      : "Tell Alex when suits you and he'll reply with a confirmed time."
                }
              >
                <span id="step-heading">
                  {calendar ? (service === "group-class" ? "Choose a class" : "Choose a date and time") : "When suits you?"}
                </span>
              </StepHeading>
              <div className="mt-6 space-y-8">
                {calendar ? (
                  <>
                    {demo ? <DemoLabel>Sample availability, not Alex&apos;s real timetable. Nothing is booked.</DemoLabel> : null}
                    {avail ? (
                      <AvailabilityCalendar
                        window={avail}
                        date={date}
                        slotId={slotId}
                        noun={noun}
                        placesLeft={demoPay ? samplePlaces : service === "group-class" && places.size !== null ? (slot, day) => places.left[`${slot}|${day}`] ?? places.size : undefined}
                        onDate={(d) => {
                          setDate(d);
                          setSlotId(null);
                          if (matchMedia("(max-width: 47.99rem)").matches) {
                            document.getElementById("times")?.scrollIntoView({
                              behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                              block: "nearest",
                            });
                          }
                        }}
                        onSlot={setSlotId}
                      />
                    ) : (
                      <p className="min-h-[36rem] md:min-h-[29rem] text-muted" role="status">
                        Loading {demo ? "availability" : "class dates"}…
                      </p>
                    )}
                    {chosenClass && date ? <ClassDetails info={classInfo} date={date} session={chosenClass} /> : null}
                    {(payNow && !credit && !demo) || demoPay ? (
                      <p className="text-sm">
                        Members pay from {formatPenceShort(Math.min(...membershipPlans.map((p) => Math.round((p.priceGbp * 100) / p.credits))))} a class.{" "}
                        <Link href="/memberships" target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-4 hover:no-underline">
                          See memberships<span className="sr-only"> (opens in a new tab)</span>
                        </Link>
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <ChoiceGroup
                      type="checkbox"
                      name="days"
                      legend="Which days suit you?"
                      hint="Choose as many as you like."
                      layout="chips"
                      options={PREFERRED_DAYS.map((d) => ({ value: d.value, label: d.label }))}
                      value={days}
                      onChange={(v, c) => setDays((list) => toggle(list, v, c))}
                    />
                    <ChoiceGroup
                      type="checkbox"
                      name="times"
                      legend="What time of day?"
                      hint="Leave blank if any time works."
                      layout="chips"
                      optional
                      options={PREFERRED_TIMES}
                      value={times}
                      onChange={(v, c) => setTimes((list) => toggle(list, v, c))}
                    />
                  </>
                )}
              </div>
              <ActionBar
                onBack={() => setStep(0)}
                next={{ label: "Continue", disabled: !whenComplete, onClick: () => setStep(2) }}
                total={((payNow && !credit && !demo) || demoPay) && whenComplete ? pay?.price : undefined}
                hint={
                  whenComplete
                    ? undefined
                    : calendar
                      ? date
                        ? "Choose a time to continue."
                        : "Choose a date to continue."
                      : "Choose at least one day to continue."
                }
              />
            </section>
          ) : null}

          {step === 2 ? (
            <section aria-labelledby="step-heading">
              <StepHeading
                ref={headingRef}
                intro={
                  demo
                    ? undefined
                    : payNow
                      ? "We'll send your confirmation here. Returning? Your browser can fill these in."
                      : "So Alex can reply to confirm. Returning? Your browser can fill these in."
                }
              >
                <span id="step-heading">Your details</span>
              </StepHeading>
              {payNow && !demo && !credit && chosenClass && date && pay ? (
                <PayCard info={classInfo} date={date} when={formatTime(chosenClass.start)} minutes={chosenClass.durationMinutes} price={pay.price} hold={pay.hold} />
              ) : demoPay && date && chosenSlot && pay ? (
                <PayCard info={classInfo} date={date} when={formatTime(chosenSlot.time)} minutes={groupClassMinutes} price={pay.price} hold={pay.hold} />
              ) : null}
              <form
                action={formAction}
                noValidate
                onSubmit={(e) => {
                  const found = validateDetails();
                  setClientErrors(found);
                  if (Object.keys(found).length > 0 || demo) e.preventDefault();
                  if (Object.keys(found).length > 0) {
                    requestAnimationFrame(() => document.getElementById(Object.keys(found)[0])?.focus());
                    return;
                  }
                  if (demo) setDemoDone(true);
                }}
                className="mt-6 space-y-8"
              >
                {demoPay ? (
                  <DemoNotice>Preview of paying online: nothing is charged, booked or sent. On the live site you&apos;d pay on Stripe&apos;s secure page.</DemoNotice>
                ) : demo ? (
                  <DemoNotice>Demonstration: these details aren&apos;t sent anywhere.</DemoNotice>
                ) : null}
                {serverState.status === "error" ? (
                  <ErrorSummary
                    focusRef={summaryRef}
                    message={serverState.message}
                    errors={serverErrorList}
                  />
                ) : null}

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
                ) : payNow && !demo ? (
                  // The booking makes the account (2026-10-28): say so, once, before they pay.
                  <p className="text-sm">We&apos;ll use your email to sign you in to your account next time. No password.</p>
                ) : null}
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <TextField name="name" label="Name" autoComplete="name" maxLength={100} value={details.name} onChange={update("name")} error={errors.name} />
                  <TextField
                    name="email"
                    label="Email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    maxLength={254}
                    value={details.email}
                    onChange={update("email")}
                    error={errors.email}
                  />
                </div>
                <TextField
                  name="phone"
                  label="Phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={30}
                  value={details.phone}
                  onChange={update("phone")}
                  error={errors.phone}
                  className="sm:max-w-sm"
                />
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

                {/* The visitor's choices from earlier steps travel with the details. */}
                <input type="hidden" name="service" value={service} />
                {chosenClass && date ? (
                  <>
                    <input type="hidden" name="session" value={chosenClass.label} />
                    <input type="hidden" name="classDate" value={date} />
                  </>
                ) : null}
                {credit ? <input type="hidden" name="credit" value={credit} /> : null}
                {/* The membership plan chosen on the plan cards (?plan=), group classes only. */}
                {chosenPlan && service === "group-class" ? <input type="hidden" name="plan" value={chosenPlan.id} /> : null}
                {!demo && !usesSessions ? days.map((d) => <input key={d} type="hidden" name="days" value={d} />) : null}
                {!demo && !usesSessions ? times.map((t) => <input key={t} type="hidden" name="times" value={t} />) : null}
                <SubmissionMeta meta={meta} />

                {demoPay && pay ? (
                  <div className="rule-list space-y-2 pt-4 text-sm">
                    <p>Next, you&apos;ll pay securely on Stripe&apos;s page.</p>
                    <p className="text-muted">{pay.cancel}</p>
                  </div>
                ) : null}
                {payNow && pay ? (
                  <div id="credit" tabIndex={-1} className="rule-list space-y-2 pt-4 text-sm">
                    {credit ? (
                      <>
                        <p className="font-semibold">Booking with your class credit: nothing to pay.</p>
                        {errors.credit ? <p className="font-semibold">{errors.credit}</p> : null}
                        <button
                          type="button"
                          onClick={() => setCreditDropped(true)}
                          className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4 hover:no-underline"
                        >
                          Pay {pay.price} instead
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="flex items-baseline justify-between gap-4 text-base font-semibold">
                          <span>Total</span>
                          <span>{pay.price}</span>
                        </p>
                        <p>Next, you&apos;ll pay securely on Stripe&apos;s page.</p>
                      </>
                    )}
                    <p className="text-muted">{pay.cancel}</p>
                  </div>
                ) : null}
                <PrivacyLine action={demo ? "continuing" : payNow ? "booking" : "sending this request"} booking={payNow || demoPay} />
                <div>
                  <details className="card px-5 py-4 sm:px-6">
                    <summary className="cursor-pointer font-semibold">{classWaiver.title}</summary>
                    <p className="mt-3">{classWaiver.intro}</p>
                    <ol className="mt-3 space-y-3 text-sm">
                      {classWaiver.points.map((p, i) => (
                        <li key={p.title}>
                          <span className="font-semibold">
                            {i + 1}. {p.title}.
                          </span>{" "}
                          {p.body}
                        </li>
                      ))}
                    </ol>
                  </details>
                  <label className={cn("card mt-3 flex cursor-pointer items-start gap-4 px-5 py-4 sm:px-6", errors.waiver && "outline-2 outline-ink")}>
                    <input
                      id="waiver"
                      type="checkbox"
                      name="waiver"
                      value="yes"
                      checked={waiver}
                      onChange={(e) => {
                        setWaiver(e.target.checked);
                        if (e.target.checked) setClientErrors((x) => ({ ...x, waiver: undefined }));
                      }}
                      aria-invalid={errors.waiver ? true : undefined}
                      aria-describedby={errors.waiver ? "waiver-error" : undefined}
                      className="mt-0.5 size-6 shrink-0 accent-ink"
                    />
                    <span>{classWaiver.tick}</span>
                  </label>
                  {errors.waiver ? (
                    <p id="waiver-error" className="mt-2 text-sm font-semibold">
                      <span aria-hidden="true">✕ </span>
                      {errors.waiver}
                    </p>
                  ) : null}
                </div>
                <ActionBar
                  onBack={() => setStep(1)}
                  next={{
                    label: demoPay ? "Continue to payment (preview)" : demo ? "Finish demo" : payNow ? (credit ? "Book with your credit" : pending ? "Opening Stripe…" : "Continue to payment") : "Send request",
                    type: "submit",
                    pending,
                  }}
                />
              </form>
            </section>
          ) : null}
        </div>
      </div>

      <aside aria-label={demo ? "Your selection (demonstration)" : "Your booking request"} className="hidden lg:col-span-4 lg:block">
        <div className="sticky top-28">{summary}</div>
      </aside>
    </div>
  );
}

/**
 * Pay as you go, last screen: what you're paying for, up front (class, date,
 * time, price) with how the place is held, so the price is never a surprise
 * and phones (which have no side summary) see it. Details and the Pay button follow.
 */
function PayCard({ info, date, when, minutes, price, hold }: { info: ClassInfo; date: DateKey; when: string; minutes?: number; price: string; hold: string }) {
  return (
    <div className="card mt-6 p-5">
      <p className="eyebrow text-muted">Your class</p>
      <p className="mt-2 font-display text-h3">
        {info.name} · {formatLongDate(date)}, {when}
      </p>
      <p className="mt-1 text-sm">
        {[minutes ? (minutes === 60 ? "1 hr" : `${minutes} min`) : "", "with Alex"].filter(Boolean).join(" · ")} · <span className="font-semibold">{price}</span>
      </p>
      <p className="mt-3 text-sm">{hold}</p>
    </div>
  );
}

/** Sample "places left" for the paying preview only (labelled demo data): a steady number per class date, never real. */
function samplePlaces(slotId: string, date: DateKey): number {
  let h = 0;
  for (const c of `${slotId}${date}`) h = (h * 31 + c.charCodeAt(0)) % 997;
  return 2 + (h % 12);
}

/** Length of a group class, for the paying preview. */
const groupClassMinutes = 60;

/** The chosen class, set out like Alex's own class listing. */
function ClassDetails({ info, date, session }: { info: ClassInfo; date: DateKey; session: PublishedClass }) {
  const minutes = session.durationMinutes;
  const end = minutes ? `–${formatTime(addMinutes(session.start, minutes))}` : "";
  const year = fromDateKey(date).getFullYear();
  return (
    <div aria-live="polite" className="card p-5 sm:p-6">
      <p className="eyebrow text-muted">
        {formatLongDate(date)} {year} · {formatTime(session.start)}
        {end}
      </p>
      <p className="mt-2 font-display text-h3">
        {info.name} · {session.day} class
      </p>
      <p className="mt-1 text-sm font-semibold">
        {[minutes ? `${minutes === 60 ? "1 hr" : `${minutes} min`}` : "", info.level, "with Alex"].filter(Boolean).join(" · ")}
      </p>
      <p className="mt-3 max-w-xl text-muted">{info.description}</p>
    </div>
  );
}

function Summary({
  demo,
  pay,
  rows,
  currentStep,
  onEdit,
}: {
  demo: boolean;
  pay: boolean;
  rows: { label: string; value: string; step: number }[];
  currentStep: number;
  onEdit: (step: number) => void;
}) {
  return (
    <div className="card overflow-hidden">
      <p className="flex items-center justify-between px-5 pt-5 pb-2 font-semibold">
        <span>{demo ? "Your selection" : pay ? "Your booking" : "Your request"}</span>
        {demo ? <span className="rounded-full bg-ink px-2.5 py-0.5 text-sm text-paper">Demo</span> : null}
      </p>
      <dl className="divide-y divide-line">
        {rows.map((row) => (
          <div key={row.label} className="relative min-h-14 px-5 py-3">
            <dt className="text-xs text-muted">{row.label}</dt>
            <dd className="flex items-center justify-between gap-4">
              <span className={cn("font-semibold", !row.value && "font-normal text-muted")}>{row.value || "Not chosen yet"}</span>
              {row.value && row.step < currentStep ? (
                <button
                  type="button"
                  onClick={() => onEdit(row.step)}
                  className="-my-3 inline-flex min-h-11 shrink-0 items-center text-sm font-semibold underline underline-offset-4 hover:no-underline"
                >
                  Change<span className="sr-only"> {row.label.toLowerCase()}</span>
                </button>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-line px-5 py-4 text-sm text-muted">
        {demo ? "Demonstration only. Nothing is booked." : pay ? "Your place is confirmed once you've paid." : "Alex confirms every place personally by email."}
      </p>
    </div>
  );
}

/** Phones: one line per choice so the current step stays near the top. */
function CompactSummary({
  demo,
  items,
  onEdit,
}: {
  demo: boolean;
  items: { label: string; value: string; step: number }[];
  onEdit: (step: number) => void;
}) {
  return (
    <dl aria-label={demo ? "Your selection (demonstration)" : "Your request so far"} className="card divide-y divide-line px-4">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2 py-1">
          <dt className="shrink-0 text-xs text-muted">{item.label}</dt>
          <dd className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <span className="truncate text-sm font-semibold">{item.value}</span>
            <button
              type="button"
              onClick={() => onEdit(item.step)}
              className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold underline underline-offset-4"
            >
              Change<span className="sr-only"> {item.label.toLowerCase()}</span>
            </button>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Outcome({
  demo,
  headingRef,
  service,
  when,
  longWhen,
  email,
  plan,
  onRestart,
}: {
  demo: boolean;
  /** e.g. "Regular membership", when one was chosen on the plan list. */
  plan: string;
  headingRef: React.Ref<HTMLHeadingElement>;
  service: string;
  when: string;
  longWhen: string;
  email: string;
  onRestart: () => void;
}) {
  return (
    <div className="animate-step-in" role="status">
      <div className="rounded-3xl bg-ink p-8 text-paper sm:p-12">
        <p className="eyebrow text-white">{demo ? "Demonstration complete" : "Request sent"}</p>
        <h2 ref={headingRef} tabIndex={-1} className="mt-4 font-display text-h2 text-balance focus:outline-none">
          {demo ? "No booking has been made" : "Thanks. Alex will reply to confirm"}
        </h2>
        <p className="mt-5 max-w-xl text-lede text-white">
          {demo
            ? `This was sample availability, so nothing was booked or sent. Once real availability is connected, this screen would confirm ${service.toLowerCase()} on ${longWhen}.`
            : `Your request is with Alex. He'll reply to ${email} to confirm. Your place is booked once he confirms.`}
        </p>
        {demo ? null : (
          <p className="mt-3 max-w-xl text-white">
            Nothing to pay now: Alex confirms your place first{plan ? ", sets up your membership" : ""} and tells you how to pay.
          </p>
        )}
        <dl className="mt-8 grid max-w-xl grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <div>
            <dt className="eyebrow text-white">Service</dt>
            <dd className="mt-1 font-semibold">{service}</dd>
          </div>
          <div>
            <dt className="eyebrow text-white">{demo ? "Sample time" : "When"}</dt>
            <dd className="mt-1 font-semibold">{when}</dd>
          </div>
          {plan ? (
            <div className="sm:col-span-2">
              <dt className="eyebrow text-white">Plan</dt>
              <dd className="mt-1 font-semibold">{plan}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
        {demo ? (
          <button
            type="button"
            onClick={onRestart}
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-ink px-6 text-base font-semibold text-paper transition-colors border border-ink hover:bg-white hover:text-ink"
          >
            Try another booking
          </button>
        ) : null}
        <Link href="/" className="inline-flex min-h-11 items-center text-sm font-semibold underline-offset-4 hover:underline">
          Back to the homepage
        </Link>
      </div>
    </div>
  );
}
