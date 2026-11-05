import type { ContentStatus } from "./types";

/**
 * Alex's profile. Only `name` and `summary` are confirmed (his Instagram
 * profile and the owner's brief). Every other field is an empty slot: fill it
 * in with Alex's own words and set its status to "confirmed" once he has
 * approved it. Empty or provisional fields are not shown on production.
 */
export interface CoachField {
  status: ContentStatus;
  /** Plain text; separate paragraphs with a blank line. */
  text: string;
}

export const coach = {
  name: "Alex Robertson",
  /** One line under his name in the home page's "Coached by" strip; from the confirmed summary. */
  role: "Kettlebell coach in Cumbernauld",
  summary:
    "Kettlebell coach based in Cumbernauld, running group classes, 1:1 personal coaching and small group coaching.",
  /** Where Alex trained and coached before RAENG. */
  background: null as CoachField | null,
  /** Relevant, verifiable qualifications. Never published unconfirmed. */
  qualifications: null as CoachField | null,
  /** How he approaches coaching, in his words. */
  philosophy: null as CoachField | null,
  /** Why he coaches, in his words. */
  motivation: null as CoachField | null,
} as const;
