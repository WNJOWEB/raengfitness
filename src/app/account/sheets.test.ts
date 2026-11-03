import { describe, expect, it } from "vitest";
import type { MemberPlace } from "@/lib/member-auth";
import { cancelSheet } from "./sheets";

const paidPlace: MemberPlace = {
  id: "p1",
  class_date: "2026-11-09",
  starts_at: "2026-11-09T18:30:00Z",
  slot: "mon-evening",
  status: "booked",
  late_cancel: false,
  with_credit: false,
  how: "paid",
  class_cancelled: false,
  can_cancel: true,
  credit_back_if_cancelled: true,
};

describe("cancelling a paid class from the account", () => {
  it("in time: promises a class credit", () => {
    expect(cancelSheet(paidPlace, "home")).toMatchObject({ body: "You get a class credit for another class within 4 weeks.", confirm: "Cancel booking" });
  });

  it("already refunded in Stripe: says there's no credit, and why", () => {
    const sheet = cancelSheet({ ...paidPlace, refunded: true, credit_back_if_cancelled: false }, "home");
    expect(sheet.body).toBe("Your payment for this class has already been refunded, so cancelling gives no credit.");
    expect(sheet.confirm).toBe("Cancel booking");
    expect(sheet.fields).toMatchObject({ place: "p1", paid: "yes" });
  });
});
