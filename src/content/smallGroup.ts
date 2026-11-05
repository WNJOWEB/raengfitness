/**
 * Small group coaching: one of the three things Alex offers (group kettlebell
 * classes, 1:1 coaching and small group coaching). Copy supplied by Alex in
 * his website changes (2026-11-05). He has not supplied a price, group size,
 * times or duration, so none is shown: the page says pricing and availability
 * are shared on enquiry. Add them here when he does.
 */
export const smallGroupCoaching = {
  name: "Small group coaching",
  summary: "Small group kettlebell coaching combining individual guidance with the motivation and energy of training alongside others.",
  /** The enquiry (an enquiry only, never a booking). */
  href: "/book/small-group",
  askLabel: "Enquire about availability",
  heading: "Train together. Progress individually.",
  benefits: [
    { title: "Individual guidance", body: "Coaching and technique feedback, even in a group." },
    { title: "Motivation and energy", body: "Train alongside others in a supportive environment." },
    { title: "Structure", body: "Structured strength and conditioning, week to week." },
  ],
  /** "What to expect". */
  included: [
    "Small, focused training groups",
    "Coaching and technique feedback",
    "Structured strength and conditioning",
    "A supportive training environment",
  ],
  pricing: "Pricing and availability are shared when you enquire. Submitting an enquiry does not guarantee a place.",
} as const;
