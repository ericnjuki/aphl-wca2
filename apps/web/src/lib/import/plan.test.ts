import { describe, it, expect } from "vitest";
import {
  planSections, allErrors, needsConfirmation, confirmationSentence, hasMajorityWarning, formatValue, rowLabel,
  credentialRows, applySummary, isUncertainApplyFailure, UNCERTAIN_APPLY_MESSAGE, type ImportPlan, type TabPlan,
} from "./plan";

const counts = (over: Partial<TabPlan["counts"]> = {}): TabPlan["counts"] => ({
  added: 0, updated: 0, restored: 0, archived: 0, deleted: 0, disabled: 0, unchanged: 0, ...over,
});
const tab = (over: Partial<TabPlan>): TabPlan => ({
  tab: "Regions", present: true, counts: counts(), changes: [], errors: [], warnings: [], ...over,
});
const plan = (tabs: TabPlan[], over: Partial<ImportPlan> = {}): ImportPlan => ({
  fingerprint: "f", tabs, canApply: true, confirmations: { archived: 0, deleted: 0, disabledUsers: 0 }, ...over,
});

describe("planSections", () => {
  it("pins tabs with errors first, keeps the others in order and builds count badges", () => {
    const sections = planSections(plan([
      tab({ tab: "Regions", counts: counts({ added: 2, unchanged: 3 }) }),
      tab({ tab: "Districts", errors: [{ row: 9, column: "region_code", message: "b" }, { row: 3, column: null, message: "a" }] }),
      tab({ tab: "Users", counts: counts({ disabled: 1 }), warnings: ["1 user is not in the Users tab and will be disabled."] }),
    ]));
    expect(sections.map((s) => s.tab)).toEqual(["Districts", "Regions", "Users"]);
    expect(sections[0].errors.map((e) => e.row)).toEqual([3, 9]);
    expect(sections[0].defaultOpen).toBe(true);
    expect(sections[1].badges).toEqual([{ label: "added", count: 2, tone: "add" }]);
    expect(sections[1].unchanged).toBe(3);
    expect(sections[1].defaultOpen).toBe(false);
    expect(sections[2].badges).toEqual([{ label: "disabled", count: 1, tone: "remove" }]);
    expect(sections[2].defaultOpen).toBe(true);
  });
});

describe("allErrors", () => {
  it("lists every error with its sheet, in tab order then row order", () => {
    const errors = allErrors(plan([
      tab({ tab: "Regions", errors: [{ row: 5, column: "region_name", message: "x" }, { row: 2, column: null, message: "y" }] }),
      tab({ tab: "Users", errors: [{ row: 0, column: "email", message: "z" }] }),
    ]));
    expect(errors.map((e) => [e.tab, e.row])).toEqual([["Regions", 2], ["Regions", 5], ["Users", 0]]);
  });
});

describe("confirmation", () => {
  it("is needed only when something is archived, deleted or disabled", () => {
    expect(needsConfirmation({ archived: 0, deleted: 0, disabledUsers: 0 })).toBe(false);
    expect(needsConfirmation({ archived: 0, deleted: 1, disabledUsers: 0 })).toBe(true);
    expect(needsConfirmation({ archived: 0, deleted: 0, disabledUsers: 2 })).toBe(true);
  });

  it("states the numbers with singular and plural forms", () => {
    expect(confirmationSentence({ archived: 2, deleted: 1, disabledUsers: 1 }))
      .toBe("I understand this will archive 2 items, delete 1, and disable 1 user");
    expect(confirmationSentence({ archived: 1, deleted: 0, disabledUsers: 3 }))
      .toBe("I understand this will archive 1 item, delete 0, and disable 3 users");
  });
});

describe("hasMajorityWarning", () => {
  it("spots the more-than-half warning on any tab", () => {
    expect(hasMajorityWarning(plan([tab({ warnings: ["1 user is not in the Users tab and will be disabled."] })]))).toBe(false);
    expect(hasMajorityWarning(plan([
      tab({ warnings: ["3 of 4 existing regions would be archived or deleted — this usually means the wrong file."] }),
    ]))).toBe(true);
  });
});

describe("formatting", () => {
  it("shows empty values and missing rows explicitly", () => {
    expect(formatValue("")).toBe("(empty)");
    expect(formatValue(null)).toBe("(empty)");
    expect(formatValue("DSM")).toBe("DSM");
    expect(formatValue(3)).toBe("3");
    expect(rowLabel(null)).toBe("—");
    expect(rowLabel(0)).toBe("—");
    expect(rowLabel(7)).toBe("row 7");
  });

  it("builds credential rows for the download", () => {
    expect(credentialRows([{ name: "Amina Hassan", email: "a@x.test", username: "amina.hassan", temp_password: "Tmp123" }]))
      .toEqual([{ Name: "Amina Hassan", Email: "a@x.test", Username: "amina.hassan", "Temporary password": "Tmp123" }]);
  });

  it("summarises what was applied", () => {
    expect(applySummary(plan([
      tab({ counts: counts({ added: 2, archived: 1 }) }),
      tab({ tab: "Users", counts: counts({ added: 1, disabled: 2 }) }),
    ]))).toBe("Applied: 3 added, 1 archived, 2 disabled.");
    expect(applySummary(plan([tab({ counts: counts({ unchanged: 4 }) })]))).toBe("No changes were needed.");
  });
});

describe("isUncertainApplyFailure", () => {
  it("is true for gateway, timeout and network failures, where the server may still have committed", () => {
    for (const status of [0, 502, 503, 504]) expect(isUncertainApplyFailure(status)).toBe(true);
  });
  it("is false for definite answers", () => {
    for (const status of [200, 400, 403, 409, 413, 422, 500]) expect(isUncertainApplyFailure(status)).toBe(false);
  });
  it("tells the admin how to check", () => {
    expect(UNCERTAIN_APPLY_MESSAGE).toContain("may still have been applied");
    expect(UNCERTAIN_APPLY_MESSAGE).toContain("Users page");
  });
});
