# Card hierarchy and legacy category accents

## Presentation

Cards remain white with a 5px left category accent and a compact text chip.
The predefined palette follows the original Tipo carta color families (cyan for
Informatica, yellow/amber for Macchina, brown for Legname, navy for Sport, orange
for Elettrico, and the other observed categories). Original category names,
including `Busnis` and lowercase names, are stored unchanged apart from outer
whitespace. Palette lookup is case-insensitive; unknown/empty categories use a
neutral accent. Empty categories have no chip and no `Unknown` label.

Title is the strongest element, clamped to two lines. Current is a neutral
three-line preview; Next has a subtle blue background, an arrow and stronger type,
clamped to two lines. The known `Imported from Kanban Tool.` banner is omitted
only from the Board preview. No stored description is shortened or rewritten.
Empty checklists show a muted `No checklist` instead of a 0/0 progress bar.
Drawer values remain complete, including multilingual content. Category is also
shown in the Drawer and compact archived rows; cancelled rows retain a struck
through title, explicit Cancelled badge and muted rose edge.

Resizable status columns and waterfall card layout remain intact. The visual
drag overlay now ignores pointer events so its return animation cannot intercept
another card interaction. No workflow/status/AI reasoning behavior was changed.

## Data and safe backfill

`drizzle/0002_object_category_presentation.sql` adds only nullable
`objects.category`. No category-management UI or AI Create field was introduced.
New/non-imported Objects remain null. JSON and CSV exports include `category`;
all existing IDs, statuses, archive/cancel values, timestamps, checklist and
Activity export fields are retained.

The separate command is:

```text
npm run backfill:categories -- "data/import/_2026_ Tasks.csv" --dry-run
npm run backfill:categories -- "data/import/_2026_ Tasks.csv" --apply
```

This does not run the Phase 10 importer. It parses only source IDs and Tipo carta
with the existing CSV parser, derives the unchanged deterministic import ID, and
requires both a matching database Object and `legacy_import` provenance.
Only null category fields are eligible. Existing categories are never overwritten.
Apply locks target Object rows and performs the backfill atomically. It writes
neither updated_at nor Activity. Invalid identity/duplicate input is rejected.
Reports and private snapshots remain under Git-ignored `data/import/reports`.

### Current database result — September 13, 2026

- Schema migration applied to the configured `private_manager` database.
- Source hash matched the original imported file.
- 130 source rows, 16 original category names, no missing categories.
- Dry-run: 130 eligible, 0 already set, 0 missing Object, 0 non-imported matches.
- Applied: category filled for 130 imported Objects; 7 others remain neutral.
- Subsequent dry-run: 0 eligible, 130 already set.
- Full-table comparison with the pre-migration snapshot confirmed all other Object
  fields, every timestamp, Checklist rows and Activity rows are unchanged.
- No Phase 10 re-import, seed or OpenAI request was executed.

Integrity report: `data/import/reports/category-backfill-verification.json`.

## Verification and files

Changed: ObjectCard, ObjectDrawer, ArchiveDrawer, Board drag overlay; Object and
archive types; DB schema/query projections and export serializer; package script
and Drizzle metadata. Added: `lib/presentation/category.ts`, dedicated category
backfill parser/DB helper/command, category density tests and browser fixture.
Existing transaction tests were extended to apply the additive category migration.

The in-memory PostgreSQL tests verify dry-run, preserving edited Object fields,
provenance, null-only eligibility, idempotency, whole-backfill rollback and exports.
Presentation tests verify safe palette fallback, labels, clamps and 0/0 handling.
Browser fixtures verify white surfaces/5px accents, short card heights, complete
Drawer content, mobile wrapping, category/cancel archive display and regressions
for column resizing, drag cancellation, AI workflows and archive/export controls.
Visual acceptance uses synthetic data; the separate real database snapshot audit
verifies the applied category-only change.

Validation commands:

```text
npx tsc --noEmit
npm run lint
npm run test:auth
npm run build
npm run test:auth:smoke
```
