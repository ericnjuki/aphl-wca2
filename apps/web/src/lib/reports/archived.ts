// Report rows for archived regions/districts/facilities/departments stay
// visible while they have respondents; the label says they are archived.
export function archivedLabel(name: string, archived?: boolean): string {
  return archived ? `${name} (archived)` : name;
}
