# Assessments (admin)

Define the assessment frameworks your staff will be asked to complete. **Admin-only.**

## Domains

A **domain** is a named assessment framework, e.g. *Bioinformatics (BIO)*, *Administrative Controls (SAC)*. Each domain has:

- **Code** — short uppercase identifier used in URLs and exports
- **Name** — human-readable label
- **Version** — bump when you revise items; old responses keep their old version

## Items

Each domain has many **items** (subcompetencies). Every item has:

- `competency_value` — groups the item under a broader competency
- `competency_text` — label for the grouping
- `subcompetency_value` — unique within the competency
- `subcompetency_text` — label for the row
- Five descriptors: **beginner / competent / proficient / expert / N/A** — what each level looks like in practice

## Importing items from CSV

The bulk path. Click **Import items** for a selected domain, upload a CSV with these columns:

```
competency_value,competency_text,subcompetency_value,subcompetency_text,beginner,competent,proficient,expert,na
```

Each row becomes one item. Order in the file becomes `sort_order`. You can re-import to append more; items are never deduplicated automatically.

## Effects on surveys

Editing items affects **new** sessions only. Already-completed assessments keep their original JSON blob and response rows, so historical reports don't retroactively change when you tune the descriptors.

Bump the domain **version** if you're making substantive changes and want to distinguish old vs new snapshots in reports.
