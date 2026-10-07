import { describe, it, expect } from "vitest";
import { suppressionText } from "./privacy";

describe("suppressionText", () => {
  it("explains small groups", () => {
    expect(suppressionText("small")).toEqual({
      count: "<3",
      note: "Fewer than 3 respondents — hidden for privacy",
      export: "Fewer than 3",
    });
  });

  it("explains a report hidden because its parent row is hidden", () => {
    expect(suppressionText("parent")).toEqual({
      count: "—",
      note: "Hidden for privacy",
      export: "Hidden for privacy",
    });
  });

  it("explains complementary hiding without claiming fewer than 3", () => {
    expect(suppressionText("complementary")).toEqual({
      count: "—",
      note: "Hidden for privacy",
      export: "Hidden for privacy",
    });
  });
});
