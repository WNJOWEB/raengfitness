"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * A submit button that shows it was pressed (owner, 2026-11-02, after the speed
 * audit): while its form is being sent it is disabled and says what is
 * happening, so a slow answer never looks like a missed tap. Put it inside a
 * form with a Server Action; it works without JavaScript as a plain submit button.
 */
export function PendingButton({ children, pendingLabel = "One moment…", className, ...rest }: { children: ReactNode; pendingLabel?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "disabled" | "children">) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={className} {...rest}>
      {pending ? pendingLabel : children}
    </button>
  );
}
