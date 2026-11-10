# Assessments (admin)

Define the assessment frameworks your staff will be asked to complete. **Admin-only.**

Domain-level actions live in the **⋯ (domain options)** menu next to the domain selector: **New**, **Edit**, **Export catalogue**, **Import catalogue** and **Delete**. The **⋯ (item options)** menu on the right of the toolbar (once a domain is selected) has **Add Item**.

## The bundled catalogue

The app ships with an assessment catalogue — 20 domains, their competency items and footnotes — that is loaded automatically the first time it starts. Loading only ever adds what is missing (a missing domain; items or footnotes for a domain that has none), so restarts never overwrite changes you have made.

## Domains

A **domain** is a named assessment framework, e.g. *Bioinformatics (BIO)*. Each domain has a **code**, a **name**, a **version** (bump it when you revise items; old responses keep their old version), and optional **purpose** and **introduction** text shown on the survey **Start** page.

## Items

Each domain has many **items** (subcompetencies), grouped under competencies. Every item has a `competency_value` and `competency_text`, a `subcompetency_value` (unique within the domain) and `subcompetency_text`, and five descriptors: **beginner / competent / proficient / expert / N/A**.

## Footnotes

Footnotes define marked terms (e.g. `*`, `‡`) used in item text: a **symbol → definition** pair per domain. On the survey a footnote shows at the bottom of a page only when its symbol appears on that page.

## Catalogue workbook

To change many items at once, use the catalogue workbook:

1. **⋯ → Export catalogue** downloads `assessment-catalogue.xlsx` with the current catalogue.
2. Edit it in Excel. Tabs and columns (required in **bold**):

| Tab | Columns | Matched by |
|---|---|---|
| Domains | **domain_code**, **domain_name**, **version**, purpose, introduction | domain_code |
| Items | **domain_code**, **competency_value**, competency_text, **subcompetency_value**, **subcompetency_text**, **beginner**, **competent**, **proficient**, **expert**, na | domain_code + subcompetency_value |
| Footnotes | **domain_code**, **symbol**, **definition**, sort_order | domain_code + symbol |

3. **⋯ → Import catalogue** uploads it and shows a preview of what will be added and updated, with any errors pinned at the top. Apply when it looks right.

The catalogue import **only adds and updates** — nothing is ever removed. Delete items or domains here on the page instead. New items are added after a domain's existing items in sheet order; a blank footnote `sort_order` keeps the footnote's current position. Changing the `competency_value` of an item that already exists is an error in the preview, because past responses use it; change the item's text instead.

## Effects on surveys

Editing items affects **new** sessions only. Completed assessments keep their original answers and response rows, so historical reports don't change when you tune the descriptors. Bump the domain **version** for substantive changes.
