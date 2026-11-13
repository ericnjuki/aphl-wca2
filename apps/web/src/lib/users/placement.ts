// Users form → admin API body, per the role model (plans/2026-11-12-role-model.md).
// Mirrors validatePlacement in apps/api/src/routes/admin.ts:
//   national               no placement
//   county                 exactly one region (region_ids)
//   subcounty              exactly one district (district_ids)
//   admin, staff           optional facility / department / org role / title
//   facility_admin         a facility (required) + optional department / org role / title
// region_ids and district_ids are always sent explicitly (empty when unused) so the
// API clears a stale assignment on a role change; unused facility fields are nulls.

export interface UserForm {
  first_name: string;
  last_name: string;
  national_id: string;
  id_type: string;
  email: string;
  role: string;
  facility_id: string;
  department_id: string;
  org_role_id: string;
  title_id: string;
  region_ids: number[];
  district_ids: number[];
  is_enabled: boolean;
}

export type UserBody = Omit<UserForm, "facility_id" | "department_id" | "org_role_id" | "title_id"> & {
  facility_id: number | null;
  department_id: number | null;
  org_role_id: number | null;
  title_id: number | null;
};

export type PlacementKind = "none" | "region" | "district" | "facility";

/** Which placement fields the form shows for a role. */
export function placementKind(role: string): PlacementKind {
  if (role === "national") return "none";
  if (role === "county") return "region";
  if (role === "subcounty") return "district";
  return "facility";
}

/** What's missing before the form can be saved, or null. */
export function missingPlacement(form: UserForm): "region" | "district" | "facility" | null {
  const kind = placementKind(form.role);
  if (kind === "region" && form.region_ids.length !== 1) return "region";
  if (kind === "district" && form.district_ids.length !== 1) return "district";
  if (form.role === "facility_admin" && !form.facility_id) return "facility";
  return null;
}

const toId = (v: string) => (v ? Number(v) : null);

export function buildUserBody(form: UserForm): UserBody {
  const kind = placementKind(form.role);
  const facility = kind === "facility";
  return {
    ...form,
    facility_id: facility ? toId(form.facility_id) : null,
    department_id: facility ? toId(form.department_id) : null,
    org_role_id: facility ? toId(form.org_role_id) : null,
    title_id: facility ? toId(form.title_id) : null,
    region_ids: kind === "region" ? form.region_ids : [],
    district_ids: kind === "district" ? form.district_ids : [],
  };
}

export interface PlacedFacility {
  id: number;
  region_id: number | null;
  district_id: number | null;
}

/** The region → district cascade only narrows the facility list; it is never saved. */
export function filterFacilities<F extends PlacedFacility>(
  facilities: F[],
  regionId: number | null,
  districtId: number | null,
): F[] {
  return facilities.filter(
    (f) =>
      (regionId == null || f.region_id === regionId) &&
      (districtId == null || f.district_id === districtId),
  );
}
