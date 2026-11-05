import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { BookingPage } from "@/components/booking/BookingPage";

export const metadata: Metadata = pageMetadata({
  title: "Book a Session",
  description:
    "Book a group kettlebell class, request 1:1 personal coaching or enquire about small group coaching in Cumbernauld.",
  path: "/book",
});

export default function BookPage() {
  return <BookingPage title="Book your session" />;
}
