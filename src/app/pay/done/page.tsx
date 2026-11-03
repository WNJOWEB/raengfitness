import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { coachDb, isUuid } from "@/lib/coach/db";
import { formatPence } from "@/lib/coach/money";
import { formatLongDate, type DateKey } from "@/lib/coach/time";
import { SIGN_IN_PATH } from "@/lib/member-auth";
import { chargeLinkStatus, PAY_DONE_PATH, type ChargeLinkStatus } from "@/lib/stripe/sync";
import { pageMetadata } from "@/lib/metadata";
import { buttonClasses } from "@/components/ui/ButtonLink";
import { Confirmation, type ConfirmationStep } from "@/components/ui/Confirmation";
import { Section } from "@/components/ui/Section";

export const metadata: Metadata = pageMetadata({
  title: "Your payment",
  description: "Your RAENG Fitness payment.",
  path: "/pay/done",
  noindex: true,
});

/** How many times the page asks again, 4 seconds apart, before it stops waiting and says it will email. */
const MAX_TRIES = 15;

/**
 * Where Stripe's payment page sends someone who paid a payment link: one Alex
 * sent from the coach portal, or a membership renewal link (the email, or the
 * "Payment due" card in the account). With `cancelled=1` it is where Stripe's
 * back arrow lands. It only reads the link's state from the database, which
 * changes once Stripe's verified webhook has recorded the payment: arriving
 * here proves nothing, so "Payment received" appears only when the database
 * says so. It shows the amount, what it was for, the reference and the date,
 * nothing about the person (the id in the address is random). Refreshing or
 * opening it again only reads, so it never repeats a payment.
 */
export default async function PayDonePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const params = await searchParams;
  const raw = params.link;
  const id = typeof raw === "string" && isUuid(raw) ? raw : null;
  const cancelled = params.cancelled === "1";
  const tries = Math.min(Math.max(Number(typeof params.n === "string" ? params.n : 0) || 0, 0), MAX_TRIES);
  const db = coachDb();
  const link = id && db ? await chargeLinkStatus(db, id) : null;
  const waiting = link?.status === "awaiting" && !cancelled && tries < MAX_TRIES;
  return (
    <Section labelledBy="done-heading">
      {waiting ? <meta httpEquiv="refresh" content={`4;url=${PAY_DONE_PATH}?link=${id}&n=${tries + 1}`} /> : null}
      <div className="max-w-xl">
        <Body link={link} cancelled={cancelled} gaveUp={link?.status === "awaiting" && !cancelled && tries >= MAX_TRIES} />
      </div>
    </Section>
  );
}

function Body({ link, cancelled, gaveUp }: { link: ChargeLinkStatus | null; cancelled: boolean; gaveUp: boolean }) {
  const signIn = (variant: "action" | "secondary" = "action") => (
    <Link href={SIGN_IN_PATH} className={buttonClasses(variant, "w-full px-6 sm:w-auto")}>
      Sign in to your account
    </Link>
  );
  if (!link) {
    return (
      <Confirmation state="stopped" headingId="done-heading" eyebrow="Payment" title="We couldn't find that payment." lede="If you've paid, Stripe will email you a receipt and we'll see it shortly. If you think something's wrong, email or call Alex.">
        {signIn("secondary")}
      </Confirmation>
    );
  }
  const eyebrow = link.description || "Payment";
  const base: [string, string][] = [
    ...(link.description ? ([["For", link.description]] as [string, string][]) : []),
    ["Amount", formatPence(link.amountPence)],
    ["Reference", link.reference],
  ];
  if (link.status === "paid") {
    return (
      <Confirmation
        state="done"
        headingId="done-heading"
        eyebrow={eyebrow}
        title="Payment received."
        lede="Thank you. Stripe has confirmed your card payment and it's recorded against your account. Stripe will also email you a receipt."
        details={[...base.slice(0, -1), ...(link.paidOn ? ([["Date", formatLongDate(link.paidOn as DateKey)]] as [string, string][]) : []), base[base.length - 1]]}
      >
        {signIn()}
      </Confirmation>
    );
  }
  if (link.status === "closed") {
    return (
      <Confirmation
        state="stopped"
        headingId="done-heading"
        eyebrow={eyebrow}
        title="This payment link is closed."
        lede="It was replaced or has expired, so it can't take a payment any more. If you've paid, Stripe will email you a receipt and we'll see it shortly. Otherwise, ask Alex for a new link."
        details={base}
      >
        {signIn("secondary")}
      </Confirmation>
    );
  }
  if (cancelled) {
    return (
      <Confirmation state="stopped" headingId="done-heading" eyebrow={eyebrow} title="Payment cancelled." lede="You haven't been charged. You can go back and pay whenever you're ready." details={base}>
        {link.payUrl ? (
          <a href={link.payUrl} className={buttonClasses("action", "w-full px-6 sm:w-auto")}>
            Go back and pay
          </a>
        ) : null}
        {signIn("secondary")}
      </Confirmation>
    );
  }
  if (gaveUp) {
    return (
      <Confirmation
        state="waiting"
        headingId="done-heading"
        eyebrow={eyebrow}
        title="Still confirming your payment."
        lede="Stripe's confirmation is taking longer than usual. You don't need to wait here: if your payment went through, it will show on your account and Stripe will email you a receipt."
        details={base}
      >
        {signIn()}
      </Confirmation>
    );
  }
  const steps: ConfirmationStep[] = [
    { label: "Waiting for Stripe's confirmation", status: "active" },
    { label: "Recording your payment", status: "todo" },
  ];
  return (
    <Confirmation state="waiting" headingId="done-heading" eyebrow={eyebrow} title="Confirming your payment." lede="Stripe is confirming your card payment. This usually takes a few seconds, and this page updates by itself." steps={steps} details={base}>
      {link.payUrl ? (
        <p>
          Didn&apos;t finish paying?{" "}
          <a href={link.payUrl} className="font-semibold underline underline-offset-4 hover:no-underline">
            Go back to Stripe to pay
          </a>
        </p>
      ) : null}
    </Confirmation>
  );
}
