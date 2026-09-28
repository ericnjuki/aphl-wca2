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

## Filters (top bar)

- **All domains / domain picker** — restrict to one assessment framework
- **All competencies** — (enabled after picking a domain) restrict to one competency within it
- **Approved only** switch — default ON; turn OFF to include pending and rejected submissions in the aggregation (useful for pre-review previews)

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

On a **Region** report, the banner counts respondents whose facility has no district yet. Those facilities are listed under **Facilities without a district** so you can still open them. Assigning a district (Setup › Facilities, or a facilities CSV import) also attributes that facility's earlier responses to the district. Responses submitted before a facility or district moved region keep their original region, so they show as unassigned there rather than under the district.

## Export

The **Export** button in the top-right produces:

- **PDF** — branded single-page report with the chart snapshot and the breakdown table
- **Excel** — 3-sheet workbook (Summary, Breakdown, and on individual level, Detail)
- **CSV** — single-sheet breakdown only

Exports respect the current level, filters, and drill-down.

## Staff access

Non-admin staff see reports **scoped to their own facility** only — they cannot open national or other-region views. They can also open the report for their own district. Their own `/reports/users/:me` always works.
