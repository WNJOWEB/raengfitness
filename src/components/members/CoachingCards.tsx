import { usesCredits } from "@/lib/member-view";
import Link from "next/link";
import { getOnlineCoachingAction } from "@/lib/booking";
import { COACHING_MESSAGES_PATH, COACHING_PATH, COACHING_UNLOCK_PATH, onlineCoachingPrice, type CoachingStatus } from "@/lib/coaching";
import { formatPenceShort } from "@/lib/membership";
import type { MemberOverview } from "@/lib/member-auth";
import { Icon } from "./icons";

/**
 * The Raeng Coaching card (owner's members design, 2026-10-28). For online
 * coaching clients it opens the coaching area (their week, and any new
 * message); for everyone else it opens the unlock page. Home puts the client's
 * card under the next class and the other at the bottom, so it never pushes
 * booking down; the menu drawer shows the small one.
 */
export function CoachingCard({ coaching, small = false, className = "" }: { coaching: CoachingStatus; small?: boolean; className?: string }) {
  const price = onlineCoachingPrice();
  if (coaching.active) {
    const p = coaching.programme;
    return (
      <Link
        href={COACHING_PATH}
        className={`flex flex-col gap-1.5 rounded-3xl border-[1.5px] border-grey bg-ink text-paper ${small ? "rounded-[20px] px-4.5 py-4" : "p-5.5"} ${className}`}
      >
        <span className="inline-flex items-center gap-2 text-[0.6875rem] font-semibold tracking-[0.2em] uppercase">
          <Icon name="coach" className="size-[18px] fill-none stroke-current stroke-[1.7]" />
          Raeng Coaching
        </span>
        <span className={`${small ? "text-lg" : "text-2xl"} font-extrabold tracking-[-0.02em]`}>{p ? `Week ${p.week} of ${p.weeks}` : "Your programme"}</span>
        <span className="text-sm">
          {p ? p.name : "Alex is writing your programme."}
          {coaching.unread > 0 && !small ? ` · ${coaching.unread} new message${coaching.unread === 1 ? "" : "s"}` : ""}
        </span>
        {small ? null : (
          <span className="mt-2 flex items-center justify-between font-semibold">
            <span>{p ? "Open today's session" : "Open coaching"}</span>
            <span aria-hidden="true">→</span>
          </span>
        )}
      </Link>
    );
  }
  return (
    <Link href={COACHING_UNLOCK_PATH} className={`flex flex-col gap-1.5 border-[1.5px] border-ink ${small ? "rounded-[20px] px-4.5 py-4" : "rounded-3xl p-5.5"} ${className}`}>
      <span className="inline-flex items-center gap-2 text-[0.6875rem] font-semibold tracking-[0.2em] uppercase">
        <Icon name="coach" className="size-[18px] fill-none stroke-current stroke-[1.7]" />
        Raeng Coaching
      </span>
      <span className={`${small ? "text-lg" : "text-2xl"} font-extrabold tracking-[-0.02em]`}>{small ? "Unlock coaching" : "Train with Alex, wherever you are."}</span>
      <span className="text-sm">{small ? (price ? `£${price} a month` : "Online coaching with Alex") : "Your own programme, demo links and weekly check-ins."}</span>
      {small ? null : (
        <span className="mt-2 flex items-center justify-between font-semibold">
          <span className="inline-flex items-center gap-2">
            <Icon name="lock" className="size-[18px] fill-none stroke-current stroke-[1.7]" />
            Unlock coaching
          </span>
          {price ? <span className="text-sm font-medium">£{price} a month</span> : null}
        </span>
      )}
    </Link>
  );
}

/**
 * The Plan tab's coaching section. A client sees what they have (their own
 * subscription's plan and price from the database, and where they are in the
 * programme). Anyone else sees what coaching adds to what they have today,
 * side by side, with the published price.
 */
export function PlanCoaching({ coaching, overview: o }: { coaching: CoachingStatus; overview: MemberOverview }) {
  if (coaching.active) {
    const p = coaching.programme;
    return (
      <section aria-labelledby="plan-coaching-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="plan-coaching-heading" className="members-eyebrow">
            Coaching
          </h2>
          <Link href={COACHING_PATH} className="members-link">
            Open<span className="sr-only"> coaching</span>
          </Link>
        </div>
        <dl className="border-t border-line">
          {(
            [
              [coaching.plan, `${formatPenceShort(coaching.price_pence)} a month`],
              ["Programme", p ? `${p.name} · week ${p.week} of ${p.weeks}` : "Being written"],
              ["Coach", "Alex"],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-line py-3.5">
              <dt>{k}</dt>
              <dd className="min-w-0 text-right font-semibold [overflow-wrap:anywhere]">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }
  const price = onlineCoachingPrice();
  // A cancelled membership with nothing left to use reads as pay as you go (owner, 2026-11-03).
  const m = usesCredits(o) ? o.membership : null;
  const have = m ? [`${m.credits} classes`, "Booking app"] : ["Pay as you go classes", "Booking app"];
  const enquiry = getOnlineCoachingAction();
  return (
    <section aria-labelledby="add-coaching-heading" className="flex flex-col gap-3">
      <h2 id="add-coaching-heading" className="members-eyebrow">
        Add coaching
      </h2>
      <div className="grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5 rounded-[20px] border-[1.5px] border-line p-4">
          <span className="text-[0.625rem] font-bold tracking-[0.2em] uppercase">You have</span>
          <span className="text-lg font-extrabold tracking-[-0.02em]">{m ? m.plan_name : "Pay as you go"}</span>
          {m ? <span className="text-sm">{formatPenceShort(m.price_pence)} every 4 weeks</span> : null}
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {have.map((t) => (
              <li key={t}>✓ {t}</li>
            ))}
            {["Programme", "Demo links", "Check-ins"].map((t) => (
              <li key={t}>– {t}</li>
            ))}
          </ul>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 rounded-[20px] border-[1.5px] border-ink bg-ink p-4 text-paper">
          <span className="text-[0.625rem] font-bold tracking-[0.2em] uppercase">Raeng Coaching</span>
          <span className="text-lg font-extrabold tracking-[-0.02em]">Add coaching</span>
          {price ? <span className="text-sm">+£{price} a month</span> : null}
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {["Your classes", "Booking app", "Programme", "Demo links", "Check-ins", "Message Alex"].map((t) => (
              <li key={t}>✓ {t}</li>
            ))}
          </ul>
        </div>
      </div>
      <Link href={COACHING_UNLOCK_PATH} className="members-btn members-btn-solid w-full sm:w-auto">
        See coaching
      </Link>
      <p className="text-sm">
        Questions first? <a href={enquiry.href} className="underline underline-offset-4">Enquire about online coaching</a>.
      </p>
    </section>
  );
}

/** A link to Messages with its unread count, for the coaching pages. */
export function MessagesLink({ unread }: { unread: number }) {
  return (
    <Link href={COACHING_MESSAGES_PATH} className="members-link">
      Messages{unread > 0 ? ` (${unread} new)` : ""}
    </Link>
  );
}
