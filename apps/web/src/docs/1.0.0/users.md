# Users (admin)

Manage staff accounts. **Admin-only.**

## Adding a user

Click **Add User** in the top-right. Required:

- First name, last name
- National ID + ID type (`NRC`, `Passport`, `Other`)
- Email

Optional but highly recommended:

- **Facility** — controls which region/district/facility their responses roll up into
- **Department** — same, for the department axis
- **Org Role** and **Job Title** — for filterable reporting

System role (`staff`, `admin` or `monitor`) gates access to Reviews, the national-level report and the survey — see **Partner (monitor) users** below.

When you save, the system generates a **temporary password** (visible in the table, with copy/reveal buttons). The new user will be asked to set their own password on first login.

## Partner (monitor) users

Use the **Partner (monitor)** role for people who monitor results but are not
assessed themselves — for example an NGO partner supporting a project.

- Pick one or more **Regions** instead of a facility. Facility, department, org
  role and title are not used for partners.
- Partners see summary reports for their regions: the region, its districts and
  its facilities (including per-department totals).
- Partners never open department or individual reports, and cannot take
  assessments.
- To protect individuals, any department, facility or district with only 1 or
  2 respondents shows as "Fewer than 3 respondents" for partners. Hiding then
  continues ("Hidden for privacy") until the hidden rows together cover at least
  3 people, so they can't be worked out by subtraction from the totals in a list.
  This applies on screen and in exports. Admins and staff still see the numbers.
- Partners only see approved submissions. The **Approved only** switch is
  locked on for them, and pending or rejected submissions are never counted in
  their reports or exports. Approving a submission adds it to what partners see.
- A district or facility that is hidden in its list can't be opened to read it
  either: its report opens with a "hidden for privacy" notice and no figures.
- For partners, a result counts only where it was recorded relative to each
  place's current location, so older results from districts or facilities that
  have since moved are held back, and the "unassigned" figure may show 0.
  (For admins and staff, past responses follow a moved facility within district
  and facility reports, but region-level figures keep the region they were recorded in.)
- Known limit: comparing the same place with and without a domain or competency
  filter can narrow down small groups, so partner access should go to trusted
  organisations.
- Partners cannot open the national report.
- A region can't be deleted while a partner is assigned to it — remove it from
  the partner first.
- Partners can also be created in bulk with the country setup workbook (`system_role` = `monitor` plus `region_codes`).

## Importing users in bulk

Bulk import lives on the **Setup** page (**Bulk import on Setup** links there): the **Users** tab of the country setup workbook. Users are matched by email; existing users keep their username and password, new users get a generated username and a temporary password, and users missing from the tab are **disabled** (never deleted). The preview shows every change first, and the import will not disable or demote you. Right after the import, **Download credentials** gives you each new user's username and temporary password — the download is offered only once, but temporary passwords stay visible on the Users page until each user's first login. The **Setup** docs page lists the columns and rules.

## Editing + resetting

Click a row to edit. The **↻** icon resets a user's password (generates a new temp, forces `is_first_login = true`).

You can also disable a user — they keep their history but cannot log in.

## Search + pagination

The search box filters across name, username, email, facility, and department. The footer pagination controls let you choose 10/25/50/100 rows per page and jump to first/prev/next/last.
