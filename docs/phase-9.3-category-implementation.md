# Phase 9.3 Category & Accent Color

Implemented 2026-09-14. Real category backfill has NOT been applied.

## Model and migration

- `categories`: stable ID, name, predefined color token, created_at.
- `objects.category_id`: nullable foreign key, deletion restricted while referenced.
- Names are trimmed and validated (1-80 characters); database unique index on lower(btrim(name)).
- Colors: blue, cyan, teal, green, lime, amber, orange, red, rose, violet, indigo, slate, brown. No arbitrary CSS colors.
- Migration `0004_keen_diamondback.sql` creates the schema and inserts exactly eight default categories using fixed UUIDs. It does not assign Objects or run a backfill.
- Legacy `objects.category` text remains preserved as migration metadata. Live presentation uses categoryId and shared category records only. New Objects default to categoryId=null.
- Category deletion is intentionally omitted; create, rename and recolor are supported. This avoids introducing reassignment/deletion flows in this phase.

## Defaults and historical dry-run

| Category | Default color | Would assign |
| --- | --- | ---: |
| Tech & Software | blue | 20 |
| Maker & DIY | orange | 36 |
| Home & Life | slate | 13 |
| Vehicles | amber | 32 |
| Creative | violet | 9 |
| Health & Sport | green | 13 |
| Work & Business | cyan | 4 |
| Study & Learning | indigo | 0 |

Current database: existing `private-manager-db` container, database `private_manager`.
The stopped Docker engine/container was restarted; no replacement database was created.

Real command executed: `npm run backfill:categories -- --dry-run`.

- Imported Objects: 130
- Would assign: 127
- Would remain uncategorized: 3 (Lavoro urgente / Predefinito)
- Already categorized: 0
- Invalid/missing metadata: 0
- Changed: 0

Mapping uses preserved category text only, requires legacy_import provenance, and skips every existing categoryId. Informatica/GameMake map to Tech; Elettrico/Legname/Stampante 3D/3D modeling/cucire to Maker; casa/Cucina to Home; Macchina to Vehicles; Fotografia/Disegno/Musica to Creative; Sport to Health; Busnis to Work. Ambiguous and unknown values remain unclassified; no title inference or AI calls.

The command requires explicit --dry-run or --apply. Dry-run uses a read-only transaction. The write branch uses a single transaction and row locks and writes only category_id. It never updates timestamps, content, status, archives, checklist or Activity. The old Phase 9.2 text backfill helper remains for historical tests; the package command now runs the broad-category implementation.

Before/after schema migration SHA256 of all existing Object fields (excluding new category_id), checklist rows and Activity rows matched:
`1cf85ebe7b8d8a31176dc7bf56d2d1e60d7c82c8461a086072de5ef102b102a1`.

Do not run --apply against user data until the user approves the reported result.

## UI and server boundaries

- Top-bar Categories opens compact create/rename/recolor management.
- Drawer Category select includes No category and + New category. Archived Objects remain read-only until restored.
- Save failures retain the persisted selection and expose a simple retryable message.
- A shared category context updates every related Board card, drag overlay, Drawer and archive row after rename/recolor.
- Cards remain white with a 5px accent and subtle readable chip. Null category uses slate and no chip.
- Archive retains category accent; cancellation keeps line-through, badge and muted styling.
- Color swatches are keyboard-focusable buttons with accessible names, aria-pressed, ring and checkmark.
- GET/POST /api/categories use the existing requireAuth boundary before DB access. Mutations accept only create/update/assign and explicit validated fields.
- Assignment locks the Object, validates category existence, updates category_id/updated_at and inserts category_changed atomically. Assign/change/clear have readable Activity text. Same-value assignment is a no-op.
- Renaming/recoloring changes only the category row, not Objects or their Activity.
- No new OpenAI calls or changes to AI Create, Progress, Replan schemas/prompts.

## Export compatibility

JSON adds categories and objects.categoryId. Version stays 1 because fields are additive and no restore importer exists. The previous objects.category string is retained as legacy metadata for lossless old exports; it is not the active category name. Consumers should resolve categoryId through categories.

CSV keeps one row per Object and resolves category/category_color from current records. Both fields are empty for uncategorized Objects. The export reads all four tables in one consistent read-only snapshot and retains explicit field allowlists.

## Files

- Added lib/categories/{model,colors,backfill}.ts
- Added lib/db/{categories,broad-category-backfill}.ts
- Added app/api/categories/route.ts
- Added components/categories/{CategoryContext,CategorySelect,CategoryManager,CategoryColorPicker}.tsx
- Added drizzle/0004_keen_diamondback.sql and generated snapshot/journal entry
- Updated schema, Object/archive types, query mapping, Activity labels, JSON/CSV exports, and backfill command
- Updated Board, ObjectDrawer, ObjectCard and ArchiveDrawer
- Added tests/categories.test.ts and tests/categories.browser.mjs; updated existing isolated-DB tests to apply the new migration and assert the new canonical presentation

## Validation

- TypeScript: passed
- ESLint: passed
- npm run test:auth: 97 passed, 1 optional live Activity test skipped
- Production build: passed
- Existing archive/export/auth/import/sort tests: passed in the full suite
- Phase 9.3 focused tests: 28 passed, including all mapping cases, auth before DB, FK, duplicate names, token validation, assignment Activity, clear, transaction rollback, no-op dry-run, idempotency, old-field preservation, exports and presentation
- Real-component browser fixtures: assign/clear, failed-save retention, global blue-to-cyan recolor across two cards, create/rename, swatch selected state, mobile overflow passed
- Desktop/mobile screenshots visually inspected. UI tests and mutation tests use fixture APIs / isolated PGlite, never user Object writes or provider calls.
- Real current database: schema/default category migration applied; category backfill dry-run only, Changed: 0.

Stopped at Phase 9.3; no filters, tags, priority, category deletion, AI classification or deployment changes.
