"use client";

import { useState } from "react";

/**
 * The credit adjuster's stepper (owner's coach design, 2026-11-04): minus and
 * plus change a member's credits for this period by up to 20 either way, never
 * below what they've already used or above 60. Posts `delta`; the database
 * checks it again. Nothing changes until Save.
 */
export function CreditStepper({ credits, used }: { credits: number; used: number }) {
  const [delta, setDelta] = useState(0);
  const allowed = (change: number) => {
    const next = delta + change;
    return Math.abs(next) <= 20 && credits + next >= used && credits + next <= 60;
  };
  const button = "grid size-11 place-items-center rounded-full border border-ink text-xl font-semibold leading-none disabled:cursor-not-allowed disabled:border-line disabled:text-line";
  return (
    <div className="flex items-center gap-4">
      <input type="hidden" name="delta" value={delta} />
      <button type="button" aria-label="Take one credit away" disabled={!allowed(-1)} onClick={() => setDelta(delta - 1)} className={button}>
        −
      </button>
      <p aria-live="polite" className="min-w-28 text-center">
        <span className="block text-3xl font-extrabold tabular-nums">{credits + delta}</span>
        <span className="block text-xs">{delta === 0 ? `credits (${used} used)` : `${delta > 0 ? "adding" : "taking away"} ${Math.abs(delta)}`}</span>
      </p>
      <button type="button" aria-label="Add one credit" disabled={!allowed(1)} onClick={() => setDelta(delta + 1)} className={button}>
        +
      </button>
    </div>
  );
}
