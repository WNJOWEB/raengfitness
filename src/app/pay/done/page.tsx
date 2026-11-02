import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { coachDb, isUuid } from "@/lib/coach/db";
import { formatPence } from "@/lib/coach/money";
import { chargeLinkStatus, type ChargeLinkStatus } from "@/lib/stripe/sync";
import { pageMetadata } from "@/lib/metadata";
import { Section } from "@/components/ui/Section";

export const metadata: Metadata = pageMetadata({
  title: "Your payment",
  description: "Your RAENG Fitness payment.",
  path: "/pay/done",
  noindex: true,
});

/**
 * Where Stripe's payment page sends someone who paid a link Alex sent them.
 * It only reads the link's state from the database, which changes once
 * Stripe's verified webhook has recorded the payment: arriving here proves
 * nothing, so the page never says "received" until the database does. While
 * it waits, it refreshes itself every few seconds. It shows the amount and
 * what it was for, nothing about the person (the id in the address is random).
 */
export default async function PayDonePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const raw = (await searchParams).link;
  const id = typeof raw === "string" && isUuid(raw) ? raw : null;
  const db = coachDb();
  const link = id && db ? await chargeLinkStatus(db, id) : null;
  return (
    <Section labelledBy="done-heading">
      {link?.status === "awaiting" ? <meta httpEquiv="refresh" content="4" /> : null}
      <div className="max-w-xl" role="status">
        <Body link={link} />
      </div>
    </Section>
  );
}

function Body({ link }: { link: ChargeLinkStatus | null }) {
  const heading = "mt-3 font-display text-h1 text-balance";
  const home = (
    <Link href="/" className="mt-8 inline-flex min-h-11 items-center font-semibold underline underline-offset-4 hover:no-underline">
      Back to the homepage
    </Link>
  );
  if (!link) {
    return (
      <>
        <p className="eyebrow">Payment</p>
        <h1 id="done-heading" className={heading}>
          We couldn&apos;t find that payment.
        </h1>
        <p className="mt-5 text-lede">If you&apos;ve paid, Stripe will email you a receipt and Alex will see it shortly.</p>
        {home}
      </>
    );
  }
  const what = [link.description, formatPence(link.amountPence)].filter(Boolean).join(" · ");
  if (link.status === "paid") {
    return (
      <>
        <p className="eyebrow">{what}</p>
        <h1 id="done-heading" className={heading}>
          Payment received.
        </h1>
        <p className="mt-5 text-lede">Thank you. Stripe has confirmed your payment and Alex can see it.</p>
        {home}
      </>
    );
  }
  if (link.status === "closed") {
    return (
      <>
        <p className="eyebrow">{what}</p>
        <h1 id="done-heading" className={heading}>
          This payment link is closed.
        </h1>
        <p className="mt-5 text-lede">If you&apos;ve paid, Stripe will email you a receipt and Alex will see it shortly. Otherwise, ask Alex for a new link.</p>
        {home}
      </>
    );
  }
  return (
    <>
      <p className="eyebrow">{what}</p>
      <h1 id="done-heading" className={heading}>
        Waiting for Stripe to confirm.
      </h1>
      <p className="mt-5 text-lede">This usually takes a few seconds. This page updates by itself.</p>
      {link.payUrl ? (
        <p className="mt-6">
          Didn&apos;t finish paying?{" "}
          <a href={link.payUrl} className="font-semibold underline underline-offset-4 hover:no-underline">
            Go back to Stripe to pay
          </a>
        </p>
      ) : null}
    </>
  );
}
