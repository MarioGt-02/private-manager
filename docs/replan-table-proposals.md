# Replan table proposals

Replan can propose up to five new Object tables, preview their columns/rows and save them only after confirmation. Legacy proposals default to `checklistMode: "replan"` and no tables.

## Table-only requests

The explicit single-command syntax `新增表格：电脑部件检查表格` (also 添加/新建/创建表格 and Add/Create table with a colon) is recognized as a table-only request. This narrow deterministic recognition does not override mixed changes or free-form reasoning.

- The requested named table must exist in `tablesToAdd`. A checklist step about using a table is not a substitute.
- If AI omits the table, the existing correction pass requests a complete replacement. A second failure returns an error, not a misleading successful preview.
- The backend reconstructs the existing checklist hierarchy and ignores any model-proposed checklist changes/removals in table-only mode.
- Title, Goal, Current State, completion, hierarchy, ordering, estimates and Next Action are preserved. Apply also enforces preservation independently of analyze.
- The preview shows the real table and a preservation/confirmation notice, not repeated KEEP rows or fabricated progress.
- Adding a record-keeping tool does not mean any hardware inspection or repair has happened. The prompt asks for blank results and unchecked inspection flags.

## Persistence

- Tables, checklist changes (for mixed proposals) and actual Activity entries share one transaction.
- Table helper validation enforces column definitions, cell types and exact row widths, even for callers that bypass route schemas. Positions append after the highest existing position, not the table count.
- Analyze issues a `proposalId`. Apply locks the Object and uses its actual `ai_replan` Activity entry as the confirmation marker, so retrying the same proposal does not duplicate tables. Legacy proposals without an ID remain compatible but do not have this retry protection.
- No migration is needed. AI never directly writes to the database.

## Validation

- `tests/ai-hierarchy.test.ts`: exact Chinese command, missing-table correction/failure, no writes before confirmation, preserved nested checklist/estimates/facts, repeated Apply, empty and hostile preserve payloads, mixed changes, invalid cells/widths, sparse positions and transaction rollback.
- `tests/replan-validation.test.ts`: narrow command recognition and legacy schema behavior.
- `tests/replan-tables-preview.test.ts`: actual table preview with no fake checklist changes.
- `tests/workspace-features.browser.mjs`: analyze/cancel/apply/table refresh at 1440/375/390px with mocked services and real components/CSS.
- Optional live test: load the configured environment, set `RUN_REPLAN_TABLE_LIVE=1`, then run `tests/ai-hierarchy.test.ts` with name filter `live exact Chinese`. It calls the real configured AI provider but all persistence remains disposable PGlite; results are written only to ignored `coverage/replan-table-live.json`.

The live run during this change was blocked by an upstream 400: the configured `gpt-5.4-mini` was reported unsupported by the account's Codex/ChatGPT-backed connection. No model configuration was changed, so successful real-provider behavior is not claimed.