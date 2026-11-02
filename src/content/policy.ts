import { getService } from "./services";

/**
 * Membership terms and the class cancellation policy, supplied by the owner
 * on 2026-10-21 and published as written. Change the wording here only on
 * the owner's say-so.
 */
export const membershipTerms = [
  "Class credits can be used across any available Monday, Wednesday or Saturday class.",
  "Memberships renew automatically every four weeks, with new credits allocated on renewal.",
  "Unused credits expire at the end of each membership period and do not roll over.",
  `Additional classes can be purchased for £${getService("group-classes").prices[0].amountGbp}, subject to availability.`,
  "All bookings and cancellations are subject to the class cancellation policy.",
] as const;

export const cancellationPolicy = {
  intro:
    "We understand that plans can change. To ensure fairness to all members and allow others the opportunity to book available spaces, the following cancellation policy applies.",
  cancellations: [
    {
      when: "24 hours or more before class",
      outcome:
        "Your class credit will be returned to your account, allowing you to book another session within your current membership period.",
    },
    { when: "Less than 24 hours before class", outcome: "Your class credit will be forfeited." },
    {
      when: "No-shows",
      outcome: "Failure to attend a booked class without cancelling will result in the credit being forfeited.",
    },
  ],
  credits:
    "Returned credits must be used within your current four-week membership period. Unused credits expire at the end of the membership period and cannot be carried over.",
  coachCancellations:
    "If a class is cancelled by the coach, your credit will be returned to your account or an alternative session will be offered. If you paid for that class by card and can't make another date, we'll refund your payment to your card.",
  /** Refunds (Alex's choice B, via the owner, 2026-11-02): no cash refunds, except these. */
  refunds:
    "We don't give cash refunds for late cancellations, missed classes or a membership period that has started. If we cancel a class you paid for and you can't make another date, we refund it to your card, and a payment taken in error is always refunded.",
  agreement: "By booking a class, you agree to these cancellation terms.",
  thanks: "Thank you for your understanding and cooperation.",
} as const;

/**
 * The four conditions a customer must see before committing to a membership,
 * in short form (the full wording is above and on /memberships).
 */
export const membershipKeyFacts = [
  { title: "Renews automatically", body: "Every four weeks, with new credits each time." },
  { title: "Credits expire", body: "Unused credits don't roll over to the next period." },
  { title: "Cancel 24 hours ahead", body: "Cancel 24 hours or more before class and your credit is returned." },
  { title: "Late or no-show", body: "Under 24 hours' notice, or not turning up, forfeits the credit." },
] as const;

/**
 * Membership terms in Alex's mockup wording (via the owner, 2026-10-29), shown
 * on /memberships. His "Membership cancellation" block was placeholder text, so
 * the owner wrote how it works (2026-10-30): `membershipCancellation` below.
 */
export const membershipTermsAlex = {
  title: "Membership terms",
  intro: "Everything you need to know about using your class credits.",
  items: [
    { title: "Using your credits", body: "One class credit is used for each class booking. Your remaining balance should be visible in your booking account." },
    { title: "Four-week renewal", body: "Memberships renew automatically every four weeks, with a new allocation of class credits." },
    { title: "Unused credits", body: "Unused credits expire at the end of your four-week membership period and do not roll over." },
    { title: "Cancellations", body: "Cancel a class at least 24 hours before the session to have your credit returned. Late cancellations and missed classes forfeit the credit." },
  ],
} as const;

/**
 * How cancelling a membership works (owner, 2026-10-30, the way the big gyms do
 * it; payment by saved card from 2026-11-02, like Spotify): the first four weeks
 * are paid by card, which is kept (the member agrees on Stripe's page), and each
 * four weeks after that is charged to it on the day the period starts, until
 * the member cancels. A reminder is emailed 5 days before each payment.
 */
export const membershipCancellation = {
  title: "Membership cancellation",
  lines: [
    "You can cancel your membership at any time from your account, or by messaging Alex.",
    "Your first four weeks are paid by card, which we save with your agreement. After that your membership renews automatically every four weeks, and the payment is taken on the day the new period starts, until you cancel. We email you 5 days before each payment, so cancel before then to stop the next one.",
    "Once a period is paid you get its credits and keep them until the period ends. Cancelling stops further payments and new periods; it doesn't refund a period you've already paid for.",
  ],
} as const;

/**
 * The participation and risk disclaimer ticked before every booking (owner,
 * 2026-10-30, written 2026-10-31). A draft in the usual form for UK fitness
 * classes: it should be read by a solicitor and checked against RAENG's
 * insurance before it is relied on. In Scotland and the rest of the UK a
 * business cannot exclude or limit liability for death or personal injury
 * caused by its own negligence (Unfair Contract Terms Act 1977; Consumer
 * Rights Act 2015), so it says it does not try to; what it does is record
 * that the person is fit to take part, knows the risks, agrees to follow the
 * coach, and is responsible for their own belongings and choices. Change
 * `version` whenever the wording changes: it is stored with each acceptance.
 */
export const classWaiver = {
  version: "2026-10-31",
  title: "Health and risk terms",
  intro: "Please read this before you book. It is about keeping you safe and being clear who is responsible for what. It does not take away any rights you have under the law.",
  points: [
    {
      title: "Your health",
      body: "I am in good health and fit to take part in exercise. I have no medical condition, injury, pregnancy or other reason that would make exercise unsafe for me, or I have checked with my doctor and they are happy for me to train. I will tell the coach before a class if that changes or if I feel unwell.",
    },
    {
      title: "The risks",
      body: "I understand kettlebell and conditioning training is physically demanding and carries a risk of injury, such as muscle and joint strains, bruises and falls and, rarely, more serious injury, including from equipment and other people. I am taking part voluntarily and I accept the normal risks of exercise.",
    },
    {
      title: "Following the coach",
      body: "I will follow the coach's instructions, use equipment as shown, work at my own level, and stop and say if something hurts or I feel unwell. I can scale or skip any exercise. The coach can ask me to stop or leave if I or others are at risk.",
    },
    {
      title: "Looking after each other and the space",
      body: "I will keep the space clear, treat the equipment and venue with care, and respect other people in the class.",
    },
    {
      title: "If something happens",
      body: "If I am hurt or unwell, I agree the coach can arrange first aid or call the emergency services for me.",
    },
    {
      title: "Belongings",
      body: "I am responsible for my own belongings. RAENG is not responsible for them being lost or damaged, unless the law says otherwise.",
    },
    {
      title: "Responsibility",
      body: "RAENG will take reasonable care of me during classes and sessions. Nothing here limits or excludes RAENG's responsibility for death or personal injury caused by its negligence, for fraud, or for anything else the law does not allow to be limited. Otherwise, RAENG is not responsible for injury, loss or damage caused by my own actions, by my not following instructions, by a health condition I have not told the coach about, or by events outside RAENG's reasonable control.",
    },
  ],
  tick: "I've read and agree to the health and risk terms (tap the title to read them), and I'm fit to take part.",
  error: "Please tick to confirm you have read and agree to the health and risk terms.",
} as const;
