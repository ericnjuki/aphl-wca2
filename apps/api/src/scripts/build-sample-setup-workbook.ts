// One-off conversion: apps/web/public/data/*.csv → apps/web/public/data/sample-country-setup.xlsx.
// The sample needs things the CSVs never had: every facility offers the four
// departments its staff use, users get system_role/status, and the seed admin
// is on the Users tab so importing the sample does not lock that admin out.
// Run once, commit the workbook, then delete this script with the CSVs.

import fs from 'fs';
import path from 'path';
import { parseCsv } from '../lib/csv';
import { SetupSnapshot, SnapEntity, SnapUser } from '../lib/workbook/setup-snapshot';
import { writeSetupWorkbook } from '../lib/workbook/setup-export';
import { readSetupWorkbook } from '../lib/workbook/setup-format';
import { planSetupImport } from '../lib/workbook/setup-planner';

const DATA_DIR = path.resolve(__dirname, '../../../web/public/data');
const OUT = path.join(DATA_DIR, 'sample-country-setup.xlsx');
const SAMPLE_DEPARTMENTS = ['LAB', 'MED', 'NURS', 'PHARM'];

// Mirrors apps/api/src/db/seed.ts.
const SEED_ADMIN: SnapUser = {
  id: 1, email: 'admin@aphl.com', userName: 'admin', firstName: 'National', lastName: 'Administrator',
  nationalId: 'APHL', idType: 'national id', role: 'admin', enabled: true,
  facilityCode: '', departmentCode: '', orgRoleCode: '', titleCode: '', regionCodes: [],
};

function csv(name: string): Record<string, string>[] {
  const { headers, rows } = parseCsv(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const entity = (code: string, name: string): SnapEntity => ({
  id: 0, code: code.toUpperCase(), name, archived: false, hasHistory: false,
});

async function main(): Promise<void> {
  const snap: SetupSnapshot = {
    regions: csv('regions.csv').map((r) => entity(r.region_code, r.region_name)),
    districts: csv('districts.csv').map((r) => ({ ...entity(r.district_code, r.district_name), regionCode: r.region_code.toUpperCase() })),
    departments: csv('departments.csv').map((r) => entity(r.department_code, r.department_name)),
    facilities: csv('facilities.csv').map((r) => ({
      ...entity(r.facility_code, r.facility_name),
      facilityType: r.facility_type,
      districtCode: r.district_code.toUpperCase(),
      departmentCodes: SAMPLE_DEPARTMENTS,
    })),
    orgRoles: csv('org_roles.csv').map((r) => entity(r.role_code, r.role_name)),
    titles: csv('user_titles.csv').map((r) => entity(r.title_code, r.title_name)),
    users: [
      { ...SEED_ADMIN, idType: 'Other', userName: '' },
      ...csv('users.csv').map((r): SnapUser => ({
        id: 0, email: r.email.toLowerCase(), userName: '', firstName: r.first_name, lastName: r.last_name,
        nationalId: r.national_id, idType: r.id_type, role: 'staff', enabled: true,
        facilityCode: r.facility_code.toUpperCase(), departmentCode: r.department_code.toUpperCase(),
        orgRoleCode: r.role_code.toUpperCase(), titleCode: r.title_code.toUpperCase(), regionCodes: [],
      })),
    ],
  };
  const buffer = await writeSetupWorkbook(snap);
  fs.writeFileSync(OUT, buffer);

  // On a fresh install (only the seed admin exists) the sample must preview cleanly.
  const fresh: SetupSnapshot = {
    regions: [], districts: [], departments: [], facilities: [], orgRoles: [], titles: [], users: [SEED_ADMIN],
  };
  const { plan } = planSetupImport(await readSetupWorkbook(buffer), fresh, SEED_ADMIN.id);
  if (!plan.canApply) {
    console.error(JSON.stringify(plan.tabs.flatMap((t) => t.errors.map((e) => ({ tab: t.tab, ...e }))), null, 2));
    process.exit(1);
  }
  console.log(`[sample] wrote ${OUT}: ${plan.tabs.map((t) => `${t.tab} +${t.counts.added}`).join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
