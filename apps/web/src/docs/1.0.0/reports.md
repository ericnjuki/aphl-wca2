# Reports

The Reports page aggregates approved assessment responses across the whole organisation and lets you drill from National → Individual.

## The five levels

| Level         | What you see                                                         | Grouped by   |
|---------------|----------------------------------------------------------------------|--------------|
| National      | Every region, stacked-bar view + breakdown table                     | Region       |
| Region        | Every district inside the region (plus facilities not yet assigned a district) | District |
| District      | Every facility inside the district                                   | Facility     |
| Facility      | Every department linked to the facility                              | Department   |
| Department    | Every respondent in the department                                   | User         |
| Individual    | Per-competency averages, a radar chart, strengths/gaps, subcompetency detail | Competency   |

Drill down by **clicking a bar** in the stacked chart or **any row** in the breakdown table. The URL updates (`/reports/regions/:id`, `/reports/districts/:id`, `/reports/facilities/:id`, etc.) so your browser back button climbs back up.

## Who can see what

- **Admin** users see all six levels: national, region, district, facility, department, and individual.
- **Staff** (non-admin) see their own region, district and facility, departments within their facility, and individuals in their facility. They cannot open the national report or other regions.
- **Partner (monitor)** users land on their region (or a "Your regions" list if
  they have several) and can drill down to districts and facilities in those
  regions. Department and individual reports are not available to them.
  Partners only see approved submissions; pending and rejected ones are never
  counted for them.
  Rows with only 1 or 2 respondents are shown as "Fewer than 3 respondents";
  if that leaves one hidden row in a list, another is hidden too ("Hidden for
  privacy") so a list's totals can't reveal it on their own. Opening a hidden
  district or facility shows a "hidden for privacy" notice instead of its numbers.

## Filters (top bar)

- **All domains / domain picker** — restrict to one assessment framework
- **All competencies** — (enabled after picking a domain) restrict to one competency within it
- **Approved only** switch — default ON; turn OFF to include pending and rejected submissions in the aggregation (useful for pre-review previews). Partners always see approved submissions only — the switch is locked on for them.

## Maturity legend

Each stacked bar shows how many respondents landed in each level:

| Colour  | Level       | Numeric value |
|---------|-------------|---------------|
| Red     | Beginner    | 1             |
| Purple  | Competent   | 2             |
| Green   | Proficient  | 3             |
| Blue    | Expert      | 4             |
| Grey    | N/A         | 0 (excluded from avg) |

## KPI cards

- **Respondents** — distinct users matched by current filters
- **Avg maturity** — weighted 1–4 average across all responses (N/A excluded)
- **Regions / Districts / Facilities / Departments covered** — how many buckets have at least one respondent

## Unassigned banner

If you see a yellow banner *"N respondents are not attributed to a region"*, it means those users completed assessments without a facility assignment, so their data doesn't flow into any regional bucket. Fix by editing their row on **Users** and setting a **Facility**. Note that existing unattributed rows stay unattributed — we snapshot org context at submission time so historical reports don't rewrite when someone transfers.

On a **Region** report, the banner counts respondents whose facility has no district yet. Those facilities are listed under **Facilities without a district** so you can still open them. Assigning a district (Setup › Facilities, or the country setup workbook) also attributes that facility's earlier responses to the district. Responses submitted before a facility or district moved region keep their original region, so they show as unassigned there rather than under the district.

## Export

The **Export** button in the top-right produces:

- **PDF** — branded single-page report with the chart snapshot and the breakdown table
- **Excel** — 3-sheet workbook (Summary, Breakdown, and on individual level, Detail)
- **CSV** — single-sheet breakdown only

Exports respect the current level, filters, and drill-down.

## Staff access

Non-admin staff see reports **scoped to their own facility** only — they cannot open national or other-region views. They can also open the report for their own district. Their own `/reports/users/:me` always works.

## Archived places

A region, district, facility or department removed through the country setup workbook is archived when it has history. It still appears in reports — labelled "(archived)" — wherever it has respondents in the current view, so past results stay visible. Archived places without respondents in the view are left out.
