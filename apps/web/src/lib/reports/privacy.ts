import type { MaturityCounts } from "@/types/reports";

type Suppression = NonNullable<MaturityCounts["suppressed"]>;

// Wording for report rows the API hid from partner users.
export function suppressionText(kind: Suppression): { count: string; note: string; export: string } {
  return kind === "small"
    ? { count: "<3", note: "Fewer than 3 respondents — hidden for privacy", export: "Fewer than 3" }
    : { count: "—", note: "Hidden for privacy", export: "Hidden for privacy" };
}
