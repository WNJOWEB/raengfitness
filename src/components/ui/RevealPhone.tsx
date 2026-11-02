"use client";

import { useState } from "react";
import { PhoneIcon } from "./ContactIcons";
import { tileBadgeClass, tileClass } from "./contact-tile";

/**
 * The phone number, shown only after a tap (owner, 2026-10-30: so scrapers
 * can't scalp it). The server sends it scrambled (`scramblePhone`, lib/phone.ts);
 * it is unscrambled here, in the browser, when someone asks for it. Without
 * JavaScript the number stays hidden and the email is the way in.
 */
export function RevealPhone({ scrambled, mode }: { scrambled: string; mode: "tile" | "footer" }) {
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
  // The contact tile: the number stays hidden until the first tap, then the same tile becomes the call link.
  const body = (
    <>
      <span aria-hidden="true" className={tileBadgeClass}>
        <PhoneIcon className="size-6" />
      </span>
      <span>
        <span className="card-title block">Call</span>
        <span className="block min-[360px]:min-h-[2.6rem] text-[0.8125rem]" aria-live="polite">
          {number ?? "Tap to show the number"}
        </span>
      </span>
    </>
  );
  return (
    <li>
      {number ? (
        <a href={tel ?? undefined} className={tileClass}>
          {body}
          <span className="sr-only">Call {number}</span>
        </a>
      ) : (
        <button type="button" onClick={show} className={`${tileClass} cursor-pointer`}>
          {body}
        </button>
      )}
    </li>
  );
}
