import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { BookingPage } from "@/components/booking/BookingPage";

export const metadata: Metadata = pageMetadata({
  title: "Small Group Coaching Enquiry",
  description:
    "Enquire about small group kettlebell coaching in Cumbernauld. Submitting an enquiry does not guarantee a place.",
  path: "/book/small-group",
});

export default function BookSmallGroupPage() {
  return <BookingPage title="Small group coaching enquiry" initialService="small-group" />;
}
