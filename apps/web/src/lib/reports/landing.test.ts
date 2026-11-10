import { describe, it, expect } from "vitest";
import { reportsLanding, type LandingUser } from "./landing";

const base = "/";
const u = (over: Partial<LandingUser>): LandingUser => ({
  id: 7, role: "staff", facility_id: null, regions: [], ...over,
});

describe("reportsLanding", () => {
  it("admins stay on the national report", () => {
    expect(reportsLanding(u({ role: "admin" }), "national", base))
      .toEqual({ redirect: null, showRegionPicker: false });
  });

  it("staff with a facility go to their facility", () => {
    expect(reportsLanding(u({ facility_id: 3 }), "national", base).redirect).toBe("/reports/facilities/3");
  });

  it("staff without a facility go to their own report", () => {
    expect(reportsLanding(u({}), "national", base).redirect).toBe("/reports/users/7");
  });

  it("a single-region monitor goes straight to that region", () => {
    const r = reportsLanding(u({ role: "monitor", regions: [{ id: 4, name: "Mwanza" }] }), "national", base);
    expect(r).toEqual({ redirect: "/reports/regions/4", showRegionPicker: false });
  });

  it("a multi-region monitor gets the region picker", () => {
    const regions = [{ id: 4, name: "Mwanza" }, { id: 5, name: "Arusha" }];
    expect(reportsLanding(u({ role: "monitor", regions }), "national", base))
      .toEqual({ redirect: null, showRegionPicker: true });
  });

  it("a monitor with no regions gets the (empty) picker, not a redirect", () => {
    expect(reportsLanding(u({ role: "monitor" }), "national", base))
      .toEqual({ redirect: null, showRegionPicker: true });
  });

  it("does nothing below the national level", () => {
    expect(reportsLanding(u({ role: "monitor", regions: [{ id: 4, name: "Mwanza" }] }), "region", base))
      .toEqual({ redirect: null, showRegionPicker: false });
  });

  it("does nothing before the user has loaded", () => {
    expect(reportsLanding(null, "national", base)).toEqual({ redirect: null, showRegionPicker: false });
  });
});
