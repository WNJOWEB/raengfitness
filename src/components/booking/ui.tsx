"use client";

import Link from "next/link";
import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import { site } from "@/content/site";
import { classWaiver } from "@/content/policy";
import { cn } from "@/lib/cn";

/**
 * Building blocks shared by the booking and online coaching journeys.
 * Choices are native radios/checkboxes styled as tiles, so keyboard and
 * screen-reader behaviour comes from the browser.
 */

export interface Option {
  value: string;
  label: string;
  detail?: string;
}

const tile =
  // Outlined on the cream page, ink once chosen (2026-10-27: the site's one panel style).
  "relative flex cursor-pointer items-center gap-4 rounded-2xl border border-line text-ink transition-colors duration-150 " +
  "hover:border-ink has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper " +
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-ink " +
  "has-[:disabled]:cursor-not-allowed has-[:disabled]:border-dashed has-[:disabled]:text-muted";

function Indicator({ type }: { type: "radio" | "checkbox" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-5 shrink-0 items-center justify-center border border-current",
        type === "radio" && "rounded-full",
      )}
    >
      <span
        className={cn(
          "size-2.5 scale-0 bg-current transition-transform duration-150 group-has-[:checked]/tile:scale-100",
          type === "radio" && "rounded-full",
        )}
      />
    </span>
  );
}

interface ChoiceGroupProps {
  type: "radio" | "checkbox";
  name: string;
  legend: ReactNode;
  options: readonly Option[];
  /** Radio: the chosen value. Checkbox: every chosen value. */
  value: string | readonly string[];
  onChange: (value: string, checked: boolean) => void;
  hint?: ReactNode;
  error?: string;
  /** "list": full-width rows. "chips": compact tiles that wrap. */
  layout?: "list" | "chips" | "segmented";
  optional?: boolean;
  /** Visually hidden legend when the step heading already says it. */
  hideLegend?: boolean;
}

