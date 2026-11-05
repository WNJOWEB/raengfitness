import type { Service } from "./types";

/**
 * Coaching offers. Descriptions use only previously published wording.
 * Prices confirmed by the project owner on 2026-10-15 (the figures from the
 * original brief); the group class price (£10 per person) on 2026-10-17.
 */
export const services: Service[] = [
  {
    id: "group-classes",
    name: "Group classes",
    shortName: "Classes",
    href: "/classes",
    summary:
      "Coached group kettlebell sessions at Media House in Cumbernauld.",
    points: [],
    prices: [
      {
        status: "confirmed",
        label: "Per class",
        amountGbp: 10,
        unit: "per person",
      },
    ],
  },
  {
    id: "one-to-one",
    name: "1:1 personal coaching",
    shortName: "One-to-one",
    href: "/coaching#one-to-one",
    summary:
      "Personalised, face-to-face kettlebell coaching, tailored to you as an individual.",
    points: [
      "Face-to-face sessions with Alex",
      "Coaching tailored to the individual",
    ],
    // Single £35 and monthly £130 (4 sessions) restated by the owner
    // 2026-11-05; the single session is now a flat £35, no longer "from".
    prices: [
      {
        status: "confirmed",
        label: "Single 1:1 session",
        amountGbp: 35,
        unit: "per session",
        description: "One personalised, face-to-face coaching session.",
      },
      {
        status: "confirmed",
        label: "Monthly package",
        amountGbp: 130,
        unit: "per month · 4 sessions",
        description: "Four personalised coaching sessions each month, providing consistency, structure and progression.",
      },
    ],
  },
  {
    id: "online-coaching",
    name: "Online coaching",
    shortName: "Online",
    href: "/coaching#online",
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

export function getService(id: Service["id"]): Service {
  const service = services.find((s) => s.id === id);
  if (!service) throw new Error(`Unknown service: ${id}`);
  return service;
}
