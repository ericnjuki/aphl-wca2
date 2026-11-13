import { describe, it, expect } from "vitest";
import { buildUserBody, filterFacilities, missingPlacement, placementKind, type UserForm } from "./placement";

const form = (over: Partial<UserForm>): UserForm => ({
  first_name: "Pat", last_name: "Doe", national_id: "P1", id_type: "NRC", email: "p@x.test",
  role: "staff", facility_id: "3", department_id: "4", org_role_id: "5", title_id: "6",
  region_ids: [], district_ids: [], is_enabled: true, ...over,
});

const NULL_FACILITY = { facility_id: null, department_id: null, org_role_id: null, title_id: null };

describe("buildUserBody", () => {
  it("staff keep their placement and send empty region/district lists", () => {
    const body = buildUserBody(form({ region_ids: [9], district_ids: [8] }));
    expect(body).toMatchObject({
      facility_id: 3, department_id: 4, org_role_id: 5, title_id: 6, region_ids: [], district_ids: [],
    });
  });

  it("facility admins and admins keep facility placement", () => {
    expect(buildUserBody(form({ role: "facility_admin" }))).toMatchObject({ facility_id: 3, region_ids: [], district_ids: [] });
    expect(buildUserBody(form({ role: "admin" }))).toMatchObject({ facility_id: 3, title_id: 6 });
  });

  it("county coordinators send one region and null facility fields", () => {
    const body = buildUserBody(form({ role: "county", region_ids: [2], district_ids: [7] }));
    expect(body).toMatchObject({ role: "county", ...NULL_FACILITY, region_ids: [2], district_ids: [] });
  });

  it("sub-county coordinators send one district and null facility fields", () => {
    const body = buildUserBody(form({ role: "subcounty", region_ids: [2], district_ids: [7] }));
    expect(body).toMatchObject({ role: "subcounty", ...NULL_FACILITY, region_ids: [], district_ids: [7] });
  });

  it("national users send no placement at all", () => {
    const body = buildUserBody(form({ role: "national", region_ids: [2], district_ids: [7] }));
    expect(body).toMatchObject({ ...NULL_FACILITY, region_ids: [], district_ids: [] });
  });

  it("keeps is_enabled and the numeric facility unchanged (facility-admin PUT checks both)", () => {
    const body = buildUserBody(form({ is_enabled: false }));
    expect(body.is_enabled).toBe(false);
    expect(body.facility_id).toBe(3);
  });

  it("empty selects become null", () => {
    const body = buildUserBody(form({ facility_id: "", department_id: "" }));
    expect(body.facility_id).toBeNull();
    expect(body.department_id).toBeNull();
  });
});

describe("placementKind / missingPlacement", () => {
  it("maps roles to the fields the form shows", () => {
    expect(["admin", "national", "county", "subcounty", "facility_admin", "staff"].map(placementKind))
      .toEqual(["facility", "none", "region", "district", "facility", "facility"]);
  });

  it("flags the required assignment per role", () => {
    expect(missingPlacement(form({ role: "county" }))).toBe("region");
    expect(missingPlacement(form({ role: "county", region_ids: [1] }))).toBeNull();
    expect(missingPlacement(form({ role: "subcounty" }))).toBe("district");
    expect(missingPlacement(form({ role: "facility_admin", facility_id: "" }))).toBe("facility");
    expect(missingPlacement(form({ role: "staff", facility_id: "" }))).toBeNull();
    expect(missingPlacement(form({ role: "national" }))).toBeNull();
  });
});

describe("filterFacilities", () => {
  const fs = [
    { id: 1, region_id: 1, district_id: 10 },
    { id: 2, region_id: 1, district_id: 11 },
    { id: 3, region_id: 2, district_id: 20 },
    { id: 4, region_id: null, district_id: null },
  ];
  it("no filter keeps everything", () => expect(filterFacilities(fs, null, null)).toHaveLength(4));
  it("filters by region, then district", () => {
    expect(filterFacilities(fs, 1, null).map((f) => f.id)).toEqual([1, 2]);
    expect(filterFacilities(fs, 1, 11).map((f) => f.id)).toEqual([2]);
  });
});
