import { describe, it, expect } from "vitest";
import { getMenuList, type Role } from "./menu-list";

const labels = (role: Role) =>
  getMenuList("/", role).flatMap((g) => g.menus.map((m) => m.label));

describe("getMenuList", () => {
  it("national and county users see only Reports and Docs", () => {
    expect(labels("national")).toEqual(["navigation.reports", "navigation.docs"]);
    expect(labels("county")).toEqual(["navigation.reports", "navigation.docs"]);
  });

  it("sub-county coordinators also get Reviews", () => {
    expect(labels("subcounty")).toEqual(["navigation.reports", "navigation.reviews", "navigation.docs"]);
  });

  it("staff keep Survey and My Assessments", () => {
    expect(labels("staff")).toEqual([
      "navigation.survey", "navigation.my_assessments", "navigation.reports", "navigation.docs",
    ]);
  });

  it("facility admins take assessments, review and manage users, but no setup", () => {
    expect(labels("facility_admin")).toEqual([
      "navigation.survey", "navigation.my_assessments", "navigation.reports", "navigation.reviews",
      "navigation.users", "navigation.docs",
    ]);
  });

  it("admins manage everything but do not take assessments", () => {
    const l = labels("admin");
    expect(l).toEqual(expect.arrayContaining([
      "navigation.reviews", "navigation.assessments", "navigation.users", "navigation.setup",
    ]));
    expect(l).not.toContain("navigation.survey");
    expect(l).not.toContain("navigation.my_assessments");
  });

  it("an unknown (still loading) role gets the staff menu", () => {
    expect(labels(null)).toEqual(labels("staff"));
  });
});
