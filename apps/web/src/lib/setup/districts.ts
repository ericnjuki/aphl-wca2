// Pure helpers for the Setup page's district handling (unit-tested).

export interface District {
  id: number;
  code: string;
  name: string;
  region_id: number;
  region_name: string | null;
  facility_count: number;
  archived_at?: string | null;
}

/** Districts grouped under their region for grouped <Select>s. */
export function groupDistrictsByRegion(ds: District[]): { region: string; districts: District[] }[] {
  const byRegion = new Map<string, District[]>();
  for (const d of ds) {
    const key = d.region_name ?? "—";
    byRegion.set(key, [...(byRegion.get(key) ?? []), d]);
  }
  return [...byRegion.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([region, districts]) => ({
      region,
      districts: [...districts].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}
