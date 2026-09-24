# Phase 12 — Object Tables V1

Object Tables store structured information that belongs to one Object: maintenance
items, renovation materials, firmware test results, study chapters. The feature is
generic — no vehicle-specific, renovation-specific or domain-specific code exists in
it. Checklist still answers "what needs to be done?", Tables answer "what structured
information belongs to this Object?", Notes stay free-form, and Activity records what
changed.

## Model and migration

`drizzle/0009_loose_skin.sql` adds one enum and four tables. It only creates new
objects: no existing table, column or migration is touched.

| Table | Purpose | Key columns |
| --- | --- | --- |
| `object_tables` | Object 1:N Tables | `object_id` → `objects(id)` cascade, `title`, `position` |
| `object_table_columns` | Table 1:N Columns | `table_id` → `object_tables(id)` cascade, `name`, `type`, `currency`, `position`, `carry_forward` |
| `object_table_rows` | Table 1:N Rows | `table_id` → `object_tables(id)` cascade, `position`, `carry_forward` |
| `object_table_cells` | Cell = (row, column) | `row_id` → rows cascade, `column_id` → columns cascade, `value`, unique `(row_id, column_id)` |

`object_table_column_type` is a PostgreSQL enum: `text`, `number`, `date`,
`currency`, `checkbox`. Deleting an Object cascades to Tables → Columns/Rows →
Cells; deleting a Table removes its Columns and Rows; deleting a Row or a Column
removes the affected cells. The architecture is Object 1:N Tables, so supporting
several tables later needs no schema change and no 1:1 → 1:N migration.

## Cell representation

Cells hold canonical text and the server interprets it by column type. An empty value
is stored as **no row at all**, so "no value" and "empty value" can never diverge.

| Type | Stored as | Validation |
| --- | --- | --- |
| text | trimmed text | ≤ 2000 characters |
| number | `"86420"`, `"8.5"` | plain decimal only, no units, separators or exponents |
| date | `"2026-09-24"` | real calendar date; a pure day-count check avoids any timezone shift |
| currency | `"185.00"` | at most 2 decimals, normalised to exactly 2 without floating point |
| checkbox | `"true"` / `"false"` | strict two-value semantics |

A currency column also stores an optional 3-letter code (`EUR`, `USD`, `CNY`, `GBP`,
`JPY`, `CHF`, or any ISO-shaped code). The code is presentation only: the stored
amount never depends on it and there is no conversion or rate fetching.

## API

Three routes follow the existing App Router patterns (`authorizeDataAccess()` first,
zod `.strict()` request schemas, `Cache-Control: no-store`, `runtime = "nodejs"`), and
every mutation returns the authoritative new state so the client never guesses.

```text
GET    /api/objects/[objectId]/tables                  all tables with columns, rows and cells
POST   /api/objects/[objectId]/tables                  create_table
PATCH  /api/objects/[objectId]/tables/[tableId]        rename_table, add_column, update_column,
                                                       move_column, delete_column, add_row,
                                                       move_row, set_row_carry_forward, delete_row
DELETE /api/objects/[objectId]/tables/[tableId]        delete table (requires { confirmed: true })
PATCH  /api/objects/[objectId]/tables/[tableId]/cells  batched cell write (≤ 200 cells per request)
```

The PATCH body must target the Table in the URL, so a mismatched body cannot edit
another Table. Validation covers Object/Table/Row/Column existence and ownership,
allowed column types, positions, per-type cell values, string lengths and table size.
Rows and columns are resolved inside the addressed Table, so an ID from another Table
or Object is rejected instead of writing a cross-table cell.

## Limits

All limits live in `TABLE_LIMITS` (`lib/tables/model.ts`); no magic numbers are
scattered across components.

| Limit | Value |
| --- | --- |
| Tables per Object | 5 |
| Columns per Table | 20 |
| Rows per Table | 200 |
| Cells per single write | 200 |
| Table title / column name / cell value | 80 / 60 / 2000 characters |

## Ordering

`position` is an integer normalised to `0..n-1` inside its container, exactly like
Checklist and Board ordering. Inserts append, deletes renumber, and moves swap a
neighbour (`move_row`, `move_column` with a direction; boundary moves are safe
no-ops). Reads order by `(position, created_at, id)`. Rows and columns have stable
UUIDs and are never identified by array index.

## Drawer UI

`ObjectDrawer` keeps its existing order and gains one section, inserted between
Checklist and Dependencies: **Tables / Records**.

```text
Title, Goal, Current State / Next Action, Occurrence note, Checklist,
Tables / Records, Dependencies, Recurring, AI, Activity
```

- No tables yet → a short explanation plus `+ Add table`.
- `+ Add table` opens a compact dialog asking only for a title and the starting
  columns (default: one text column). No configuration wizard.
