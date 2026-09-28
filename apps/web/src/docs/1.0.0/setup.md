# Setup (admin)

All of the reference data your user directory and reports depend on. **Admin-only.** Tabbed layout — one tab per reference type.

## Regions

Top-level geographic groupings. A facility belongs to one region; a region aggregates data across every facility in it on the **National** report.

Fields: `code` (unique), `name`.

CSV import columns: `region_code,region_name`.

## Districts

Sit between regions and facilities. Each district belongs to exactly one region, and every facility belongs to exactly one district — the facility's region is taken from its district.

- A district with facilities can't be deleted; reassign the facilities first.
- A region with districts can't be deleted.
- Moving a district to another region moves its facilities with it (historical responses keep the region they were submitted under).

CSV import columns: `district_code,district_name,region_code`.

## Facilities

Individual labs / health facilities. Each facility:

- Belongs to a **district** (required; the region is derived from it)
- Links to **multiple departments** (many-to-many via the form's multi-select)
- Has a `facility_type` (free text — e.g. *"Reference lab"*, *"Provincial hospital"*)

CSV import columns: `facility_code,facility_name,facility_type,district_code,region_code` — `district_code` is required; `region_code` is optional and must match the district's region. Importing a code that already exists updates only that facility's district, which is the quickest way to assign districts to existing facilities.

## Departments

Functional units — e.g. *Microbiology*, *Bioinformatics*, *Administration*. Shared across facilities; link a department to a facility via the Facility form's multi-select.

CSV import columns: `department_code,department_name`.

## Org roles

Broad organisational roles — e.g. *"Laboratory Technician"*, *"Section Head"*, *"Quality Officer"*. Used as a filterable facet on the Users page.

CSV import columns: `role_code,role_name`.

## User titles

Job titles — narrower than org role. Used for display in the Department-level report's breakdown table.

CSV import columns: `title_code,title_name`.

## Order of operations

When setting up a fresh install:

1. **Regions** (nothing depends on this)
2. **Districts** (needs regions)
3. **Facilities** (needs districts)
4. **Departments** (standalone, or link to facilities afterward)
5. **Org roles** and **User titles** (standalone)
6. **Users** (can now pick facility + department + role + title)

Same order for CSV bulk import.
