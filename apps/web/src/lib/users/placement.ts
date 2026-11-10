// Users form → admin API body. Partner (monitor) users have no facility
// placement; they are scoped by region_ids instead. Placement fields are sent
// as explicit nulls so the API clears them when a staff user becomes a monitor.

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
  is_enabled: boolean;
}

export type UserBody = Omit<UserForm, "facility_id" | "department_id" | "org_role_id" | "title_id"> & {
  facility_id: number | null;
  department_id: number | null;
  org_role_id: number | null;
  title_id: number | null;
};

const toId = (v: string) => (v ? Number(v) : null);

export function buildUserBody(form: UserForm): UserBody {
  const isMonitor = form.role === "monitor";
  return {
    ...form,
    facility_id: isMonitor ? null : toId(form.facility_id),
    department_id: isMonitor ? null : toId(form.department_id),
    org_role_id: isMonitor ? null : toId(form.org_role_id),
    title_id: isMonitor ? null : toId(form.title_id),
    region_ids: isMonitor ? form.region_ids : [],
  };
}