- Each table is collapsible and shows its row count, with inline rename, confirmed
  delete, and a horizontal scroll container so a 7-column maintenance table stays
  readable instead of being squeezed.
- Cells commit on blur or Enter (matching the existing inline editing style) and only
  when the value actually changed. Checkbox toggles commit immediately. A failed save
  restores exactly the values that write touched and shows the server message; other
  edits are never discarded.
- Column options (rename, type, currency, carry forward, move, delete) live in a
  native `<details>` menu in each column header.
- A column type change is applied only when every stored value already validates for
  the new type; otherwise it is refused with `COLUMN_TYPE_INCOMPATIBLE`. Compatible
  values are re-canonicalised in the same transaction, so a type change can never
  silently destroy data.

## Recurring Objects and carry-forward

When a recurring Object reaches Done, `generateNextOccurrence` calls
`copyTablesForRecurrence(tx, current.id, nextId)` **inside the same transaction**.
Carry-forward is explicit and stored per row and per column, defaulting to `false`:

- row `carry_forward` — "should this row exist again in the next occurrence?"
- column `carry_forward` — "should this column's value be preserved when a
  carry-forward row is recreated?"

Algorithm: copy every Table and every Column (name, type, currency, position,
`carry_forward`); copy only rows with `carry_forward = true`, keeping their order and
their flag; for each copied row copy a cell only when its column has
`carry_forward = true`. Everything else starts empty — including a checked checkbox in
a non-carried column, so completed historical work never leaks into the next
occurrence. The historical occurrence is only read.

```text
2026 Maintenance Items       2027 Maintenance Items
Engine oil      carry=true    Engine oil      (Maintenance Item copied)
Oil filter      carry=true    Oil filter      (all other cells empty)
Air filter      carry=true    Air filter
Replace wiper   carry=false    — row absent —
```

No heuristic inspects column or row names, and no AI decides what travels: the name
independence test uses a column literally named `Item` with `carry_forward = false`
and a column named `Xyzzy` with `carry_forward = true`. The flags are part of the
generic model and are stored for non-recurring Objects too; only the Drawer hides the
controls there, to avoid clutter. Each Object's tables belong to that Object: the
2026, 2027 and 2028 occurrences stay self-contained and no global maintenance table
exists.

## Activity

Three structural events were added: `table_created`, `table_renamed`,
`table_deleted` (a rename that does not change the title logs nothing). Cell edits,
row/column additions, removals and reordering produce **no** Activity entries, so
Activity stays meaningful instead of becoming a keystroke log.

## Archive, cancel and restore

Archive, cancel and restore only touch `objects`, so Tables are preserved and become
editable again after restore. Writes to an archived or cancelled Object are refused
with `OBJECT_ARCHIVED` while its records remain readable, so a historical occurrence
always shows exactly the records that belonged to it.

## Performance

`getObjects()` (the Board) is unchanged: Table and cell loading is Drawer-only detail
data. The Drawer loads one Object's tables in four queries (tables, columns, rows,
cells) with no N+1 pattern, and the Board payload never contains table structure or
cells.

## Tests

`tests/object-tables.test.ts` (51 tests) runs the real Drizzle queries and SQL
migrations in PGlite and covers structure, cells, canonical values, cascades,
cross-Object/cross-Table rejection, limits, per-type validation, ordering, column
type safety, archive/cancel/restore, Activity noise, UI rendering and scrolling,
Drawer regressions, auth boundaries, confirmed deletion, and the carry-forward matrix
(structure and flags copied, opted-in rows copied in order, values copied only from
opted-in columns, checked non-carried checkboxes not copied, all four value types
carried, historical occurrence unchanged, name independence, single generation,
transactional rollback).

## Deployment

```text
1. Merge to main (Vercel builds; the build does not run migrations).
2. Back up Neon.
3. npm run db:migrate        (or docker compose --profile tools run --rm migrate)
4. Verify drizzle.__drizzle_migrations contains 0009 and the four object_table_* tables exist.
5. Open an Object → create a table → add columns/rows → edit cells → reload.
```

Do not run the SQL by hand in the Neon SQL editor: a manual statement is not recorded
in `drizzle.__drizzle_migrations` and would desynchronise history.

## V1 limitations and V1.1 ideas

Not in V1 (intentionally): formulas, calculated columns, SUM/AVG, charts, relations,
Object references, lookups, rollups, attachments, rich text, cell or column level
permissions, CSV/Excel import, global views, filters, grouping, advanced sorting,
frozen columns, conditional formatting, real-time collaboration and AI-generated
tables. Tables are also not part of the JSON/CSV data export yet, and there is no text
search across cell values (the data is reachable through a stable API, so indexing
stays possible).

Ideas for later: a `select` column type, search across cells, inclusion of tables in
the data export, and an explicit template concept so a repeated occurrence could bring
its row labels forward too without any name-based guess.
