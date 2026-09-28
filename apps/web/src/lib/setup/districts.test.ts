import { describe, it, expect } from "vitest";
import { groupDistrictsByRegion, formatImportResult, type District } from "./districts";

const d = (id: number, name: string, region_name: string | null): District => ({
  id, code: name.slice(0, 3).toUpperCase(), name, region_id: 1, region_name, facility_count: 0,
});

describe("groupDistrictsByRegion", () => {
  it("groups by region name, both sorted alphabetically", () => {
    const groups = groupDistrictsByRegion([
      d(1, "Temeke", "Dar es Salaam"), d(2, "Nyamagana", "Mwanza"), d(3, "Ilala", "Dar es Salaam"),
    ]);
    expect(groups.map((g) => [g.region, g.districts.map((x) => x.name)])).toEqual([
      ["Dar es Salaam", ["Ilala", "Temeke"]],
      ["Mwanza", ["Nyamagana"]],
    ]);
  });

  it("puts districts with no region name under '—'", () => {
    expect(groupDistrictsByRegion([d(1, "Orphan", null)])[0].region).toBe("—");
  });
});

describe("formatImportResult", () => {
  it("summarises counts and lists the first errors", () => {
    const r = formatImportResult({
      imported: 2, updated: 1, skipped: 4,
      errors: [1, 2, 3, 4].map((n) => ({ row: n + 1, reason: `bad ${n}` })),
    }, 3);
    expect(r.summary).toBe("Imported 2, updated 1, skipped 4.");
    expect(r.details).toEqual(["Row 2: bad 1", "Row 3: bad 2", "Row 4: bad 3", "…and 1 more"]);
  });

  it("omits parts that are absent", () => {
    expect(formatImportResult({ imported: 5 })).toEqual({ summary: "Imported 5.", details: [] });
  });
});
