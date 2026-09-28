import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildWorkbook } from "./export-excel";
import type { DistrictReportResponse, RegionReportResponse, MaturityCounts, ReportMeta } from "@/types/reports";

const counts: MaturityCounts = {
  respondents: 2, total_responses: 4, avg_level: 3,
  count_na: 0, count_beginner: 0, count_competent: 2, count_proficient: 0, count_expert: 2,
};
const meta: ReportMeta = {
  total_respondents: 2, unassigned_respondents: 0, generated_at: "2026-09-28T00:00:00Z",
  filters: { domain_code: null, competency_value: null, approved_only: true },
};

const breakdown = (wb: XLSX.WorkBook) => XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Breakdown"]);
const summary = (wb: XLSX.WorkBook) => XLSX.utils.sheet_to_json<{ Field: string; Value: unknown }>(wb.Sheets["Summary"]);

describe("buildWorkbook — districts", () => {
  it("region report breaks down by district", () => {
    const r: RegionReportResponse = {
      level: "region", region: { id: 1, name: "Dar es Salaam" },
      items: [{ district_id: 7, district_name: "Temeke", ...counts }],
      undistricted_facilities: [], meta,
    };
    expect(breakdown(buildWorkbook(r))[0]).toMatchObject({ District: "Temeke", Respondents: 2 });
  });

  it("district report breaks down by facility and is titled after the district", () => {
    const r: DistrictReportResponse = {
      level: "district",
      district: { id: 7, name: "Temeke", region_id: 1, region_name: "Dar es Salaam" },
      items: [{ facility_id: 3, facility_name: "Temeke Hospital", ...counts }],
      meta,
    };
    const wb = buildWorkbook(r);
    expect(breakdown(wb)[0]).toMatchObject({ Facility: "Temeke Hospital", Respondents: 2 });
    expect(summary(wb).find((s) => s.Field === "Title")?.Value).toBe("Temeke district");
  });
});
