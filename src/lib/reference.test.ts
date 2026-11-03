import { describe, expect, it } from "vitest";
import { referenceFor } from "./reference";

describe("referenceFor", () => {
  it("takes the first eight characters of the id, upper case", () => {
    expect(referenceFor("3f9a1c07-1111-4222-8333-444455556666")).toBe("RAENG-3F9A1C07");
  });
  it("gives the same reference for the same id", () => {
    const id = "0a1b2c3d-1111-4222-8333-444455556666";
    expect(referenceFor(id)).toBe(referenceFor(id));
  });
  it("reads a request key such as booking-request/<hex>", () => {
    expect(referenceFor("booking-request/ab12cd34ef56")).toBe("RAENG-AB12CD34");
  });
});
