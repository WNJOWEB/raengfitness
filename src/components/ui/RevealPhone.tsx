"use client";

import { useState } from "react";
import { PhoneIcon } from "./ContactIcons";

/**
 * The phone number, shown only after a tap (owner, 2026-10-30: so scrapers
 * can't scalp it). The server sends it scrambled (`scramblePhone`, lib/phone.ts);
 * it is unscrambled here, in the browser, when someone asks for it. Without
 * JavaScript the number stays hidden and the email is the way in.
 */
export function RevealPhone({ scrambled, mode }: { scrambled: string; mode: "row" | "footer" }) {
  const [number, setNumber] = useState<string | null>(null);
  const show = () => {
    try {
      setNumber(atob(scrambled).split("").reverse().join(""));
    } catch {
      setNumber(null);
    }
  };
  const tel = number ? `tel:${number.replace(/\s+/g, "")}` : null;

  if (mode === "footer") {
    return number ? (
      <a href={tel ?? undefined} className="inline-flex min-h-11 items-center underline underline-offset-4 hover:no-underline">
        {number}
      </a>
    ) : (
      <button type="button" onClick={show} className="inline-flex min-h-11 cursor-pointer items-center underline underline-offset-4 hover:no-underline">
        Show phone number
      </button>
    );
  }
  return (
    <li className="flex items-center justify-between gap-4 rounded-[1.25rem] bg-white px-5 py-3 max-[400px]:flex-col max-[400px]:items-start max-[400px]:gap-0 sm:px-6">
      <div className="flex min-w-0 items-center gap-4 py-1">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-paper text-ink">
          <PhoneIcon className="size-6" />
        </span>
        <div className="min-w-0">
          <p className="card-title">Phone</p>
          <div className="mt-0.5 text-[0.9375rem]" aria-live="polite">
            {number ?? "Tap to show the number."}
          </div>
        </div>
      </div>
      <div className="shrink-0 max-[400px]:pl-[3.75rem]">
        {number ? (
          <a href={tel ?? undefined} className="inline-flex min-h-11 shrink-0 items-center font-semibold underline underline-offset-4 hover:no-underline">
            Call<span className="sr-only"> {number}</span>
          </a>
        ) : (
          <button type="button" onClick={show} className="inline-flex min-h-11 shrink-0 cursor-pointer items-center font-semibold underline underline-offset-4 hover:no-underline">
            Show number
          </button>
        )}
      </div>
    </li>
  );
}
