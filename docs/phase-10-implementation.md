# Phase 10 — Historical data, archive and portability

## Model and migration

`objects.archived_at` and `objects.cancelled_at` are nullable timestamptz fields.
The five workflow statuses are unchanged. The migration
`drizzle/0001_object_archive_metadata.sql` adds both columns and a
`(status, archived_at)` index. Existing rows retain null metadata and stay on the
live Board. SQL is generated, not automatically applied by build/startup/import.
Apply the schema migration to a backed-up target before using these new endpoints.
No real database schema changes or historical write import were executed during
implementation; tests use an isolated in-memory PostgreSQL database.

The live query filters `archived_at IS NULL`, including its checklist join.
Each column's Archive button requests only its own archived status history.
History is ordered by archive timestamp (and ID tie-breaker), 30 rows per page,
with Load More. Only Done offers Completed; all columns offer All/Cancelled.
Archived details are read-only until restored. Cancellation requires confirmation,
sets both timestamps, and preserves the workflow status. Restore clears both
metadata fields and returns the Object to its original column. These operations
and their activity records are atomic. Repeated identical requests are no-ops.

New activity types: `object_archived`, `object_cancelled`, `object_restored`,
`legacy_import`. Historical records are not renamed for presentation.

## One-time Kanban Tool import

Source is a byte-identical copy at `data/import/_2026_ Tasks.csv`. The source and
reports are Git-ignored; no full historical CSV is committed as a test fixture.
The original file outside the project is untouched.

```text
npm run import:kanbantool -- "data/import/_2026_ Tasks.csv" --dry-run
```

The command uses csv-parse for tab delimiters, `sep=` prefix, quoted multiline
fields, empty cells and Unicode. It is never called by install/build/migration.
Mappings: Da fare → ready; In esecuzione → doing; Failed → waiting;
Completato → done; cancel → ready + cancelled/archive metadata. All cancellation
records are retained. The export does not reliably contain their previous column,
so Ready is an explicitly documented fallback, not a recovered historical fact.

IDs use UUIDv5 over `kanban_tool:<legacy ID>` with the fixed namespace in
`lib/import/kanbantool.ts`. Existing IDs are skipped, never overwritten.
Each inserted Object and its legacy_import event share one transaction. A failed
row rolls back and is reported while other valid rows can continue.

Goals stay empty. Descriptions and blocking reasons are preserved as historical
Current State context, never inferred into checklist items. Checklist starts empty;
Next Action uses the existing shared deterministic helper. Useful original fields
are retained in the import activity instead of adding priority/category features.

Source timestamps lack offsets. This run explicitly assumes **Europe/Rome**;
`--timezone=...` can select a different source timezone. Invalid and ambiguous
local timestamps are rejected rather than guessed. Original created/archive times
are preserved when present. Missing creation timestamps use migration time with a
report annotation. Cancel time is approximated by archive time; if both are absent,
migration time is used for both. `updated_at` and the import event timestamp record
migration time. The machine-readable report records each deterministic mapping,
all fallbacks, duplicates, invalid rows, failures and existing-ID checks.

### Real-file dry-run result — September 13, 2026

| Preserved status | Live | Archived |
|---|---:|---:|
| Idea | 0 | 0 |
| Ready | 16 | 24 |
| Doing | 2 | 0 |
| Waiting | 1 | 0 |
| Done | 12 | 75 |
| Total | 31 | 99 |

130 source rows; 24 cancelled (included in archived Ready); 0 already imported;
130 would import; 0 invalid; 0 failures; 0 duplicate source IDs.
Existing-ID lookup was verified against the configured database using SELECT only.
**Real imported rows: 0. Historical write import requires explicit user approval.**

Dry-run works without DB writes. If existing-ID lookup is unavailable, it reports
`alreadyExisted: null` and labels the count unverified instead of claiming zero.
Write mode refuses to proceed without the existing-ID lookup.

## Permanent exports

Authenticated `GET /api/export/json` and `/api/export/csv` export live, archived
and cancelled Objects. JSON is `private-manager-export`, version 1, and contains
all Object/checklist/activity fields and absolute timestamps. A read-only,
repeatable-read transaction produces a consistent three-table snapshot. Fields
are allowlisted; connection/environment/authentication configuration is excluded.

CSV is UTF-8 with BOM, one row per Object, archive/cancel flags/timestamps,
checklist counts and readable checklist text. csv-stringify performs escaping.
Formula-like spreadsheet cells are escaped for safe human viewing; JSON remains
the canonical exact backup. No JSON restore or scheduled export is provided.

The Data / Export button is separate from each column's archive history.
All browser-accessible archive/detail/lifecycle/export boundaries authenticate
before validation/database access and return safe errors. No new operation calls
OpenAI. Archive reads and exports perform zero DB mutations.

## Changed areas and verification

- Model/schema: `lib/types/object.ts`, `lib/db/schema.ts`, `drizzle/0001*` and metadata.
- Queries: `lib/db/queries.ts`, `lib/db/archive.ts`, `lib/db/export.ts`, `lib/db/legacy-import.ts`.
- Contracts/formatters: `lib/archive/schemas.ts`, `lib/portability/export.ts`, `lib/import/kanbantool.ts`.
- Boundaries: `lib/api/data.ts`, `app/api/objects/archived`, `app/api/objects/[objectId]`, lifecycle and export routes.
- UI: Board, Column, ObjectDrawer, ArchiveDrawer, DataExport, activity label mapping.
- Command: `scripts/import-kanbantool.ts`, package scripts/dependencies, ignored private data.
- Tests: `tests/phase10.test.ts`, `tests/phase10.browser.mjs`, updated synthetic metadata fixtures.

```text
npx tsc --noEmit
npm run lint
npm run test:auth
npm run build
```

Phase 10 tests execute the actual Drizzle queries and SQL migrations in PGlite,
covering defaults, filtering, status preservation, cancellation/restoration,
transaction rollback, import idempotency, dry-run, exports and auth boundaries.
The browser fixture harness covers per-column history/filtering, archived detail,
cancel confirmation/style, restoring to Doing and JSON/CSV downloads. It never
uses real history or live provider calls. Run it with the same PLAYWRIGHT_MODULE
and UI_SCREENSHOT_DIR setup described in Phase 9.

Actual missing-timestamp fallbacks in the real source: creation=0; cancellation/archive=3. All 24 cancelled records use archive time as the documented cancellation-time approximation.

Final verification: TypeScript and production build passed. 54 tests passed, 1 optional live Activity DB test skipped. Auth HTTP smoke passed. Phase 10 browser fixture checks passed. No real schema migration or historical write import was executed.
