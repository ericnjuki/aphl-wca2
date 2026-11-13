import { describe, it, expect } from "vitest";
import { ApiError, isForbidden, isSessionExpiry, shouldRetry, unwrap } from "./api";

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

describe("shouldRetry", () => {
  it("never retries a 4xx (no access, not found, bad input)", () => {
    expect(shouldRetry(0, new ApiError("Forbidden", 403))).toBe(false);
    expect(shouldRetry(0, new ApiError("Not found", 404))).toBe(false);
  });
  it("retries 5xx, network errors and plain errors up to three times", () => {
    expect(shouldRetry(0, new ApiError("Boom", 500))).toBe(true);
    expect(shouldRetry(2, new ApiError("Network error", 0))).toBe(true);
    expect(shouldRetry(3, new Error("x"))).toBe(false);
  });
});

describe("unwrap", () => {
  it("returns data, or throws an ApiError carrying the status", () => {
    expect(unwrap({ data: 1, error: null })).toBe(1);
    let caught: unknown;
    try { unwrap({ data: null, error: "Forbidden", status: 403 }); } catch (e) { caught = e; }
    expect(isForbidden(caught)).toBe(true);
    expect(isForbidden(new Error("Forbidden"))).toBe(false);
  });
});
