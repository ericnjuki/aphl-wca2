# Setup (admin)

All of the reference data your user directory and reports depend on. **Admin-only.** Tabbed layout — one tab per reference type.

## Regions

Top-level geographic groupings. A facility belongs to one region; a region aggregates data across every facility in it on the **National** report.

Fields: `code` (unique), `name`.

CSV import columns: `region_code,region_name`.

## Facilities

Individual labs / health facilities. Each facility:

- Belongs to a **region**
- Links to **multiple departments** (many-to-many via the form's multi-select)
- Has a `facility_type` (free text — e.g. *"Reference lab"*, *"Provincial hospital"*)

CSV import columns: `facility_code,facility_name,facility_type,region_code`.

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
2. **Facilities** (needs regions)
3. **Departments** (standalone, or link to facilities afterward)
4. **Org roles** and **User titles** (standalone)
5. **Users** (can now pick facility + department + role + title)

Same order for CSV bulk import.
