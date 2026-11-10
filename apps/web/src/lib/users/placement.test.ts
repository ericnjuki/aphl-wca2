import { describe, it, expect } from "vitest";
import { buildUserBody, type UserForm } from "./placement";

const form = (over: Partial<UserForm>): UserForm => ({
  first_name: "Pat", last_name: "Partner", national_id: "P1", id_type: "NRC", email: "p@ngo.test",
  role: "staff", facility_id: "3", department_id: "4", org_role_id: "5", title_id: "6",
  region_ids: [], is_enabled: true, ...over,
});

describe("buildUserBody", () => {
  it("staff keep their placement and send no regions", () => {
    const body = buildUserBody(form({ region_ids: [9] }));
    expect(body).toMatchObject({ facility_id: 3, department_id: 4, org_role_id: 5, title_id: 6, region_ids: [] });
  });

  it("monitors send regions and explicitly null placement", () => {
    const body = buildUserBody(form({ role: "monitor", region_ids: [2, 1] }));
    expect(body).toMatchObject({
      role: "monitor", facility_id: null, department_id: null, org_role_id: null, title_id: null, region_ids: [2, 1],
    });
  });

  it("empty selects become null", () => {
    const body = buildUserBody(form({ facility_id: "", department_id: "" }));
    expect(body.facility_id).toBeNull();
    expect(body.department_id).toBeNull();
  });
});
