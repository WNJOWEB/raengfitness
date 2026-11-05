import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { BookingPage } from "@/components/booking/BookingPage";

export const metadata: Metadata = pageMetadata({
  title: "Book 1:1 Personal Coaching",
  description: "Request a single 1:1 session or the monthly package with Alex in Cumbernauld. Alex confirms every booking personally.",
  path: "/book/one-to-one",
});

export default function BookOneToOnePage() {
  return <BookingPage title="Book 1:1 personal coaching" initialService="one-to-one" />;
}
