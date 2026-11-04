"use client";

import { useId, useRef, type ReactNode } from "react";

/**
 * A panel that opens over the page (owner's coach design, 2026-11-04) for one
 * person's booking: their details, a private note and the credit adjuster, so
 * Alex doesn't leave the class list. A native modal <dialog>: focus stays in
 * it, Escape and a tap outside close it. The content is rendered on the
 * server and passed in; the forms inside work as anywhere in the coach area.
 */
export function DetailsPanel({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => ref.current?.showModal()} className="inline-flex min-h-11 items-center px-1 text-sm font-semibold underline underline-offset-4 hover:no-underline">
        {label}
      </button>
      <dialog
        ref={ref}
        aria-labelledby={id}
        className="members-sheet members-sheet-scroll"
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
      >
        <div className="mx-auto flex max-w-[576px] flex-col gap-5">
          <span aria-hidden="true" className="mx-auto mb-0.5 h-1 w-10 rounded-full bg-grey" />
          <div className="flex items-start justify-between gap-3">
            <h2 id={id} className="text-[1.625rem] leading-[1.1] font-extrabold tracking-[-0.03em] [overflow-wrap:anywhere]">
              {title}
            </h2>
            <button type="button" onClick={() => ref.current?.close()} className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-ink px-5 text-sm font-semibold">
              Close
            </button>
          </div>
          {children}
        </div>
      </dialog>
    </>
  );
}
