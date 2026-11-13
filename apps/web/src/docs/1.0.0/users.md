# Users

Manage staff accounts. **Admins** manage everyone; **facility admins** manage the users of their own facility (see **Facility admins** below).

## Adding a user

Click **Add User** in the top-right. Required:

- First name, last name
- National ID + ID type (`NRC`, `Passport`, `Other`)
- Email
- **Role** (see **Roles** below); the role decides where the user is placed

For facility admins and staff, optional but highly recommended:

- **Facility**: controls which region/district/facility their responses roll up into. The region and district pickers above it only narrow the facility list; a facility's region and district always come from the facility itself.
- **Department**: same, for the department axis
- **Org Role** and **Job Title**: for filterable reporting

When you save, the system generates a **temporary password** (visible in the table, with copy/reveal buttons). The new user will be asked to set their own password on first login.

## Roles

"Region" and "District" can be renamed for a deployment (for example *County* and *Sub-county*); the screens and role names use those names.

| Role | Placed at | Takes assessments | Reviews | Reports |
|---|---|---|---|---|
| Admin | nowhere | no | any submission | everything, including individuals |
| National | nowhere | no | no | the national report only, summary only |
| Region coordinator (e.g. *County coordinator*) | one region | no | no | their region and everything in it, summary only |
| District coordinator (e.g. *Sub-county coordinator*) | one district | no | submissions from facilities in their district | their district and its facilities, summary only |
| Facility admin | one facility | yes | staff and other facility admins in their facility | their facility, its departments and its individuals |
| Staff | one facility | yes | no | their own results |

- Nobody can approve or reject their own submission.
- National, region and district coordinators have no facility, department, org role or title. Only an admin can create them.
- A region can't be deleted while a region coordinator is assigned to it, and a district can't be deleted while a district coordinator is assigned to it. Move or remove the coordinator first.

## Summary-only reports

National users and region/district coordinators see **summary-only** reports, which protect individuals:

- They only see approved submissions. The **Approved only** switch is locked on for them, and pending or rejected submissions are never counted in their reports or exports. Approving a submission adds it to what they see.
- Any department, facility, district or region with only 1 or 2 respondents shows as "Fewer than 3 respondents". Hiding then continues ("Hidden for privacy") until the hidden rows together cover at least 3 people, so they can't be worked out by subtraction from the totals in a list. This applies on screen and in exports.
- A district or facility that is hidden in its list can't be opened to read it either: its report opens with a "hidden for privacy" notice and no figures.
- They never open department or individual reports. District coordinators see individual answers only in the **Reviews** detail of a submission they may review, never in reports.
- A result counts only where it was recorded relative to each place's current location, so older results from districts or facilities that have since moved are held back, and the "unassigned" figure may show 0. (For admins, past responses follow a moved facility within district and facility reports, but region-level figures keep the region they were recorded in.)
- Known limit: comparing the same place with and without a domain or competency filter can narrow down small groups, so summary-only access should go to trusted people.

## Facility admins

A facility admin manages the users of their own facility:

- They can add **Staff** and **Facility admin** users, always in their own facility.
- They can edit a user's name, email, department, org role and title, switch a user between Staff and Facility admin (but not their own role), and reset passwords.
- Only an admin can move a user to another facility, enable or disable a user, delete a user, or create national users and coordinators.

Coordinators can also be created in bulk with the country setup workbook (`system_role` = `county` plus one code in `region_codes`, or `subcounty` plus one code in `district_codes`).

## Importing users in bulk

Bulk import lives on the **Setup** page (**Bulk import on Setup** links there): the **Users** tab of the country setup workbook. Users are matched by email; existing users keep their username and password, new users get a generated username and a temporary password, and users missing from the tab are **disabled** (never deleted). The preview shows every change first, and the import will not disable or demote you. Right after the import, **Download credentials** gives you each new user's username and temporary password — the download is offered only once, but temporary passwords stay visible on the Users page until each user's first login. The **Setup** docs page lists the columns and rules.

## Editing + resetting

Click a row to edit. The **↻** icon resets a user's password (generates a new temp, forces `is_first_login = true`).

Admins can also disable a user — they keep their history but cannot log in.

## Search + pagination

The search box filters across name, username, email, facility, and department. The footer pagination controls let you choose 10/25/50/100 rows per page and jump to first/prev/next/last.
