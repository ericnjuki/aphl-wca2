import { describe, it, expect } from "vitest";
import { isSessionExpiry } from "./api";

describe("isSessionExpiry", () => {
  it("is true for a 401 on a non-auth request", () => {
    expect(isSessionExpiry("/reports/national", 401)).toBe(true);
  });
  it("ignores 401s from /auth (e.g. a wrong password at login)", () => {
    expect(isSessionExpiry("/auth/login", 401)).toBe(false);
    expect(isSessionExpiry("/auth/me", 401)).toBe(false);
  });
  it("ignores other statuses", () => {
    expect(isSessionExpiry("/reports/national", 403)).toBe(false);
  });
});
