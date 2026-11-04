/**
 * A confirm sheet's content, worked out on the server for each class card or
 * booked place. The form it submits is one of the account's Server Actions;
 * `fields` are its hidden inputs (each action re-checks everything itself).
 */
export interface SheetPayload {
  /** Which action the confirm button runs; "info" only explains (no form). */
  kind: "book" | "credit" | "cancel" | "waitlist" | "waitlist-leave" | "info";
  eyebrow: string;
  title: string;
  body: string;
  confirm: string;
  keep: string;
  fields: Record<string, string>;
}

export const SHEET_EVENT = "members:sheet";
