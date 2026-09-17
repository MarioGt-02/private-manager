# Phase 9 — UI/UX polish

The board and Object workspace use white/neutral surfaces, soft borders, compact
blue actions and shared button/input/error classes in `app/globals.css`.
The Drawer and AI Create use a native modal dialog for focus containment,
Escape handling and focus restoration. Drawer content scrolls independently.

Manual fields now await the existing Server Actions, retain input on failure,
and show Save/Cancel and pending feedback. Checklist rename uses the same editor;
add clears only after success. Concurrent manual/AI operations in the Drawer are
disabled while saving. No server validation or transaction semantics were changed.
The Board now consumes persisted rename/field/reorder return values and displays
the existing deterministic Next Action after successful checklist changes.

Progress/Replan remain mutually exclusive. Previews show titles instead of IDs,
completion/reopen/additions, and the resulting deterministic Next Action. Replan
includes Title/Goal and old/new changes, KEEP/MODIFY/REMOVE/ADD labels and the final
ordered checklist. Apply remains explicit; failed Apply preserves the preview.
The Phase 6 pure helper was moved to `lib/objects/next-action.ts` and re-exported
from the DB module so persistence and preview use the same unchanged rule.

Activity remains read-only and limited to 30 records, now within a bounded compact
scroll area. AI events have a text label and optional marker. No dead Generate
Next Action control remains. No new AI feature, schema, endpoint or deployment
configuration was introduced for Phase 9.

## Verification

Run:

```text
npx tsc --noEmit
npm run lint
npm run test:auth
npm run build
npm run test:auth:smoke
```

`tests/ui-polish.test.ts` covers progress/replan preview labels, hidden internal
IDs, Title/Goal changes, deterministic Next Action, stale IDs and escaping.

`tests/ui-polish.browser.mjs` runs an isolated real-browser fixture harness. It
uses the production CSS and actual React components, but replaces Server Actions,
Activity and AI endpoints with fixtures. It performs no live DB writes or provider
requests. Set `PLAYWRIGHT_MODULE` to an installed Playwright module path and
`UI_SCREENSHOT_DIR` to an output directory, then run:

```text
node tests/ui-polish.browser.mjs
```

Browser fixture checks cover desktop/mobile layout, long multilingual fields,
22 checklist items, Save/Cancel/failure retention, check/add/rename/delete/reorder,
AI mode switching, replan diff/failure/retry, Progress Apply, AI Create and pointer
drag/drop. Screenshots are emitted for visual inspection.

Mocked browser acceptance does not prove live PostgreSQL persistence or provider
availability. Those must be verified in the configured real application. Existing
optional Activity DB acceptance remains independently opt-in.

The auth smoke test explicitly marks its generated environment as processed to
prevent local .env expansion from modifying temporary bcrypt hashes. All original
authentication assertions remain intact; production auth code is unchanged.
