# Users (admin)

Manage staff accounts. **Admin-only.**

## Adding a user

Click **Add User** in the top-right. Required:

- First name, last name
- National ID + ID type (`NRC`, `Passport`, `Other`)
- Email

Optional but highly recommended:

- **Facility** — controls which region/facility their responses roll up into
- **Department** — same, for the department axis
- **Org Role** and **Job Title** — for filterable reporting

System role (`staff` vs `admin`) gates access to Reviews and the national-level report.

When you save, the system generates a **temporary password** (visible in the table, with copy/reveal buttons). The new user will be asked to set their own password on first login.

## Importing users from CSV

**Import CSV** opens a dialog. Required columns:

```
first_name,last_name,national_id,id_type,email
```

Optional columns:

```
facility_code,department_code,role_code,title_code
```

Codes map to the values you set up on the **Setup** page. Unknown codes fail the **whole** import (validate-all-before-write). After a successful import, you get a dialog showing every generated username + temp password — export this to CSV immediately and share with each staffer individually.

## Editing + resetting

Click a row to edit. The **↻** icon resets a user's password (generates a new temp, forces `is_first_login = true`).

You can also disable a user — they keep their history but cannot log in.

## Search + pagination

The search box filters across name, username, email, facility, and department. The footer pagination controls let you choose 10/25/50/100 rows per page and jump to first/prev/next/last.
