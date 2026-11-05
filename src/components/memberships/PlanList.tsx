import { isPublishable } from "@/lib/publish";
import { firstClassFree } from "@/content/offers";
import Link from "next/link";
import { BILLING_WEEKS, membershipPlans } from "@/content/memberships";
import { getService } from "@/content/services";
import { getPrimaryCtaFor } from "@/lib/booking";
import { onlineJoinEnabled } from "@/lib/membership-checkout";
import { extraCostPence, formatPenceShort, planFigures } from "@/lib/membership";
import { ChoiceCards, type Choice } from "@/components/ui/ChoiceCards";
import { ChoiceCover, choiceCard } from "@/components/ui/choice";
import { cn } from "@/lib/cn";

const payg = getService("group-classes").prices[0];

/**
 * The plans as rows between thin rules (card overhaul, owner 2026-10-26), with
 * each plan's rules set out as in Alex's plan layout: name and price, then
 * "4 class credits · £10 per class", then "Save £8" (the intro says it's against
 * pay as you go, owner 2026-10-27). Pay as you go last. Choose a row (it turns
 * ink), then the button (select, then continue, as everywhere on the site):
 * "Join <plan>" for a membership, "Book now" for pay as you go. Join opens the
 * membership journey (/memberships/join?plan=); Book now opens the class
 * calendar. Alex sets the membership up when he confirms. Every figure is
 * calculated from the price and credits (lib/membership.ts). Home and
 * /memberships share it.
 */
