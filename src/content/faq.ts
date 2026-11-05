import type { FaqItem } from "./types";
import { site } from "./site";

/**
 * Alex's requested questions only (his website changes, 2026-11-05: "Four to
 * six useful questions would be enough"): previous experience, what to bring,
 * how long a session is, where coaching takes place, and the difference
 * between 1:1 and small group coaching. His sixth, "Can I book with a
 * friend?", has no answer from him yet, so it is not here (never invented).
 * "beginners", "bring" and "length" are the earlier, owner-approved answers
 * (2026-10-15 / 2026-10-17); Alex should check them. The old questions on
 * times, first session, class size, refunds, 1:1 and contact were removed at
 * his request (the information is on /classes, /memberships and /contact).
 */
export const faq: FaqItem[] = [
  {
    id: "beginners",
    question: "Do I need previous kettlebell experience?",
    answer:
      "No. Every movement can be scaled to your level, so classes suit beginners and experienced lifters alike. Mention that you're new when you book and Alex will take you through the basics.",
    status: "confirmed",
  },
  {
    id: "bring",
    question: "What should I bring?",
    answer:
      "Comfortable clothes you can move in, a water bottle and a small towel. Kettlebells are provided. You can work out with bare feet or socks.",
    status: "confirmed",
  },
  {
    id: "length",
    question: "How long is each session?",
    answer: "Group classes are 60 minutes, including a warm-up.",
    status: "confirmed",
  },
  {
    id: "where",
    question: "Where does coaching take place?",
    // Without the venue name, as Alex asked for the location (2026-10-29): just the address.
    answer: `Classes and face-to-face coaching take place at ${site.location.street}, ${site.location.town}, ${site.location.postcode}.`,
    status: "confirmed",
  },
  {
    id: "one-to-one-vs-small-group",
    question: "What's the difference between 1:1 and small group coaching?",
    answer:
      "1:1 coaching is individual, face-to-face coaching focused entirely on your goals, technique and progression. Small group coaching combines individual guidance with the motivation and energy of training alongside others.",
    status: "confirmed",
  },
];

/** One answer by id, so pages quote the FAQ instead of repeating it. */
export function faqAnswer(id: string): string {
  const item = faq.find((f) => f.id === id);
  if (!item) throw new Error(`Unknown FAQ item: ${id}`);
  return item.answer;
}
