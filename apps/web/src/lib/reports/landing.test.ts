import { describe, it, expect } from "vitest";
import { canOpenLevel, reportsLanding, type LandingUser } from "./landing";

const base = "/";
const u = (over: Partial<LandingUser>): LandingUser => ({
  id: 7, role: "staff", facility_id: null, regions: [], districts: [], ...over,
});
const stay = { redirect: null, unassigned: false };

describe("reportsLanding", () => {
  it("admins and national users stay on the national report", () => {
    expect(reportsLanding(u({ role: "admin" }), "national", base)).toEqual(stay);
    expect(reportsLanding(u({ role: "national" }), "national", base)).toEqual(stay);
  });

  it("county coordinators go to their county", () => {
    const r = reportsLanding(u({ role: "county", regions: [{ id: 4, name: "Mwanza" }] }), "national", base);
    expect(r).toEqual({ redirect: "/reports/regions/4", unassigned: false });
  });

  it("sub-county coordinators go to their sub-county", () => {
    const r = reportsLanding(
      u({ role: "subcounty", districts: [{ id: 9, name: "Ilemela", region_id: 4 }] }), "national", base,
    );
    expect(r).toEqual({ redirect: "/reports/districts/9", unassigned: false });
  });

  it("facility admins go to their facility", () => {
    expect(reportsLanding(u({ role: "facility_admin", facility_id: 3 }), "national", base).redirect)
      .toBe("/reports/facilities/3");
  });

  it("staff go to their own report, facility or not", () => {
    expect(reportsLanding(u({ facility_id: 3 }), "national", base).redirect).toBe("/reports/users/7");
    expect(reportsLanding(u({}), "national", base).redirect).toBe("/reports/users/7");
  });

  it("an unassigned coordinator or facility admin gets the notice, not a redirect", () => {
    const notice = { redirect: null, unassigned: true };
    expect(reportsLanding(u({ role: "county" }), "national", base)).toEqual(notice);
    expect(reportsLanding(u({ role: "subcounty" }), "national", base)).toEqual(notice);
    expect(reportsLanding(u({ role: "facility_admin" }), "national", base)).toEqual(notice);
  });

  it("does nothing below the national level", () => {
    expect(reportsLanding(u({ role: "county", regions: [{ id: 4, name: "Mwanza" }] }), "region", base))
      .toEqual(stay);
  });

  it("does nothing before the user has loaded", () => {
    expect(reportsLanding(null, "national", base)).toEqual(stay);
  });
});

describe("canOpenLevel", () => {
  const levels = ["national", "region", "district", "facility", "department", "individual"] as const;
  const open = (role: Parameters<typeof canOpenLevel>[0]) => levels.filter((l) => canOpenLevel(role, l));

  it("matches the API's report scope per role", () => {
    expect(open("admin")).toEqual([...levels]);
    expect(open("national")).toEqual(["national"]);
    expect(open("county")).toEqual(["region", "district", "facility"]);
    expect(open("subcounty")).toEqual(["district", "facility"]);
    expect(open("facility_admin")).toEqual(["facility", "department", "individual"]);
    expect(open("staff")).toEqual(["individual"]);
    expect(open(null)).toEqual([]);
  });
});
