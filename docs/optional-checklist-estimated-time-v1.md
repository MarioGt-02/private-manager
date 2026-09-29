# Optional Checklist Estimated Time + AI Estimation V1

## Model and migration

`0010_optional_checklist_estimated_time.sql` adds only nullable integer
`checklist_items.estimated_minutes`. Existing rows remain null. No historical
migrations, Object totals, deadlines, recurrence intervals or table carry-forward
rules are changed. Application validation accepts null or integer 1–525600.
Creation (including AI creation) does not require or generate estimates.

The client domain field is optional for legacy fixtures/payloads; persisted DB
reads normalize it to `number | null`. Estimates survive check/uncheck, edits,
archive/cancel/restore and Replan reuse of existing IDs. Newly added steps are
unestimated. Recurrence clones every stored estimate and resets completion.

## Helpers and semantics

`lib/estimates/time.ts` provides shared parser, formatter, leaf detection and
aggregation. Duration input uses explicit units (`15m`, `90m`, `1h`, `1h 30m`),
ignores surrounding/inter-unit whitespace and case, and rejects bare numbers,
fractions, negatives, garbage and out-of-range values. Empty input only means
clear when `allowClear` is explicit; the editor has a separate Clear action.

Only actionable leaves contribute to Total/Done/Remaining. A parent's stored
estimate is preserved when children are added but excluded while it has children.
Null leaves count as unestimated and contribute no numeric effort. No estimates
means no numerical summary/Card time, not an apparent zero-hour Object.

Estimated minutes are approximate **active human effort**, never delivery/waiting
time or calendar duration. The AI may propose null for passive waiting.

## Workspace and AI

Checklist leaves show a compact tappable duration/placeholder. Editing opens a
small wrapping editor with Save/Clear/Cancel and 44px mobile controls. Parents
with children have no estimate editor. The existing Workspace scrolling layout
is unchanged.

An optional summary near Checklist shows Total/Done/Remaining and unestimated
count. Cards show compact approximate remaining effort only when estimates exist.
The on-demand Estimate time with AI action defaults to Missing. The secondary
Re-estimate All action explicitly previews replacement values. Proposed durations
can be edited or cleared locally before Apply; Cancel performs no write.

Routes:
- POST `/api/ai/objects/[objectId]/estimate-time/analyze`
- POST `/api/ai/objects/[objectId]/estimate-time/apply`
- PATCH `/api/objects/[objectId]/checklist-estimate`

Analyze sends only Object fields, checklist hierarchy/completion/current estimates
and exact target IDs. No Activity or Tables. Empty checklists/already-estimated
Missing targets do not invoke AI. The strict provider schema constrains stable
IDs to the target enum; backend validation rejects unknown/duplicate/parent IDs,
out-of-range values and unrequested fields. There is no title-based ID matching.

Apply locks the Object/checklist, checks historical editability, validates every
estimate and compares the complete checklist snapshot (IDs, hierarchy, title,
position, completion and previous estimates) before any write. Stale proposals
are rejected as a whole. Missing cannot overwrite existing estimates even with
an updated client snapshot; explicit All permits replacements. One successful
batch adds at most one `time_estimates_applied` Activity event. Manual clear/set
uses compact `time_estimates_cleared` / `time_estimates_applied` events.

## Export

JSON v1 gains nullable `estimatedMinutes` and `parentId` per checklist row. CSV
preserves existing fields and appends `checklist_estimates_json` with stable ID
and nullable minutes. No export redesign or provenance metadata.

## Validation and deployment

Run `npx tsc --noEmit`, `npm run lint`, `npm run test:auth`, `npm run build`,
`npx drizzle-kit check`, and `npm run db:generate` (must report no further changes).
PGlite tests apply the real additive migration to a preexisting row. Browser
fixtures (`tests/estimates.browser.mjs`) mock all services and test manual edits,
proposal edit/cancel/apply/all, Card refresh, 375/390/1440px overflow and mobile
single-primary-scroll. Caller supplies `PLAYWRIGHT_MODULE` and `UI_SCREENSHOT_DIR`.

Production must be migrated **before** pushing application code to main/Vercel:
confirm target database and recoverable backup, verify existing ledger, run the
existing `npm run db:migrate` with the production environment, then verify 0010
hash and nullable integer column. Do not use ad-hoc ALTER TABLE, seed/reset or
edit history. Build/app startup do not automatically migrate.

## Implementation validation record

- TypeScript, ESLint and production build passed.
- Vitest: 439 passed / 3 skipped; 65 focused estimate tests.
- Real Edge fixtures passed at 375/390/1440px including editor-open overflow.
- Full Board desktop/mobile browser regression passed (manual/checklist editing,
  Replan/Progress, AI Create and drag/drop); old harness fixtures were updated
  for the existing hierarchy/recurrence/category/table/dependency contracts.
- Drizzle check passed; generate reported no further schema changes.
- Production target and recoverable backup were explicitly confirmed before migration.
- Existing `npm run db:migrate` applied 0010 successfully before Git push.
- Read-only verification confirmed 0010 hash, nullable integer, all old estimates
  null, retained record counts and unchanged historical record checksums.

## V1 limitations

- Approximate estimates, not timers/actual time/calendar scheduling.
- AI generation/review supports at most 500 checklist rows per Object.
- Full snapshot checks intentionally reject any intervening checklist edit.
- Passive waits may remain unestimated (null); repeated Missing may target them.
- No estimate provenance/confidence/history learning or automated AI calls.
- No live data mutations are required for UI/provider validation.