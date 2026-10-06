import { describe, it, expect } from "vitest";
import { getMenuList, type Role } from "./menu-list";

const labels = (role: Role) =>
  getMenuList("/", role).flatMap((g) => g.menus.map((m) => m.label));

describe("getMenuList", () => {
  it("monitors see only Reports and Docs", () => {
    expect(labels("monitor")).toEqual(["navigation.reports", "navigation.docs"]);
  });

  it("staff keep Survey and My Assessments", () => {
    expect(labels("staff")).toEqual([
      "navigation.survey", "navigation.my_assessments", "navigation.reports", "navigation.docs",
    ]);
  });

  it("admins see everything", () => {
    expect(labels("admin")).toEqual(expect.arrayContaining(["navigation.users", "navigation.survey"]));
  });
});
