import type { FaqItem } from "./types";
import { site } from "./site";
import { arriveEarlyNote, timetable } from "./classes";
import { describeTimetable } from "@/lib/schedule";

/**
 * Only questions with reliable answers. "beginners", "bring" and
 * "first-session" use industry-standard answers at the project owner's
 * request (2026-10-15); Alex should check them. Class length (60 minutes)
 * confirmed 2026-10-17.
 * Cancellations and capacity stay unanswered until Alex supplies them.
 */
export const faq: FaqItem[] = [
  {
    id: "where",
    question: "Where are classes held?",
    answer: `At ${site.location.venue}, ${site.location.street}, ${site.location.town}, ${site.location.postcode}.`,
    status: "confirmed",
  },
  {
    id: "when",
    question: "When are the group classes?",
    answer: `${describeTimetable(timetable.sessions)}.`,
    // Derived from classes.ts, so it inherits the timetable's status.
    status: timetable.status,
  },
  {
    id: "beginners",
    question: "Are classes suitable for beginners?",
    answer:
      "Yes. Every movement can be scaled to your level. Mention that you're new when you book and Alex will take you through the basics.",
    status: "confirmed",
  },
  {
    id: "first-session",
    question: "What happens at my first session?",
    answer:
      "Alex will ask about your goals and any injuries, teach you the key kettlebell movements and make sure your technique is solid before you go heavier.",
    status: "confirmed",
  },
  {
    id: "bring",
    question: "What should I bring?",
    answer:
      "Comfortable clothes you can move in, a water bottle and a small towel. Kettlebells are provided. Flat shoes or bare feet work best.",
    status: "confirmed",
  },
  {
    id: "arrive-early",
    question: "When should I arrive for a class?",
    answer: arriveEarlyNote,
    status: "confirmed",
  },
  {
    id: "length",
    question: "How long is a class?",
    answer: "60 minutes, including a warm-up.",
    status: "confirmed",
  },
  {
    id: "online",
    question: "Can I be coached if I don't live near Cumbernauld?",
    answer:
      "Yes. Online coaching gives you personalised programming, support and progression wherever you train.",
    status: "confirmed",
  },
  {
    id: "one-to-one",
    question: "Do you offer 1:1 personal coaching?",
    answer:
      "Yes. 1:1 coaching is face to face and tailored to you as an individual. When you request it you choose between a single session and a monthly package of four sessions. Alex then confirms availability with you.",
    status: "confirmed",
  },
  {
    id: "one-to-one-vs-small-group",
    question: "What's the difference between 1:1 and small group coaching?",
    answer:
      "1:1 coaching is individual, face-to-face coaching focused entirely on your goals, technique and progression. Small group coaching combines individual guidance with the motivation and energy of training alongside others. You can enquire about small group coaching on the booking page.",
    status: "confirmed",
  },
  {
    id: "contact",
    question: "What's the best way to get in touch?",
    answer: `Send a message on Instagram (${site.social.instagram.handle}).`,
    status: "confirmed",
  },
];