export function ChoiceGroup({
  type,
  name,
  legend,
  options,
  value,
  onChange,
  hint,
  error,
  layout = "list",
  optional = false,
  hideLegend = false,
}: ChoiceGroupProps) {
  const chosen = typeof value === "string" ? [value] : value;
  const describedBy = [hint ? `${name}-hint` : "", error ? `${name}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <fieldset aria-describedby={describedBy} aria-invalid={error ? true : undefined}>
      <legend className={cn("font-semibold", hideLegend && "sr-only")}>
        {legend}
        {optional ? <span className="font-normal text-muted"> (optional)</span> : null}
      </legend>
      {hint ? (
        <p id={`${name}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      <div
        className={cn(
          !hideLegend || hint ? "mt-3" : undefined,
          layout === "list" ? "grid grid-cols-1 gap-2" : layout === "segmented" ? "grid grid-cols-3 gap-2" : "flex flex-wrap gap-2",
        )}
      >
        {options.map((o, i) => (
          <label
            key={o.value}
            className={cn(
              "group/tile",
              tile,
              layout === "list" ? "min-h-14 px-4 py-3" : layout === "segmented" ? "min-h-12 justify-center px-1.5 py-2 text-center text-sm" : "min-h-12 min-w-14 justify-center px-4 py-2",
            )}
          >
            <input
              type={type}
              name={name}
              id={i === 0 ? name : undefined}
              value={o.value}
              checked={chosen.includes(o.value)}
              onChange={(e) => onChange(o.value, e.target.checked)}
              className="sr-only"
            />
            {layout === "list" ? <Indicator type={type} /> : null}
            <span className="min-w-0">
              <span className="block font-semibold">{o.label}</span>
              {o.detail ? (
                <span className="mt-0.5 block text-sm text-muted group-has-[:checked]/tile:text-white">
                  {o.detail}
                </span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
      <FieldError id={`${name}-error`} message={error} />
    </fieldset>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-2 text-sm font-semibold text-ink">
      <span aria-hidden="true">✕ </span>
      {message}
    </p>
  );
}

const input =
  "mt-2 block w-full min-h-12 rounded-xl border border-muted bg-white px-4 py-3 text-base text-ink transition-colors duration-150 placeholder:text-grey hover:border-ink focus-visible:border-ink aria-[invalid=true]:border-2 aria-[invalid=true]:border-ink";

interface TextFieldProps {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  optional?: boolean;
  type?: "text" | "email" | "tel";
  autoComplete?: string;
  inputMode?: "text" | "email" | "tel" | "numeric";
  maxLength?: number;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
}

export function TextField({
  name,
  label,
  value,
  onChange,
  error,
  hint,
  optional = false,
  type = "text",
  autoComplete,
  inputMode,
  maxLength,
  multiline = false,
  placeholder,
  className,
}: TextFieldProps) {
  const describedBy = [hint ? `${name}-hint` : "", error ? `${name}-error` : ""].filter(Boolean).join(" ") || undefined;
  const shared = {
    id: name,
    name,
    value,
    maxLength,
    placeholder,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    "aria-required": optional ? undefined : true,
  };
  return (
    <div className={className}>
      <label htmlFor={name} className="block font-semibold">
        {label}
        {optional ? <span className="font-normal text-muted"> (optional)</span> : null}
      </label>
      {hint ? (
        <p id={`${name}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {multiline ? (
        <textarea {...shared} rows={4} onChange={(e) => onChange(e.target.value)} className={input} />
      ) : (
        <input
          {...shared}
          type={type}
          autoComplete={autoComplete}
          inputMode={inputMode}
          onChange={(e) => onChange(e.target.value)}
          className={input}
        />
      )}
      <FieldError id={`${name}-error`} message={error} />
    </div>
  );
}

/** Reveals an optional field on request, so most people never see it. */
export function Disclosure({ label, children, initiallyOpen = false }: { label: string; children: ReactNode; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  if (open) return <div className="animate-step-in">{children}</div>;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline-offset-4 hover:underline"
    >
      <span aria-hidden="true">+</span> {label}
    </button>
  );
}

export const StepHeading = forwardRef<HTMLHeadingElement, { children: ReactNode; intro?: ReactNode }>(
  function StepHeading({ children, intro }, ref) {
    return (
      <div>
        <h2 ref={ref} tabIndex={-1} className="font-display text-h3 focus:outline-none">
          {children}
        </h2>
        {intro ? <p className="mt-2 max-w-xl text-muted">{intro}</p> : null}
      </div>
    );
  },
);

export interface StepInfo {
  id: string;
  label: string;
}

/** Progress through the steps. Completed steps can be revisited. */
export function Stepper({
  steps,
  current,
  onSelect,
  label,
}: {
  steps: readonly StepInfo[];
  current: number;
  onSelect: (index: number) => void;
  label: string;
}) {
  return (
    <nav aria-label={label}>
      <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((step, i) => {
          const state = i < current ? "done" : i === current ? "current" : "todo";
          const content = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "block h-1.5 w-full rounded-full transition-colors duration-200",
                  state === "todo" ? "bg-line" : "bg-ink",
                )}
              />
              <span className={cn("mt-2 flex items-baseline gap-1.5 text-xs font-semibold", state === "todo" ? "text-muted" : "text-ink")}>
                <span aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                <span className={cn("truncate", state !== "current" && "max-sm:sr-only")}>{step.label}</span>
              </span>
              <span className="sr-only">
                {state === "done" ? " (completed, select to edit)" : state === "current" ? " (current step)" : ""}
              </span>
            </>
          );
          return (
            <li key={step.id} aria-current={state === "current" ? "step" : undefined}>
              {state === "done" ? (
                <button type="button" onClick={() => onSelect(i)} className="flex min-h-11 w-full flex-col justify-start text-left hover:opacity-70">
                  {content}
                </button>
              ) : (
                <span className="block min-h-11">{content}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const primaryButton =
  "inline-flex min-h-12 items-center justify-center gap-3 rounded-full bg-ink px-6 text-base font-semibold text-paper transition-[background-color,transform] duration-150 border border-ink hover:bg-white hover:text-ink active:scale-[0.98] disabled:cursor-not-allowed disabled:border-grey disabled:bg-transparent disabled:text-grey disabled:active:scale-100";

/**
 * Back / next controls. Sticks to the bottom of the screen on phones so the
 * next step is always in reach; static on desktop.
 */
export function ActionBar({
  onBack,
  backLabel = "Back",
  next,
  hint,
  total,
}: {
  onBack?: () => void;
  backLabel?: string;
  next: { label: string; disabled?: boolean; onClick?: () => void; type?: "button" | "submit"; pending?: boolean };
  hint?: string;
  /** The price, shown beside the button (not inside it) once a class is chosen: "Total £12". */
  total?: string;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-10 border-t border-line bg-paper px-4 pt-3 pb-[max(0.25rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-t-0 lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-none">
      <div className="flex items-center justify-between gap-4">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-12 items-center gap-2 text-sm font-semibold underline-offset-4 hover:underline"
          >
            {backLabel}
          </button>
        ) : (
          <span />
        )}
        {total ? (
          <p className="ml-auto flex flex-col leading-tight">
            <span className="text-xs">Total</span>
            <span className="text-lg font-bold tabular-nums">{total}</span>
          </p>
        ) : null}
        <button
          type={next.type ?? "button"}
          onClick={next.onClick}
          disabled={next.disabled || next.pending}
          aria-describedby={hint ? "action-hint" : undefined}
          className={primaryButton}
        >
          {next.pending ? "Sending…" : next.label}
        </button>
      </div>
      <p id="action-hint" aria-live="polite" className="mt-1 min-h-5 text-right text-sm text-muted">
        {hint ?? ""}
      </p>
    </div>
  );
}

export function ErrorSummary({ message, errors, focusRef }: { message: string; errors: [string, string][]; focusRef?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={focusRef} tabIndex={-1} role="alert" className="rounded-2xl border-2 border-ink bg-white p-5 focus:outline-none">
      <p className="font-bold">{message}</p>
      {errors.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5">
          {errors.map(([field, text]) => (
            <li key={field}>
              <a href={`#${field}`} className="underline underline-offset-4">
                {text}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Compact label for demonstration data, e.g. above the calendar. */
export function DemoLabel({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-3 text-sm">
      <span className="eyebrow shrink-0 bg-ink px-2 py-1 text-paper">Demo</span>
      <span>{children}</span>
    </p>
  );
}

/** Shown wherever demonstration data could be mistaken for the real thing. */
export function DemoNotice({ children }: { children: ReactNode }) {
  return (
    <div role="note" aria-label="Demonstration" className="flex gap-4 border-2 border-dashed border-ink bg-white p-4 sm:p-5">
      <span className="eyebrow mt-0.5 shrink-0 self-start bg-ink px-2 py-1 text-paper">Demo</span>
      <p className="text-sm">{children}</p>
    </div>
  );
}

export function PrivacyLine({
  action,
  booking = false,
  what = "booking",
  small = false,
}: {
  action: string;
  /** Paid online, not an enquiry: the details confirm it rather than get a reply. */
  booking?: boolean;
  /** What was paid for: "booking" (a class) or "membership". */
  what?: "booking" | "membership";
  /** Small print, under a price card. */
  small?: boolean;
}) {
  return (
    <p className={cn(small ? "text-xs" : "text-sm", "text-muted")}>
      {booking ? `We use these details to confirm your ${what} and email you about it.` : `By ${action}, you agree to Alex using these details to reply.`} Read the{" "}
      <Link href="/privacy" className="underline underline-offset-4">
        privacy notice
      </Link>
      .
    </p>
  );
}

export function InstagramFallback({ children }: { children: ReactNode }) {
  return (
    // The site's outlined panel (2026-10-27), not a black block.
    <div className="card p-6 sm:p-10">
      <p className="max-w-xl text-lede">{children}</p>
      <a
        href={site.social.instagram.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-6 inline-flex min-h-12 items-center gap-3 rounded-full border border-ink bg-ink px-6 text-base font-semibold text-white transition-colors hover:bg-white hover:text-ink"
      >
        Message Alex on Instagram
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </div>
  );
}

/** Spam trap: hidden from people and assistive tech; bots tend to fill it. */
export function Honeypot() {
  return (
    <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
      <label htmlFor="website">Leave this field empty</label>
      <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
    </div>
  );
}

type Meta = { startedAt: string; submissionId: string };

/**
 * Hidden spam-check fields: when the journey started and a per-visit id
 * (duplicate submissions share it, so they send once). Set after mount, so
 * prerendered HTML holds no per-visitor values.
 */
export function useSubmissionMeta(): React.RefObject<Meta | null> {
  const meta = useRef<Meta | null>(null);
  useEffect(() => {
    meta.current = { startedAt: String(Date.now()), submissionId: crypto.randomUUID() };
  }, []);
  return meta;
}

export function SubmissionMeta({ meta }: { meta: React.RefObject<Meta | null> }) {
  return (
    <>
      <input type="hidden" name="startedAt" ref={(el) => { if (el && meta.current) el.value = meta.current.startedAt; }} />
      <input type="hidden" name="submissionId" ref={(el) => { if (el && meta.current) el.value = meta.current.submissionId; }} />
      <Honeypot />
    </>
  );
}

/** Phones: one line per choice so the current step stays near the top. Every booking journey uses it. */
export function CompactSummary({
  demo,
  items,
  onEdit,
}: {
  demo: boolean;
  items: { label: string; value: string; step: number }[];
  onEdit: (step: number) => void;
}) {
  return (
    <dl aria-label={demo ? "Your selection (demonstration)" : "Your choices so far"} className="card divide-y divide-line px-4">
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

/**
 * The participation and risk terms (content/policy.ts classWaiver), ticked
 * before every class booking and every membership join (owner, 2026-10-31).
 * The server checks the tick again and stores the wording's version and time.
 */
export function WaiverField({ checked, error, onChange }: { checked: boolean; error?: string; onChange: (checked: boolean) => void }) {
  // One card (owner, 2026-11-05: simpler on phones): the required tick first, the full terms a tap away inside it.
  return (
    <div>
      <div className={cn("card px-4 py-4 sm:px-5", error && "outline-2 outline-ink")}>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            id="waiver"
            type="checkbox"
            name="waiver"
            value="yes"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "waiver-error" : undefined}
            className="mt-0.5 size-6 shrink-0 accent-ink"
          />
          <span>
            <span className="block font-semibold">{classWaiver.title}</span>
            <span className="mt-0.5 block text-sm">{classWaiver.tick}</span>
          </span>
        </label>
        <details className="group/terms ml-9">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-semibold underline underline-offset-4 [&::-webkit-details-marker]:hidden">
            <span className="group-open/terms:hidden">Read the terms</span>
            <span className="hidden group-open/terms:inline">Hide the terms</span>
          </summary>
          <div className="pb-1 text-sm">
            <p>{classWaiver.intro}</p>
            <ol className="mt-3 space-y-2.5">
              {classWaiver.points.map((p, i) => (
                <li key={p.title}>
                  <span className="font-semibold">
                    {i + 1}. {p.title}.
                  </span>{" "}
                  {p.body}
                </li>
              ))}
            </ol>
          </div>
        </details>
      </div>
      {error ? (
        <p id="waiver-error" className="mt-2 text-sm font-semibold">
          <span aria-hidden="true">✕ </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}
