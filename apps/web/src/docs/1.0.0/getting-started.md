# Getting Started

Welcome to **LabWorkforce** — a tool for running competency assessments across your lab workforce, reviewing completed submissions, and producing reports that roll up from individuals to regions.

## What it does

1. **Assessment domains** — groups of competencies with proficiency descriptors (Beginner → Expert). A full catalogue ships with the app and can be updated from an Excel workbook or edited by hand.
2. **Collect self-assessments** — staff answer each competency on a 4-level scale (plus N/A) using the Survey page.
3. **Review submissions** — an admin approves or rejects each completed assessment; only approved submissions count toward reports by default.
4. **Analyse results** — drill down from National → Region → District → Facility → Department → Individual, with charts, stacked breakdowns, and PDF/Excel/CSV export.

## First-time setup (admins)

1. **Sign in** with the built-in admin account and set your own password.
2. **Setup → Get started** — export the country setup template, fill in regions, districts, facilities, departments, org roles, job titles and users, then import it. The preview shows every change before anything is saved. Keep your own admin account on the Users tab, and give every staff user a **facility** and **department**: responses snapshot them at completion time, so unassigned users don't roll up into regional reports. The **Setup** docs page lists the columns and rules; a [sample workbook](data/sample-country-setup.xlsx) shows a filled-in example.
3. **Hand out credentials** — straight after the import, download the new users' usernames and temporary passwords (shown only once). Users change the password at first login. You can also add or edit users one at a time on the **Users** page.
4. **Assessments** — the catalogue is already loaded. Review it on the **Assessments** page; use **Export catalogue / Import catalogue** for bulk changes.

To change the organisation later, export the setup, edit it and import it again — rows you remove are archived (or deleted when they have no history) and users you remove are disabled.

## Daily use (staff)

- Open the **Survey** page, pick a domain, answer each competency.
- If you get interrupted, close the tab. The in-progress session auto-saves and shows up on **My assessments** with a **Resume** button.
- Once you submit, the assessment waits for admin review.

## Daily use (admins)

- **Reviews** shows completed submissions awaiting your decision. Approve to include in reports, reject with notes to exclude.
- **Reports** shows aggregated maturity levels by region/district/facility/department/individual. Click any bar or row to drill down.

## Roles

| Role  | Can see                                                  |
|-------|----------------------------------------------------------|
| admin | Everything — all reports, reviews, user/setup management |
| staff | Own assessments, facility-scoped reports (no national)   |

## Tips

- Pagination lives at the bottom of every large table. Use **Rows per page** if you want denser or lighter views.
- Use the search box on Users and Reviews to narrow long lists.
- Toggle **Approved only** on the Reports filter bar to see pending/rejected submissions too — useful when reviewing before approval.
- Most pages work on both dark and light theme; use the sun/moon icon in the top-right.
