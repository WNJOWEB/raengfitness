"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * The members menu (owner's design, "action-first"): the menu button and a
 * drawer from the left, a native modal <dialog> (focus kept inside, Escape
 * and the backdrop close it). It closes when a link in it is followed.
 */
export function MembersDrawer({ children, label = "Members menu" }: { children: ReactNode; label?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    ref.current?.close();
  }, [pathname]);

  // The menu stays open while the next page loads (see onClick below), and the page being left can be kept hidden
  // by the router: its menu is closed as it is hidden, so going back never shows it open.
  useEffect(() => {
    const dialog = ref.current;
    return () => dialog?.close();
  }, []);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-controls="members-drawer"
        onClick={() => ref.current?.showModal()}
        className="grid size-11 place-items-center rounded-full"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[22px] fill-none stroke-ink stroke-[1.8]" strokeLinecap="round">
          <path d="M4 8h16M4 16h11" />
        </svg>
        <span className="sr-only">{label}</span>
      </button>
      <dialog
        ref={ref}
        id="members-drawer"
        aria-label={label}
        className="members-drawer"
        onClick={(e) => {
          if (e.target === ref.current) return ref.current?.close();
          const link = (e.target as HTMLElement).closest("a");
          if (!link) return;
          // A link to another page keeps the menu open, with the tapped tile pressed (LinkPending), until the page
          // arrives and the path changes (above): a tap never just vanishes (owner, 2026-11-04). A link to a new tab,
          // or to a place on this same page, closes it at once.
          if (link.target === "_blank" || link.pathname === window.location.pathname) ref.current?.close();
        }}
      >
        {/* Opening the menu focuses the panel, not the close button, so a tap shows no focus box (iOS drew one round "Close"). Tab reaches the button next. */}
        <div tabIndex={-1} autoFocus className="flex min-h-full flex-col outline-none">
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close menu"
            className="-mt-1 mb-2 grid size-11 shrink-0 place-items-center self-end rounded-full border border-line bg-white transition-colors hover:border-ink active:scale-95 motion-reduce:transition-none"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-ink stroke-[1.8]" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
          {children}
        </div>
      </dialog>
    </>
  );
}