export function PlanList({ className, includePayg = true }: { className?: string; /** Pay as you go as a row of its own (/memberships); off where it has its own section (Alex's layout, 2026-10-29). */ includePayg?: boolean }) {
  const book = getPrimaryCtaFor("group-class");
  // Joining has its own journey (owner, 2026-10-26): plan, first class, details, terms. Where booking
  // goes to an outside page or isn't open, Join follows Book now instead.
  const online = onlineJoinEnabled();
  const planHref = (id: string) => (book.kind === "booking" && !book.external ? `/memberships/join?plan=${id}` : book.href);
  const choices: Choice[] = [
    ...membershipPlans.map((plan) => ({
      value: plan.id,
      label: `${plan.name} plan`,
      href: planHref(plan.id),
      action: `Join ${plan.name}`,
      next: online ? "Next, your first class and details, then pay with Stripe." : "Next, your first class and details. Nothing to pay now.",
      external: book.external,
    })),
    ...(includePayg ? [{ value: "payg", label: "Pay as you go", href: book.href, action: "Book now", external: book.external }] : []),
  ];
  // White cards (owner, 2026-10-30, like the class and FAQ cards): one card per plan, no rules; the chosen card turns ink. Join / Book now sits under the box, separate (owner, 2026-10-27).
  const row = cn("relative rounded-[1.25rem] border-[1.5px] border-transparent bg-white px-5 py-5", choiceCard);
  return (
    <ChoiceCards name="plan" legend="Choose a membership plan" choices={choices} prompt="Choose your plan to continue."
      className={cn("max-w-lg", className)}
    >
      <ul aria-label="Membership plans" className="relative flex flex-col gap-3">
        {membershipPlans.map((plan) => {
          const f = planFigures(plan, payg.amountGbp);
          return (
            <li key={plan.id} className={row}>
              <ChoiceCover
                name="plan"
                value={plan.id}
                label={`${plan.name}, £${plan.priceGbp} every ${BILLING_WEEKS} weeks, ${plan.credits} class credits, ${formatPenceShort(f.perClassPence)} per class, save ${formatPenceShort(f.savingPence)}, pay-as-you-go equivalent ${formatPenceShort(f.payAsYouGoPence)}`}
              />
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="card-title flex items-center gap-3 text-xl">
                  <PlanDot />
                  {plan.name}
                </h3>
                <p className="shrink-0 text-right tabular-nums">
                  <span className="text-2xl font-bold">£{plan.priceGbp}</span>
                  <span className="block text-sm">/ every {BILLING_WEEKS} weeks</span>
                </p>
              </div>
              <div className="mt-1 space-y-0.5 pl-8 text-[0.9375rem] lg:text-base">
                {/* "/ every 4 weeks" sits under each price (Alex via the owner, 2026-10-29), so the saving stands alone. */}
                <p>
                  {plan.credits} class credits · {formatPenceShort(f.perClassPence)} per class
                </p>
                {f.savingPence > 0 ? (
                  <p>
                    <span className="font-semibold">Save {formatPenceShort(f.savingPence)}</span>
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
        {includePayg ? (
          <li className={row}>
            <ChoiceCover name="plan" value="payg" label={`Pay as you go, £${payg.amountGbp} per class`} />
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="card-title flex items-center gap-3 text-xl">
                <PlanDot />
                Pay as you go
              </h3>
              <p className="shrink-0 text-2xl font-bold tabular-nums">£{payg.amountGbp}</p>
            </div>
            <p className="mt-1 pl-8 text-[0.9375rem] lg:text-base">No membership required. Pay for each booking.</p>
          </li>
        ) : null}
      </ul>
      {/* Alex's mockup: how the savings are worked out. */}
      <p className="mt-4 text-sm">
        Savings are calculated against paying £{payg.amountGbp} per class for the same number of bookings within {BILLING_WEEKS} weeks.
      </p>
    </ChoiceCards>
  );
}

/**
 * Pay as you go as a topic of its own (Alex's layout, 2026-10-29): the price and
 * no membership. No button: the class rows and the hero open the calendar.
 */
export function PayAsYouGo({ className }: { className?: string }) {
  const book = getPrimaryCtaFor("group-class");
  return (
    <div className={cn("max-w-lg", className)}>
      <p className="text-2xl font-bold tabular-nums">
        £{payg.amountGbp} <span className="text-base font-normal">a class</span>
      </p>
      <p className="mt-2">No membership required. Pay for each booking.</p>
      {isPublishable(firstClassFree.status) ? (
        <div className="mt-5 rounded-[1.25rem] bg-white px-5 py-4">
          <p className="font-bold">{firstClassFree.headline}.</p>
          <p className="mt-1">{firstClassFree.line}</p>
          <p className="mt-2">{firstClassFree.how}</p>
          {book.kind === "booking" && !book.external ? (
            <Link href={book.href} className="mt-1 inline-flex min-h-11 items-center font-semibold underline underline-offset-4 hover:no-underline">
              Book your free class
            </Link>
          ) : null}
          <p className="mt-1 text-sm">{firstClassFree.terms}</p>
        </div>
      ) : null}
    </div>
  );
}

/** The row's choice mark: an empty circle, filled once the row is chosen, so the rows read as tappable. */
function PlanDot() {
  return (
    <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-current"><span className="size-2.5 scale-0 rounded-full bg-current motion-safe:transition-transform group-has-[:checked]/choice:scale-100" /></span>
  );
}

/**
 * The membership terms, kept off the page (Alex via the owner, 2026-10-29): a
 * "Membership terms" label with one link to the full membership and
 * cancellation policy on /memberships (content/policy.ts), so the page stays
 * short and nothing is hidden.
 */
export function PlanTerms({ className }: { className?: string }) {
  return (
    <div className={cn("text-[0.9375rem] lg:text-base", className)}>
      <h3 className="eyebrow mb-1">Membership terms</h3>
      <Link href="/memberships#membership-terms" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4 hover:no-underline">
        Membership and cancellation policy
      </Link>
    </div>
  );
}

/**
 * What pay as you go costs on top of each plan (owner, 2026-10-23). Secondary:
 * on /memberships only, behind a plain "what it costs on top" link so the page
 * stays light (owner, 2026-10-27), and without rules between the rows.
 */
export function PaygExtra({ className }: { className?: string }) {
  return (
    <details className={cn("group max-w-lg", className)}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center font-semibold underline underline-offset-4 hover:no-underline [&::-webkit-details-marker]:hidden">
        What pay as you go costs on top
      </summary>
      <div className="pt-2">
        <p id="payg-extra" className="text-sm">
          What you&apos;d pay on top, going pay as you go instead of each plan, using every credit.
        </p>
        <table aria-labelledby="payg-extra" className="mt-4 w-full text-sm tabular-nums">
          <thead>
            <tr>
              <th scope="col" className="py-2 text-left font-normal">
                <span className="sr-only">Plan</span>
              </th>
              <th scope="col" className="py-2 text-right font-normal">
                Week
              </th>
              <th scope="col" className="py-2 text-right font-normal">
                {BILLING_WEEKS} weeks
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                Year
              </th>
            </tr>
          </thead>
          <tbody>
            {membershipPlans.map((plan) => {
              const x = extraCostPence(plan, payg.amountGbp);
              return (
                <tr key={plan.id}>
                  <th scope="row" className="py-2 text-left font-normal">
                    {plan.name}
                  </th>
                  <td className="py-2 text-right">{formatPenceShort(x.week)}</td>
                  <td className="py-2 text-right">{formatPenceShort(x.period)}</td>
                  <td className="py-2 text-right font-semibold">{formatPenceShort(x.year)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
