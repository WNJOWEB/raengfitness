"use client";

import { useEffect, useRef, useState } from "react";
import { SHEET_EVENT, type SheetPayload } from "./sheet";

type Action = (formData: FormData) => Promise<void>;

/**
 * The bottom sheet that confirms a booking or a cancellation (owner's members
 * design): a native modal <dialog>, so focus stays in it, Escape and the
 * backdrop close it, and the page behind is inert. Opened by SheetTrigger.
 * Without JavaScript the trigger is a link (?confirm=…) and the page renders
 * this sheet already open, with a link back as "keep".
 */
export function ConfirmSheet({
  actions,
  initial,
  closeHref,
}: {
  actions: Record<"book" | "credit" | "cancel" | "waitlist" | "waitlist-leave", Action>;
  initial: SheetPayload | null;
  closeHref: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [payload, setPayload] = useState<SheetPayload | null>(initial);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const open = (e: Event) => {
      setPayload((e as CustomEvent<SheetPayload>).detail);
      setPending(false);
      if (dialog.open) dialog.close();
      dialog.showModal();
    };
    window.addEventListener(SHEET_EVENT, open);
    // Rendered open for the no-JavaScript fallback: make it modal now.
    if (initial && dialog.open) {
      dialog.close();
      dialog.showModal();
      window.history.replaceState(window.history.state, "", closeHref);
    }
    return () => window.removeEventListener(SHEET_EVENT, open);
  }, [initial, closeHref]);

  const close = () => ref.current?.close();
  const action = payload && payload.kind !== "info" ? actions[payload.kind] : null;

  return (
    <dialog
      ref={ref}
      open={initial ? true : undefined}
      aria-labelledby="sheet-title"
      className="members-sheet"
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      {payload ? (
        <div className="mx-auto flex max-w-[576px] flex-col gap-3.5">
          <span aria-hidden="true" className="mx-auto mb-1.5 h-1 w-10 rounded-full bg-grey" />
          <p className="members-eyebrow">{payload.eyebrow}</p>
          <h2 id="sheet-title" className="text-[1.625rem] leading-[1.1] font-extrabold tracking-[-0.03em]">
            {payload.title}
          </h2>
          <p className="text-ink">{payload.body}</p>
          <form action={action ?? undefined} onSubmit={() => setPending(true)} className="mt-1.5 flex gap-2.5">
            {Object.entries(payload.fields).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <a
              href={closeHref}
              onClick={(e) => {
                e.preventDefault();
                close();
              }}
              className="members-btn flex-1"
            >
              {payload.keep}
            </a>
            {action ? (
              <button type="submit" disabled={pending} className="members-btn members-btn-solid flex-1">
                {pending ? "One moment…" : payload.confirm}
              </button>
            ) : null}
          </form>
        </div>
      ) : null}
    </dialog>
  );
}
