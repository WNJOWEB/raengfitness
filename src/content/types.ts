/**
 * Every piece of business information that could mislead a customer if wrong
 * carries a status. Provisional content is hidden on production builds and
 * only shown (with a visible marker) when CONTENT_PREVIEW=true.
 * See CONTENT.md for the approval workflow.
 */
export type ContentStatus = "confirmed" | "provisional";

export type Weekday =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

/** 24-hour clock, e.g. "18:30". */
export type TimeOfDay = `${number}:${number}`;

export interface ClassSession {
  id: string;
  day: Weekday;
  start: TimeOfDay;
  /** Leave undefined until the client confirms class length. */
  durationMinutes?: number;
  /** The class's own name, e.g. "KB HIIT". Falls back to the generic group class name. */
  name?: string;
  /** One line on what the class is. */
  description?: string;
}

export interface Timetable {
  status: ContentStatus;
  sessions: ClassSession[];
}

export interface Price {
  status: ContentStatus;
  /** Whole pounds sterling. */
  amountGbp: number;
  /** Shown before the amount, e.g. "From". */
  prefix?: string;
  /** Shown after the amount, e.g. "per session". */
  unit: string;
  label: string;
  /** A line under the price explaining what it covers. */
  description?: string;
}

export interface Service {
  id: "group-classes" | "one-to-one" | "online-coaching";
  name: string;
  shortName: string;
  href: string;
  summary: string;
  /** Verified description points only. */
  points: string[];
  prices: Price[];
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  /** Answers that depend on provisional data inherit that status. */
  status: ContentStatus;
}

export interface Logo {
  src: string;
  width: number;
  height: number;
  alt: string;
}

export interface Photo {
  src: string;
  width: number;
  height: number;
  alt: string;
}

/** One chapter of Alex's story, e.g. "Where it started". */
export interface JourneyChapter {
  label: string;
  title: string;
  body: string;
}

/** A real number worth showing, e.g. Instagram followers. Never estimated. */
export interface Highlight {
  value: string;
  label: string;
}

export interface Journey {
  /** "provisional" until Alex approves the words and photos; hidden on production until then. */
  status: ContentStatus;
  title: string;
  intro: string;
  chapters: JourneyChapter[];
  /** Genuine photos of Alex, same framing if possible. Null leaves an empty slot in previews only. */
  before: Photo | null;
  after: Photo | null;
  /** e.g. "2019 → 2025". */
  beforeLabel: string;
  afterLabel: string;
  caption: string;
  highlights: Highlight[];
}
