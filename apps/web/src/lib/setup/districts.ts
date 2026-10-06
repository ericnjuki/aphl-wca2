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

export interface ImportResult {
  imported: number;
  updated?: number;
  skipped?: number;
  errors?: { row: number; reason: string }[];
}

/** Toast text for a CSV import response. */
export function formatImportResult(r: ImportResult, maxErrors = 5): { summary: string; details: string[] } {
  const parts = [`Imported ${r.imported}`];
  if (r.updated !== undefined) parts.push(`updated ${r.updated}`);
  if (r.skipped !== undefined) parts.push(`skipped ${r.skipped}`);
  const errors = r.errors ?? [];
  const details = errors.slice(0, maxErrors).map((e) => `Row ${e.row}: ${e.reason}`);
  if (errors.length > maxErrors) details.push(`…and ${errors.length - maxErrors} more`);
  return { summary: `${parts.join(", ")}.`, details };
}
