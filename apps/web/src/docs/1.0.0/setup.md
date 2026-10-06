# Setup (admin)

All of the reference data your user directory and reports depend on. **Admin-only.** One tab per reference type, plus a country setup workbook to load or update everything at once.

## Country setup workbook

The quickest way to set up a country — and to keep it up to date — is one Excel workbook.

- **Export setup** (top right) downloads `country-setup.xlsx` with everything that is currently active. On a new system it is the empty template.
- **Import workbook** uploads a filled-in workbook, previews every change, and applies all of it in one go — or nothing.
- A worked example: [sample-country-setup.xlsx](data/sample-country-setup.xlsx). Its first Users row is the built-in admin account; replace it with your own admin account before importing.

When there are no regions yet, the Setup page shows a **Get started** card with three steps: export the template, fill it in, import it.

### Tabs and columns

Required columns are in **bold** (shaded in the exported file). The **Read me** tab explains the rules and is ignored on import.

| Tab | Columns |
|---|---|
| Regions | **region_code**, **region_name** |
| Districts | **district_code**, **district_name**, **region_code** |
| Departments | **department_code**, **department_name** |
| Facilities | **facility_code**, **facility_name**, facility_type, **district_code**, department_codes |
| Org Roles | **role_code**, **role_name** |
| Job Titles | **title_code**, **title_name** |
| Users | **email**, **first_name**, **last_name**, **national_id**, **id_type**, system_role, facility_code, department_code, org_role_code, title_code, region_codes, status, username |

- `department_codes` and `region_codes` take several codes separated by `;`.
- `id_type` is `NRC`, `Passport` or `Other`; `system_role` is `staff` (default), `admin` or `monitor`; `status` is `active` (default) or `disabled`. The exported file offers these as dropdowns.
- `username` is filled in on export and ignored on import.
- A facility's region always comes from its district.

### How an import works

- Codes and emails are matched ignoring upper/lower case. To rename something, keep its code and change the name. Changing a code removes the old item and adds a new one.
- **Every tab you include is the complete list.** Items missing from a tab are **archived** when they have history (survey responses, or — for org roles and titles — users pointing at them) and **deleted** when they have none. Users missing from the Users tab are **disabled**, never deleted. A user whose `status` is `disabled` counts the same way as one missing from the tab.
- **Leave a tab out** of the workbook to keep that kind of data exactly as it is.
- A code that matches an archived item restores it.
- Existing users keep their username and password. New users get a generated username and a temporary password. These are shown once, straight after the import, with a **Download credentials** button; each user must change the password at first login.

### Preview, errors and warnings

The preview has one section per tab with coloured counts (added, updated, restored, archived, deleted, disabled) and every change with its old → new values. Errors are pinned at the top with their sheet, row and column, and **Apply** stays disabled while there are any. Typical errors:

- a required column or value is missing, or a value is not one of the allowed ones;
- the same code or email appears twice, or two users share a national ID + ID type;
- a code refers to something that is not in the workbook (or, for a tab you left out, not active in the system);
- a user's department is not one of their facility's departments;
- a partner (monitor) has no regions, or has a facility, department, org role or title — or a non-partner has regions;
- something would be archived or deleted while an active user, or an item you left unchanged, still uses it;
- the import would disable or demote you, or leave no active admin.

Warnings do not block. Users being disabled — because they are missing from the Users tab or their `status` is `disabled` — are listed, and a red banner appears when more than half of a tab's existing items would be removed or disabled; that usually means the wrong file. When anything will be archived, deleted or disabled you tick a confirmation before applying. Apply checks the data again just before saving: if someone changed it between your preview and apply, the import is refused with "data changed — preview again" and nothing is saved.

## Regions

Top-level geographic groupings; a region aggregates every facility in it on the **National** report. Fields: `code` (unique), `name`. A region with districts, or assigned to a partner user, can't be deleted.

## Districts

Each district belongs to exactly one region, and every facility belongs to exactly one district.

- A district with facilities can't be deleted; reassign the facilities first.
- Moving a district to another region moves its facilities with it (historical responses keep the region they were submitted under).

## Facilities

Individual labs / health facilities. Each facility belongs to a **district** (the region is derived from it), links to **several departments**, and has a free-text `facility_type` (e.g. *"Reference lab"*).

## Departments

Functional units — e.g. *Microbiology*, *Administration*. Shared across facilities; a facility lists the departments it has. Department names must be unique.

## Org roles

Broad organisational roles — e.g. *"Laboratory Technician"*, *"Quality Officer"*.

## Job titles

Titles such as *Dr.* or *Ms.*, shown in the Department-level report.

## Archived items

Archived items keep their history in reports (labelled "(archived)" there, while they have respondents) but disappear from lists and pickers. Turn on **Show archived** above a table to see them greyed out; archived rows are read-only. To bring one back, include its code in the country setup workbook again and import.

## Editing one record

**Add** and the pencil icon edit a single record in place. Use the workbook for bulk changes.

Deleting a single region, district, facility or department that has past assessment data, or an org role or title that is still assigned to users, is refused. Remove it from the workbook instead, so it is archived and its history is kept.
