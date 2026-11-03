import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { BILLING_WEEKS } from "@/content/memberships";
import { coachDb, isUuid } from "@/lib/coach/db";
import { formatLongDate, type DateKey } from "@/lib/coach/time";
import { SIGN_IN_PATH } from "@/lib/member-auth";
import { startSignupDirectDebit } from "../direct-debit-actions";
import { JOIN_DONE_PATH, signupStatus, type SignupStatus } from "@/lib/membership-checkout";
import { formatPenceShort } from "@/lib/membership";
import { referenceFor } from "@/lib/reference";
import { directDebitEnabled } from "@/lib/stripe/config";
import { pageMetadata } from "@/lib/metadata";
import { buttonClasses } from "@/components/ui/ButtonLink";
import { Confirmation, type ConfirmationStep } from "@/components/ui/Confirmation";
import { Section } from "@/components/ui/Section";
import { LiveStatus } from "@/components/ui/LiveStatus";
import { PendingButton } from "@/components/ui/PendingButton";

export const metadata: Metadata = pageMetadata({
  title: "Your membership",
  description: "Your RAENG Fitness membership after paying.",
  path: "/memberships/join/done",
  noindex: true,
});

/** How many times the page asks again, 3 seconds apart, before it stops waiting for Stripe's word on a Direct Debit. */
const MAX_TRIES = 15;

/**
 * Where Stripe's pages send people back to: after the card payment, and after
 * the Direct Debit page ("returned"). It only reads the sign-up's state from
 * the database, which changes once Stripe's verified webhook has been
 * recorded: arriving here proves nothing, so the page never says "paid" or "set
 * up" until the database does. While it waits it shows the confirming screen
 * and asks again by itself. Shows the plan and the state only (the id in the
 * address is random; no personal details are shown).
 */
export default async function JoinDonePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const params = await searchParams;
  const raw = params.signup;
  const id = typeof raw === "string" && isUuid(raw) ? raw : null;
  const db = coachDb();
  const signup = id && db ? await signupStatus(db, id) : null;
  const ddOn = directDebitEnabled();
  const returned = params.dd === "returned";
  const cancelled = params.cancelled === "1";
  const tries = Math.min(Math.max(Number(typeof params.n === "string" ? params.n : 0) || 0, 0), MAX_TRIES);
  // Waiting on Stripe: for the payment, or for the Direct Debit the member has just authorised.
  const waitingForPayment = signup?.status === "awaiting_payment" && !cancelled && tries < MAX_TRIES;
  const payGaveUp = signup?.status === "awaiting_payment" && !cancelled && tries >= MAX_TRIES;
  const waitingForDirectDebit = Boolean(returned && signup?.status === "active" && signup.dd !== "active" && tries < MAX_TRIES);
  // Direct Debit is offered on the confirmation as a next step with its own button, never opened by itself
  // (owner, 2026-11-03: read the confirmation first).
  const ddMessage = params.dd === "unavailable" ? "Sorry, the Direct Debit page couldn't be opened just now. Please try again in a minute." : null;
  return (
    <Section labelledBy="done-heading">
      {waitingForPayment ? <LiveStatus href={`${JOIN_DONE_PATH}?signup=${id}&n=${tries + 1}`} /> : null}
      {waitingForDirectDebit ? <LiveStatus href={`${JOIN_DONE_PATH}?signup=${id}&dd=returned&n=${tries + 1}`} /> : null}
      <div className="max-w-xl">
        <Body signup={signup} signupId={id} ddMessage={ddMessage} ddOn={ddOn} returned={returned} gaveUp={returned && tries >= MAX_TRIES} cancelled={cancelled} payGaveUp={payGaveUp} />
      </div>
    </Section>
  );
}

const date = (d: string | null) => (d ? formatLongDate(d as DateKey) : null);

