# Assessments (admin)

Define the assessment frameworks your staff will be asked to complete. **Admin-only.**

Domain-level actions live in the **⋯ (domain options)** menu next to the domain selector: **New**, **Edit**, **Import** (▸ **Domains** / **Footnotes**), and **Delete**. Item-level actions live in the **⋯ (item options)** menu on the right of the toolbar once a domain is selected: **Add Item** and **Import Items**.

## Domains

A **domain** is a named assessment framework, e.g. *Bioinformatics (BIO)*, *Administrative Controls (SAC)*. Each domain has:

- **Code** — short uppercase identifier used in URLs and exports
- **Name** — human-readable label
- **Version** — bump when you revise items; old responses keep their old version
- **Purpose** — a short purpose statement shown on the survey **Start** page (optional)
- **Introduction** — a longer introduction shown on the survey **Start** page (optional)

### Importing / updating domains from CSV

**⋯ → Import → Domains** uploads a CSV. Columns:

```
assessment_code,assessment_name
```

Optional `purpose` and `introduction` columns are supported — quote any field that contains commas. Re-importing **updates** existing domains (matched by code) with the new name/purpose/introduction and inserts any new ones, so this is the bulk way to set intro text across many domains at once.

## Items

Each domain has many **items** (subcompetencies). Every item has:

- `competency_value` — groups the item under a broader competency
- `competency_text` — label for the grouping
- `subcompetency_value` — unique within the competency
- `subcompetency_text` — label for the row
- Five descriptors: **beginner / competent / proficient / expert / N/A** — what each level looks like in practice

### Importing items from CSV

The bulk path. With a domain selected, open the **⋯ (item options)** menu and click **Import Items**, then upload a CSV with these columns:

```
competency_value,competency_text,subcompetency_value,subcompetency_text,beginner,competent,proficient,expert,na
```

Each row becomes one item. Order in the file becomes `sort_order`. You can re-import to append more; items are never deduplicated automatically.

## Footnotes

Footnotes define the marked terms (e.g. `*`, `‡`) that appear in item text. Each footnote is a **symbol → definition** pair belonging to a domain. On the survey, a footnote shows at the bottom of a page **only when its symbol appears in that page's text**, so respondents see just the definitions relevant to what's in front of them.

Import them with **⋯ → Import → Footnotes** — a global import (not tied to the selected domain). CSV columns:

```
domain_code,symbol,definition,sort_order
```

`sort_order` is optional. Because the import is keyed by `domain_code`, one file can carry footnotes for many domains; for each domain present in the file, its existing footnotes are **replaced** with that file's rows. Rows whose `domain_code` doesn't match a known domain are reported and skipped.

## Effects on surveys

Editing items affects **new** sessions only. Already-completed assessments keep their original JSON blob and response rows, so historical reports don't retroactively change when you tune the descriptors.

Bump the domain **version** if you're making substantive changes and want to distinguish old vs new snapshots in reports.
