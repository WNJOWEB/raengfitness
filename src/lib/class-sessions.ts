import { timetable } from "@/content/classes";
import type { ClassSlot } from "./availability/timetable";
import type { Env } from "./env";
import { isPublishable } from "./publish";
import { formatTime, sortSessions } from "./schedule";

export interface PublishedClass extends ClassSlot {
  /** The timetable id, e.g. "sat-morning" (links a request to its class in the coach portal). */
  id: string;
  /** e.g. "Monday 6:30 pm": the value a booking request carries. */
  label: string;
  durationMinutes?: number;
  /** The class's own name and line from the timetable, e.g. "KB HIIT". */
  name?: string;
  description?: string;
}

/** Confirmed weekly classes. Empty until the timetable is publishable. */
export function publishedClasses(env: Env = process.env): PublishedClass[] {
  if (!isPublishable(timetable.status, env)) return [];
  return sortSessions(timetable.sessions).map((s) => ({
    id: s.id,
    label: `${s.day} ${formatTime(s.start)}`,
    day: s.day,
    start: s.start,
    durationMinutes: s.durationMinutes,
    ...(s.name ? { name: s.name } : {}),
    ...(s.description ? { description: s.description } : {}),
  }));
}

/** Confirmed weekly class times as choices, e.g. "Monday 6:30 pm". */
export function publishedSessionLabels(env: Env = process.env): string[] {
  return publishedClasses(env).map((c) => c.label);
}
