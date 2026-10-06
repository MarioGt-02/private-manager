# Object workspace — optional features

Unused tools no longer reserve full sections in the Object workspace.

## Display rules

- Goal, Current State, Next Action, Checklist, AI assistance and Activity keep their existing presentation.
- Empty occurrence notes, time estimates, tables, dependencies and recurrence settings are accessed through a compact **Add to Object** row.
- Clicking an entry reveals its existing controls. Revealing a tool does not create records or request AI output; normal Save/Create/Analyze confirmation still applies.
- Saved notes, actionable checklist estimates and recurrence settings display automatically.
- Tables and dependencies still load when the workspace opens, so existing records and resolved/incoming relationships display automatically. Fetch failures remain visible rather than being mistaken for empty data.
- Replan's Activity refresh token continues to refresh tables, including tables added while their section was hidden.
- Reveal state is local to the open Object. Closing/reopening or switching Objects resets it; saved content remains visible. No preference table, database migration or new dependency is required.
- Archived Objects show existing content but do not offer the Add to Object row.

## Validation

Static UI regression tests are in `tests/workspace-layout.test.ts` and `tests/object-tables.test.ts`.

`tests/workspace-features.browser.mjs` uses the actual workspace components and built CSS with mocked APIs. It covers empty tools, all entry points, note/table saving, reopening, switching Objects, externally added table refresh, loading failures, mobile scroll and horizontal overflow at 1440, 375 and 390px. It does not access the live database or AI provider.

Set `PLAYWRIGHT_MODULE` to an available Playwright installation and `UI_SCREENSHOT_DIR` to an ignored output directory, then run `node tests/workspace-features.browser.mjs` after `npm run build`. The existing `tests/estimates.browser.mjs` also covers the new estimate entry followed by manual and AI estimate workflows.