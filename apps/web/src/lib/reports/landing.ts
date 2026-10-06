import type { AuthUser } from "@/store/auth";
import type { ReportLevel } from "@/types/reports";

export type LandingUser = Pick<AuthUser, "id" | "role" | "facility_id" | "regions">;

/**
 * Where a user lands when they open /reports (the national level).
 * Only admins may view the national report; everyone else is redirected:
 *   - monitor, one region   → that region
 *   - monitor, many / none  → stay, and show the "Your regions" picker
 *   - staff                 → their facility, or their own report if they have none
 */
export function reportsLanding(
  user: LandingUser | null,
  level: ReportLevel,
  baseUrl: string,
): { redirect: string | null; showRegionPicker: boolean } {
  const none = { redirect: null, showRegionPicker: false };
  if (!user || level !== "national" || user.role === "admin") return none;

  if (user.role === "monitor") {
    return user.regions.length === 1
      ? { redirect: `${baseUrl}reports/regions/${user.regions[0].id}`, showRegionPicker: false }
      : { redirect: null, showRegionPicker: true };
  }

  return {
    redirect: user.facility_id != null
      ? `${baseUrl}reports/facilities/${user.facility_id}`
      : `${baseUrl}reports/users/${user.id}`,
    showRegionPicker: false,
  };
}
