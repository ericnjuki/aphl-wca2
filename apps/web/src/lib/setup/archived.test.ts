import { describe, it, expect } from "vitest";
import { listPath, listKey, isArchived } from "./archived";

describe("archived list helpers", () => {
  it("asks the API for archived rows only when the toggle is on", () => {
    expect(listPath("/admin/regions", false)).toBe("/admin/regions");
    expect(listPath("/admin/regions", true)).toBe("/admin/regions?include_archived=1");
  });

  it("keeps the active-only query key shared with the pickers", () => {
    expect(listKey(["admin", "regions"], false)).toEqual(["admin", "regions"]);
    expect(listKey(["admin", "regions"], true)).toEqual(["admin", "regions", "with-archived"]);
  });

  it("recognises archived rows", () => {
    expect(isArchived({ archived_at: "2026-10-06 10:00:00" })).toBe(true);
    expect(isArchived({ archived_at: null })).toBe(false);
    expect(isArchived({})).toBe(false);
  });
});
