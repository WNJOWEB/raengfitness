import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { BILLING_WEEKS } from "@/content/memberships";
import { coachDb, isUuid } from "@/lib/coach/db";
import { formatLongDate, type DateKey } from "@/lib/coach/time";
import { SIGN_IN_PATH } from "@/lib/member-auth";
import { startSignupDirectDebit } from "../direct-debit-actions";
import { signupStatus, type SignupStatus } from "@/lib/membership-checkout";
import { directDebitEnabled } from "@/lib/stripe/config";
import { pageMetadata } from "@/lib/metadata";
import { buttonClasses } from "@/components/ui/ButtonLink";
import { Section } from "@/components/ui/Section";

export const metadata: Metadata = pageMetadata({
  title: "Your membership",
  description: "Your RAENG Fitness membership after paying.",
  path: "/memberships/join/done",
  noindex: true,
});

/**
 * Where Stripe's payment page sends people back to. It only reads the
 * sign-up's state from the database, which changes once Stripe's verified
 * webhook has recorded the payment: arriving here proves nothing, so the page
 * never says "paid" until the database does. While it waits, it refreshes
 * itself every few seconds. Shows the plan and the state only (the id in the
 * address is random; no personal details are shown).
 */
export default async function JoinDonePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const raw = (await searchParams).signup;
  const id = typeof raw === "string" && isUuid(raw) ? raw : null;
  const db = coachDb();
  const signup = id && db ? await signupStatus(db, id) : null;
  const params = await searchParams;
  const ddMessage = params.dd === "unavailable" ? "Sorry, the Direct Debit page couldn't be opened just now. Please try again in a minute." : null;
  return (
    <Section labelledBy="done-heading">
      {signup?.status === "awaiting_payment" ? <meta httpEquiv="refresh" content="4" /> : null}
      <div className="max-w-xl" role="status">
        <Body signup={signup} signupId={id} ddMessage={ddMessage} directDebitOffered={directDebitEnabled()} />
      </div>
    </Section>
  );
}

function Body({ signup, signupId, ddMessage, directDebitOffered }: { signup: SignupStatus | null; signupId: string | null; ddMessage: string | null; directDebitOffered: boolean }) {
  const heading = "mt-3 font-display text-h1 text-balance";
  if (!signup || signup.status === "replaced") {
    return (
      <>
        <p className="eyebrow">Memberships</p>
        <h1 id="done-heading" className={heading}>
          We couldn&apos;t find that sign-up.
        </h1>
        <p className="mt-5 text-lede">If you&apos;ve paid, you&apos;ll get an email from us shortly. Otherwise you can join again from the memberships page.</p>
        <Link href="/memberships" className={buttonClasses("action", "mt-8 w-full px-6 sm:w-auto")}>
          See memberships
        </Link>
      </>
    );
  }
  if (signup.status === "awaiting_payment") {
    return (
      <>
        <p className="eyebrow">{signup.plan_name} membership</p>
        <h1 id="done-heading" className={heading}>
          Waiting for Stripe to confirm.
        </h1>
        <p className="mt-5 text-lede">This usually takes a few seconds. This page updates by itself.</p>
        {signup.payUrl ? (
          <p className="mt-6">
            Didn&apos;t finish paying?{" "}
            <a href={signup.payUrl} className="font-semibold underline underline-offset-4 hover:no-underline">
              Go back to Stripe to pay
            </a>
          </p>
        ) : null}
      </>
    );
  }
  if (signup.status === "needs_attention") {
    return (
      <>
        <p className="eyebrow">{signup.plan_name} membership</p>
        <h1 id="done-heading" className={heading}>
          Payment received.
        </h1>
        <p className="mt-5 text-lede">Thanks. Alex will finish setting up your membership and email you.</p>
      </>
    );
  }
  const classDate = signup.class_date ? formatLongDate(signup.class_date as DateKey) : null;
  return (
    <>
      <p className="eyebrow">{signup.plan_name} membership</p>
      <h1 id="done-heading" className={heading}>
        You&apos;re in.
      </h1>
      <p className="mt-5 text-lede">
        {signup.first_class === "booked" && classDate
          ? `Your payment went through and your membership has started. Your first class is booked for ${classDate}.`
          : signup.first_class === "unavailable"
            ? "Your payment went through and your membership has started. Your first class couldn't be booked (it may have filled up), so please book another from your account."
            : "Your payment went through and your membership has started. Book your classes from your account."}
      </p>
      {signup.dd === "active" ? (
        <div className="mt-6 rounded-[1.25rem] bg-white p-5">
          <p className="font-semibold">Direct Debit is set up.</p>
          <p className="mt-1">
            Your membership continues every {BILLING_WEEKS} weeks and each payment is collected by Direct Debit. You can cancel at any time from your account: you keep the credits you&apos;ve paid for until the end of the period.
          </p>
        </div>
      ) : directDebitOffered && signupId ? (
        <div className="mt-6 rounded-[1.25rem] bg-white p-5">
          <p className="font-semibold">Set up your Direct Debit.</p>
          <p className="mt-1">
            Your first {BILLING_WEEKS} weeks are paid. Set up a Direct Debit now and your membership continues every {BILLING_WEEKS} weeks without you doing anything. Your bank details go straight to Stripe, not to us. You can cancel at any time.
          </p>
          {ddMessage ? (
            <p role="alert" className="mt-3 font-semibold">
              {ddMessage}
            </p>
          ) : null}
          <form action={startSignupDirectDebit}>
            <input type="hidden" name="signup" value={signupId} />
            <button type="submit" className={buttonClasses("action", "mt-4 w-full px-6 sm:w-auto")}>
              Set up Direct Debit
            </button>
          </form>
          <p className="mt-3 text-sm">
            {signup.card
              ? `Prefer to pay by card? There's nothing more to do: your ${signup.card} is charged automatically every ${BILLING_WEEKS} weeks, and we email you 5 days before each payment.`
              : "Until it's set up, we'll email you a payment link when your membership renews."}
          </p>
        </div>
      ) : signup.card ? (
        <div className="mt-6 rounded-[1.25rem] bg-white p-5">
          <p className="font-semibold">Your membership renews automatically.</p>
          <p className="mt-1">
            Every {BILLING_WEEKS} weeks your {signup.card} is charged for the next period, and we email you 5 days before each payment. You can cancel at any time from your account: you keep the credits you&apos;ve paid for until the end of the period.
          </p>
        </div>
      ) : null}
      <Link href={SIGN_IN_PATH} className={buttonClasses(signup.dd === "active" || signup.card ? "action" : "secondary", "mt-6 w-full px-6 sm:w-auto")}>
        Sign in to your account
      </Link>
    </>
  );
}