function Body({
  signup,
  signupId,
  ddMessage,
  ddOn,
  returned,
  gaveUp,
  cancelled,
  payGaveUp,
}: {
  signup: SignupStatus | null;
  signupId: string | null;
  ddMessage: string | null;
  ddOn: boolean;
  returned: boolean;
  gaveUp: boolean;
  cancelled: boolean;
  payGaveUp: boolean;
}) {
  const heading = "mt-3 font-display text-h1 text-balance";
  if (!signup || signup.status === "replaced") {
    return (
      <div role="status">
        <p className="eyebrow">Memberships</p>
        <h1 id="done-heading" className={heading}>
          We couldn&apos;t find that sign-up.
        </h1>
        <p className="mt-5 text-lede">If you&apos;ve paid, you&apos;ll get an email from us shortly. Otherwise you can join again from the memberships page.</p>
        <Link href="/memberships" className={buttonClasses("action", "mt-8 w-full px-6 sm:w-auto")}>
          See memberships
        </Link>
      </div>
    );
  }
  const reference = signupId ? referenceFor(signupId) : null;
  if (signup.status === "awaiting_payment" && cancelled) {
    return (
      <Confirmation
        state="stopped"
        headingId="done-heading"
        eyebrow={`${signup.plan_name} membership`}
        title="Payment cancelled."
        lede="You haven't been charged and your membership hasn't started. You can go back and pay whenever you're ready."
        details={reference ? [["Reference", reference]] : undefined}
      >
        {signup.payUrl ? (
          <a href={signup.payUrl} className={buttonClasses("action", "w-full px-6 sm:w-auto")}>
            Go back and pay
          </a>
        ) : null}
        <Link href="/memberships" className={buttonClasses("secondary", "w-full px-6 sm:w-auto")}>
          See memberships
        </Link>
      </Confirmation>
    );
  }
  if (signup.status === "awaiting_payment" && payGaveUp) {
    return (
      <Confirmation
        state="waiting"
        headingId="done-heading"
        eyebrow={`${signup.plan_name} membership`}
        title="Still confirming your payment."
        lede="Stripe's confirmation is taking longer than usual. You don't need to wait here: if your payment went through, we'll email you as soon as your membership has started."
        details={reference ? [["Reference", reference]] : undefined}
      >
        <Link href={SIGN_IN_PATH} className={buttonClasses("action", "w-full px-6 sm:w-auto")}>
          Sign in to your account
        </Link>
      </Confirmation>
    );
  }
  if (signup.status === "awaiting_payment") {
    const steps: ConfirmationStep[] = [
      { label: "Payment sent to Stripe", status: "done" },
      { label: "Waiting for Stripe's confirmation", status: "active" },
      { label: "Starting your membership", status: "todo" },
    ];
    return (
      <Confirmation state="waiting" headingId="done-heading" eyebrow={`${signup.plan_name} membership`} title="Confirming your payment." lede="Stripe is confirming your card payment. This usually takes a few seconds, and this page updates by itself." steps={steps}>
        {signup.payUrl ? (
          <p>
            Didn&apos;t finish paying?{" "}
            <a href={signup.payUrl} className="font-semibold underline underline-offset-4 hover:no-underline">
              Go back to Stripe to pay
            </a>
          </p>
        ) : null}
      </Confirmation>
    );
  }
  if (signup.status === "needs_attention") {
    return (
      <div role="status">
        <p className="eyebrow">{signup.plan_name} membership</p>
        <h1 id="done-heading" className={heading}>
          Payment received.
        </h1>
        <p className="mt-5 text-lede">Thanks. Alex will finish setting up your membership and email you.</p>
      </div>
    );
  }

  const price = formatPenceShort(signup.price_pence);
  const next = date(signup.next_renewal);

  // Back from Stripe's bank page: confirming, then set up.
  if (returned && signup.dd === "active") {
    return (
      <Confirmation
        state="done"
        headingId="done-heading"
        eyebrow={`${signup.plan_name} membership`}
        title="Direct Debit set up."
        lede={`Your first ${BILLING_WEEKS} weeks are paid and your membership now continues by Direct Debit. We'll email you a confirmation.`}
        details={[
          ["Plan", signup.plan_name],
          ["Payment", `${price} every ${BILLING_WEEKS} weeks`],
          ["How", "Direct Debit"],
          ...(reference ? ([["Reference", reference]] as [string, string][]) : []),
          ...(next ? ([["Next payment", `Collected a few days before ${next}`]] as [string, string][]) : []),
        ]}
      >
        <p className="text-sm">Your Direct Debit is protected by the Direct Debit Guarantee. You can cancel your membership at any time from your account: you keep the credits you&apos;ve paid for until the end of the period.</p>
        <Link href={SIGN_IN_PATH} className={buttonClasses("action", "w-full px-6 sm:w-auto")}>
          Sign in to your account
        </Link>
      </Confirmation>
    );
  }
  if (returned && gaveUp) {
    return (
      <Confirmation
        state="waiting"
        headingId="done-heading"
        eyebrow={`${signup.plan_name} membership`}
        title="Still confirming your Direct Debit."
        lede="Stripe has your bank details, but its confirmation is taking longer than usual. You don't need to wait here: we'll email you as soon as it's confirmed. Until then your membership carries on and your card is the fallback."
      >
        <Link href={SIGN_IN_PATH} className={buttonClasses("action", "w-full px-6 sm:w-auto")}>
          Sign in to your account
        </Link>
      </Confirmation>
    );
  }
  if (returned) {
    return (
      <Confirmation
        state="waiting"
        headingId="done-heading"
        eyebrow={`${signup.plan_name} membership`}
        title="Confirming your Direct Debit."
        lede="Stripe is confirming your bank details. This usually takes a few seconds, and this page updates by itself."
        steps={[
          { label: "Bank details sent to Stripe", status: "done" },
          { label: "Waiting for Stripe's confirmation", status: "active" },
          { label: "Your Direct Debit is ready", status: "todo" },
        ]}
      />
    );
  }

  // The card payment is confirmed.
  const classDate = signup.class_date ? formatLongDate(signup.class_date as DateKey) : null;
  const lede =
    signup.first_class === "booked" && classDate
      ? `Your payment went through and your membership has started. Your first class is booked for ${classDate}.`
      : signup.first_class === "unavailable"
        ? "Your payment went through and your membership has started. Your first class couldn't be booked (it may have filled up), so please book another from your account."
        : "Your payment went through and your membership has started. Book your classes from your account.";
  return (
    <Confirmation
      state="done"
      headingId="done-heading"
      eyebrow={`${signup.plan_name} membership`}
      title="You're in."
      lede={lede}
      details={[
        ["Plan", signup.plan_name],
        ["Paid today", `${price}${signup.card ? ` by ${signup.card}` : " by card"}`],
        ["Class credits", `${signup.credits} every ${BILLING_WEEKS} weeks`],
        ...(next ? ([["Next payment", next]] as [string, string][]) : []),
        ...(reference ? ([["Reference", reference]] as [string, string][]) : []),
      ]}
    >
      {signup.dd === "active" ? (
        <div className="rounded-[1.25rem] bg-white p-5">
          <p className="font-semibold">Direct Debit is set up.</p>
          <p className="mt-1">
            Your membership continues every {BILLING_WEEKS} weeks and each payment is collected by Direct Debit. You can cancel at any time from your account: you keep the credits you&apos;ve paid for until the end of the period.
          </p>
        </div>
      ) : ddOn && signupId ? (
        <div className="rounded-[1.25rem] bg-white p-5">
          <p className="eyebrow">Next step</p>
          <p className="mt-1 font-semibold">Set up your Direct Debit.</p>
          <p className="mt-1">
            Your first {BILLING_WEEKS} weeks are paid. With a Direct Debit, each {BILLING_WEEKS} weeks after that is collected from your bank without you doing anything. Your bank details go straight to Stripe, not to us, and you can cancel at any time.
          </p>
          {ddMessage ? (
            <p role="alert" className="mt-3 font-semibold">
              {ddMessage}
            </p>
          ) : null}
          <form action={startSignupDirectDebit}>
            <input type="hidden" name="signup" value={signupId} />
            <PendingButton pendingLabel="Opening your bank page…" className={buttonClasses("action", "mt-4 w-full px-6 sm:w-auto")}>
              Set up Direct Debit
            </PendingButton>
          </form>
          <p className="mt-3 text-sm">
            {signup.card
              ? `Prefer to pay by card? There's nothing more to do: your ${signup.card} is charged automatically every ${BILLING_WEEKS} weeks, and we email you 5 days before each payment.`
              : "Until it's set up, we'll email you a payment link when your membership renews."}
          </p>
        </div>
      ) : signup.card ? (
        <div className="rounded-[1.25rem] bg-white p-5">
          <p className="font-semibold">Your membership renews automatically.</p>
          <p className="mt-1">
            Every {BILLING_WEEKS} weeks your {signup.card} is charged for the next period, and we email you 5 days before each payment. You can cancel at any time from your account: you keep the credits you&apos;ve paid for until the end of the period.
          </p>
        </div>
      ) : null}
      <Link href={SIGN_IN_PATH} className={buttonClasses(signup.dd !== "active" && ddOn && signupId ? "secondary" : signup.dd === "active" || signup.card ? "action" : "secondary", "w-full px-6 sm:w-auto")}>
        Sign in to your account
      </Link>
    </Confirmation>
  );
}
