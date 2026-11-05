/**
 * Copy for the /coaching page: 1:1 personal coaching and small group
 * coaching. Wording supplied by Alex in "RAENG Website Changes"
 * (2026-11-05), plus reworded cards and "what's included" boxes drafted from
 * it. Nothing here states a price, capacity, duration or qualification:
 * prices live in services.ts. Alex to review the drafted cards.
 */

export const coachingIntro =
  "Personalised, face-to-face kettlebell coaching designed around your goals, experience and ability. Build strength, develop your technique and become more confident with every session.";

export interface InfoCard {
  title: string;
  body: string;
}

export const oneToOne = {
  heading: "Attention That Stays on You",
  intro:
    "Whether you’re new to kettlebells or looking to take your training further, get individual coaching focused on your goals, technique and progression.",
  /** The three information cards. */
  cards: [
    { title: "Strength", body: "Build strength at your own pace, with training that progresses alongside you." },
    { title: "Technique", body: "Develop proper technique with coaching and feedback throughout every session." },
    { title: "Movement", body: "Improve how you move, build confidence and develop a stronger foundation." },
  ] satisfies InfoCard[],
  /** The three "What's included" boxes. */
  included: [
    {
      title: "Personalised coaching",
      body: "Dedicated face-to-face sessions focused on your individual goals and development.",
    },
    {
      title: "Technique and development",
      body: "Learn and refine key kettlebell movements with guidance and feedback.",
    },
    {
      title: "Structured progression",
      body: "Build on each session with a clear focus on improving strength, fitness and confidence.",
    },
  ] satisfies InfoCard[],
  /** Shown above the two prices. */
  pricingIntro: "Choose the option that suits you when you request 1:1 coaching.",
};

export const smallGroup = {
  eyebrow: "Small group coaching",
  heading: "Train together. Progress individually.",
  intro:
    "Small group kettlebell coaching combining individual guidance with the motivation and energy of training alongside others.",
  /** Benefits: what it is like to train this way. */
  benefits: [
    { title: "Individual guidance", body: "Coaching and technique feedback, even in a group." },
    { title: "Motivation and energy", body: "Train alongside others in a supportive environment." },
    { title: "Structure", body: "Structured strength and conditioning, week to week." },
  ] satisfies InfoCard[],
  /** "What to expect" / what's included. */
  included: [
    "Small, focused training groups",
    "Coaching and technique feedback",
    "Structured strength and conditioning",
    "A supportive training environment",
  ],
  /** No price has been confirmed for small group coaching, so none is shown. */
  pricing:
    "Pricing and availability are shared when you enquire. Submitting an enquiry does not guarantee a place.",
  cta: "Enquire about availability",
};

/** Wording for "when suits you?" on every request that picks days and times (Alex, 2026-11-05). */
export const availabilityWording =
  "Select the days and times that work best for you. Once submitted, Alex will review your request and get back to you to confirm availability and discuss suitable dates and times. Please note that submitting a request does not guarantee a booking.";
