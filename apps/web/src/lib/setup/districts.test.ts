import { describe, it, expect } from "vitest";
import { groupDistrictsByRegion, type District } from "./districts";

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
