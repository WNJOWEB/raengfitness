import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The confirmation screen after a card payment or a Direct Debit set-up
 * (owner, 2026-11-02). A third state, "stopped", is for a payment that was cancelled or ran out. Two states: "waiting" (a turning ring, the steps, "this
 * page updates by itself") and "done" (an ink disc with a drawn tick, a short
 * list of what was set up). It only shows what the caller tells it, so the
 * caller decides when something is confirmed: never from the browser arriving,
 * only from the database (which changes on Stripe's verified word).
 * Rendered on the public site and inside the members area ("members" variant).
 */
export interface ConfirmationStep {
  label: string;
  status: "done" | "active" | "todo";
}

interface ConfirmationProps {
  state: "waiting" | "done" | "stopped";
  headingId: string;
  eyebrow: string;
  title: string;
  lede?: ReactNode;
  steps?: ConfirmationStep[];
  /** What was set up: label and value rows. */
  details?: [string, ReactNode][];
  variant?: "site" | "members";
  children?: ReactNode;
}

function Ring() {
  return (
    <svg className="cf-ring" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <circle className="cf-track" cx="24" cy="24" r="20" />
      <circle className="cf-arc" cx="24" cy="24" r="20" />
    </svg>
  );
}

/** A payment that didn't go through (cancelled, expired or closed): not a tick, not a spinner. */
function Cross() {
  return (
    <svg className="cf-tick" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path d="M15 15 33 33M33 15 15 33" />
    </svg>
  );
}

function Tick({ small = false }: { small?: boolean }) {
  return (
    <svg className={small ? "cf-tick cf-tick-sm" : "cf-tick"} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path d="M12 25.5 20.5 34 36 15" />
    </svg>
  );
}

const STEP_WORD = { done: "done", active: "in progress", todo: "next" } as const;

export function Confirmation({ state, headingId, eyebrow, title, lede, steps, details, variant = "site", children }: ConfirmationProps) {
  const members = variant === "members";
  return (
    <div className="flex flex-col gap-5" role="status" aria-live="polite">
      <div className={cn("cf-badge", state === "done" ? "cf-badge-done" : state === "stopped" ? "cf-badge-stop" : "cf-badge-wait")}>{state === "done" ? <Tick /> : state === "stopped" ? <Cross /> : <Ring />}</div>
      <div className="flex flex-col gap-2">
        <p className={members ? "members-eyebrow" : "eyebrow"}>{eyebrow}</p>
        <h1 id={headingId} className={members ? "text-[clamp(1.875rem,8.4vw,2.625rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance" : "font-display text-h1 text-balance"}>
          {title}
        </h1>
        {lede ? <p className={members ? "text-ink" : "text-lede"}>{lede}</p> : null}
      </div>

      {steps && steps.length > 0 ? (
        <ol className="cf-steps cf-rise flex flex-col gap-3 rounded-[1.25rem] bg-white p-5" style={{ "--cf-delay": "120ms" } as CSSProperties}>
          {steps.map((s) => (
            <li key={s.label} className={cn("flex items-center gap-3", s.status === "todo" && "text-ink")}>
              <span className={cn("cf-dot", s.status === "done" && "cf-dot-done", s.status === "active" && "cf-dot-active")} aria-hidden="true">
                {s.status === "done" ? <Tick small /> : null}
              </span>
              <span className={s.status === "active" ? "font-semibold" : undefined}>
                {s.label}
                <span className="sr-only"> ({STEP_WORD[s.status]})</span>
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {details && details.length > 0 ? (
        <dl className="cf-rise rounded-[1.25rem] bg-white px-5" style={{ "--cf-delay": "180ms" } as CSSProperties}>
          {details.map(([k, v], i) => (
            <div key={k} className={cn("flex justify-between gap-4 py-3.5", i > 0 && "border-t border-line")}>
              <dt>{k}</dt>
              <dd className="min-w-0 text-right font-semibold [overflow-wrap:anywhere]">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {children ? (
        <div className="cf-rise flex flex-col gap-3" style={{ "--cf-delay": "240ms" } as CSSProperties}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
