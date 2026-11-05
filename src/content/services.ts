import type { Service } from "./types";

/**
 * Coaching offers. Descriptions use only previously published wording.
 * Prices confirmed by the project owner on 2026-10-15 (the figures from the
 * original brief; restated 2026-11-05 as a single £35 session or a £130 monthly package of 4 sessions); the group class price (£10 per person) on 2026-10-17, raised to £12 per class by the owner on 2026-10-21 (memberships brief).
 */
export const services: Service[] = [
  {
    id: "group-classes",
    name: "Group classes",
    shortName: "Classes",
    href: "/classes",
    summary:
      "Coached group kettlebell sessions in Cumbernauld.",
    points: [],
    prices: [
      {
        status: "confirmed",
        label: "Per class",
        amountGbp: 12,
        unit: "per person",
      },
    ],
  },
  {
    id: "one-to-one",
    name: "1:1 personal coaching",
    shortName: "1:1",
    href: "/coaching/one-to-one",
    summary:
      "Face-to-face kettlebell coaching, tailored to you as an individual.",
    points: [
      "Face-to-face sessions with Alex",
      "Coaching tailored to the individual",
    ],
    prices: [
      {
        status: "confirmed",
        label: "Single 1:1 session",
        amountGbp: 35,
        unit: "per session",
        sessions: 1,
        description: "One personalised, face-to-face coaching session.",
      },
      {
        status: "confirmed",
        label: "Monthly package",
        amountGbp: 130,
        unit: "per month",
        sessions: 4,
        description: "Four personalised coaching sessions each month, providing consistency, structure and progression.",
      },
    ],
  },
  {
    id: "online-coaching",
    name: "Online coaching",
    shortName: "Online",
    href: "/online-coaching",
    summary:
      "Personalised kettlebell programming with ongoing support and progression, wherever you train.",
    points: ["Personalised programming", "Ongoing support", "Progression"],
    prices: [
      {
        status: "confirmed",
        label: "Monthly",
        amountGbp: 79,
        unit: "per month",
      },
    ],
  },
];

/**
 * Whether online coaching is sold (Alex, 2026-10-29: removed "for now", he'll
 * "come into it at a later time"). Off: the public pages redirect to Coaching,
 * members who don't have it see no "Unlock coaching" cards, and members who
 * already have it keep their coaching area. Switch on, and restore the
 * /online-coaching redirects (next.config.ts) and routes, when it returns.
 */
export const onlineCoachingOffered = false;

export function getService(id: Service["id"]): Service {
  const service = services.find((s) => s.id === id);
  if (!service) throw new Error(`Unknown service: ${id}`);
  return service;
}
