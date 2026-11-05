/**
 * Choices offered in the booking and online coaching journeys. Shared by the
 * browser and the server (which validates against the same lists). Wording
 * only: no prices, durations or capacity, which Alex has not confirmed.
 */

export const BOOKABLE_SERVICES = [
  {
    value: "group-class",
    label: "Group classes",
    detail: "Coached group kettlebell classes",
    path: "/book/group-class",
  },
  {
    value: "one-to-one",
    label: "1:1 personal coaching",
    detail: "Individual coaching with Alex: a single session or a monthly package",
    path: "/book/one-to-one",
  },
  {
    value: "small-group",
    label: "Small group coaching enquiry",
    detail: "Ask about availability for small group kettlebell coaching",
    path: "/book/small-group",
  },
] as const;
export type BookableService = (typeof BOOKABLE_SERVICES)[number]["value"];

export function bookableService(value: string): (typeof BOOKABLE_SERVICES)[number] | undefined {
  return BOOKABLE_SERVICES.find((s) => s.value === value);
}

/**
 * What a 1:1 request is for (2026-11-05). Prices come from services.ts, not
 * from here. Requests stored before this existed carry no option.
 */
export const ONE_TO_ONE_OPTIONS = [
  { value: "single", label: "Single 1:1 session" },
  { value: "monthly", label: "Monthly package (4 sessions)" },
] as const;
export type OneToOneOption = (typeof ONE_TO_ONE_OPTIONS)[number]["value"];

/** "Your kettlebell experience" (2026-10-18). The first is selected by default. */
/**
 * Labels changed 2026-10-20 at the owner's request (were ROOKIE / WARRIOR /
 * BEAST MODE). The submitted values stay the same, so a form opened before the
 * change still sends; requests stored earlier keep the old wording.
 */
export const BOOKING_EXPERIENCE = [
  { value: "rookie", label: "Beginner" },
  { value: "warrior", label: "Intermediate" },
  { value: "beast", label: "Advanced" },
] as const;
export type BookingExperience = (typeof BOOKING_EXPERIENCE)[number]["value"];

/** Preferred days/times, used while live availability isn't connected. */
export const PREFERRED_DAYS = [
  { value: "mon", label: "Mon", long: "Monday" },
  { value: "tue", label: "Tue", long: "Tuesday" },
  { value: "wed", label: "Wed", long: "Wednesday" },
  { value: "thu", label: "Thu", long: "Thursday" },
  { value: "fri", label: "Fri", long: "Friday" },
  { value: "sat", label: "Sat", long: "Saturday" },
  { value: "sun", label: "Sun", long: "Sunday" },
] as const;
export type PreferredDay = (typeof PREFERRED_DAYS)[number]["value"];

export const PREFERRED_TIMES = [
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
] as const;
export type PreferredTime = (typeof PREFERRED_TIMES)[number]["value"];

export const ONLINE_GOALS = [
  { value: "strength", label: "Get stronger" },
  { value: "fitness", label: "Improve my fitness" },
  { value: "technique", label: "Learn kettlebell technique" },
  { value: "consistency", label: "Train consistently with a plan" },
  { value: "other", label: "Something else" },
] as const;
export type OnlineGoal = (typeof ONLINE_GOALS)[number]["value"];

export const ONLINE_EXPERIENCE = [
  { value: "new", label: "New to kettlebells" },
  { value: "some", label: "Some experience" },
  { value: "regular", label: "I train with kettlebells regularly" },
] as const;
export type OnlineExperience = (typeof ONLINE_EXPERIENCE)[number]["value"];

export const TRAINING_PLACES = [
  { value: "home", label: "At home" },
  { value: "gym", label: "In a gym" },
  { value: "both", label: "Both" },
] as const;
export type TrainingPlace = (typeof TRAINING_PLACES)[number]["value"];

export const CONTACT_METHODS = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "instagram", label: "Instagram" },
] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number]["value"];

export function labelFor<T extends { value: string; label: string }>(options: readonly T[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

/** "Mon, Wed and Sat" */
export function listLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
