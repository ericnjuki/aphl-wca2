import { describe, it, expect } from "vitest";
import { archivedLabel } from "./archived";

describe("archivedLabel", () => {
  it("labels archived rows and leaves active rows alone", () => {
    expect(archivedLabel("Temeke", true)).toBe("Temeke (archived)");
    expect(archivedLabel("Temeke", false)).toBe("Temeke");
    expect(archivedLabel("Temeke")).toBe("Temeke");
  });
});
