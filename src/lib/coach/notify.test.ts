import { describe, expect, it } from "vitest";
import { decisionMessage } from "./notify";

const base = { name: "Moss Example", status: "confirmed" as const, summary: "Sat 14 Nov", service: "Group classes", decision_note: "" };

describe("decisionMessage", () => {
  it("adds the arrive-10-minutes-early note when a group class is confirmed", () => {
    const { body } = decisionMessage({ ...base, decision_note: "" }, "Saturday 14 November, 09:00 am");
    expect(body).toContain("You're booked in: Saturday 14 November, 09:00 am.");
    expect(body).toContain("Please arrive 10 minutes early");
  });

  it("does not add it for a request that is not confirmed", () => {
    const { body } = decisionMessage({ ...base, status: "declined", decision_note: "" });
    expect(body).not.toContain("10 minutes early");
  });

  it("does not add it for a confirmed 1:1 session", () => {
    const { body } = decisionMessage({ ...base, service: "One-to-one" }, "Tue 10 Nov, 6 pm");
    expect(body).not.toContain("10 minutes early");
  });
});
