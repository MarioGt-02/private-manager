# AI Create: category suggestions

Implemented 2026-09-16. Category suggestions are part of the existing AI Create reasoning request. They remain proposals until the user confirms the editable draft.

## Files changed

- `lib/categories/suggestion.ts`: deterministic name resolution and typed invalid-category error.
- `lib/db/categories.ts`: read only IDs/names for current category choices.
- `lib/ai/prompts.ts`: domain-based category guidance using the runtime category list, with null for uncertainty and no category-driven clarification.
- `lib/ai/schemas.ts`: separate model suggestion from editable/finalized category IDs.
- `lib/ai/types.ts`: client draft category selection and response category options.
- `app/api/ai/create-object/chat/route.ts`: load categories after authentication, send only names, resolve model output, return draft/options.
- `components/ai/AICreateDialog.tsx`: retain returned options with the draft and submit the edited selection.
- `components/ai/ObjectDraftPreview.tsx`: editable Category dropdown, No category, and suggestion explanation.
- `app/api/ai/create-object/finalize/route.ts`: pass confirmed category to creation and return a clear validation error for missing categories.
- `lib/db/queries.ts`: validate and lock the selected category, then insert categoryId in the original creation transaction.
- `tests/ai-create-category.test.ts`: category resolution, authenticated route, transaction, regression and opt-in live tests.
- `tests/ai-create-category.browser.mjs`: real component browser interaction tests with fixture API responses.
- This implementation/validation report.

## Schema, API and persistence

The strict OpenAI output schema requires `suggestedCategoryName: string | null` within a proposal. The model sees current category names, never database IDs, colors, timestamps or unrelated data. Names and user-edited draft values are marked as data, not instructions. The compatible-provider parsing path defaults a missing suggestion to null.

The backend trims and compares names case-insensitively against the current request's DB category list. Exactly one match resolves to that record; unknown, ambiguous and null suggestions resolve to null. No fuzzy matching, category creation or category mutation occurs.

The chat API returns an editable `draft.categoryId` and `categories: { id, name }[]`. Finalization receives the user's `draft.categoryId`, accepting null (and defaulting omitted IDs to null for older clients). It authenticates first. Creation re-reads the category inside the transaction using a shared row lock before inserting the Object, checklist and original `object_created` Activity record. Missing/deleted IDs return HTTP 400 / `DRAFT_INVALID`; a replacement with the same name is not substituted. The existing foreign key remains an additional safeguard.

No DB migration is required: `objects.category_id` and its foreign key already exist. Status still defaults to `idea`. Checklist order/completion, deterministic Next Action derivation and creation Activity remain unchanged. No Progress/Replan implementation changes were made; regression tests confirm supplied category fields cannot change persisted categories.

The feature adds **zero OpenAI calls**: one existing reasoning request per conversation turn, zero during preview editing/finalization. Existing structured output and provider rate-limit handling remain intact. The implementation follows the existing strict schema mechanism documented in [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Validation

- TypeScript `npx tsc --noEmit`: passed.
- ESLint `npm run lint`: passed.
- Full suite `npx vitest run`: **116 passed, 3 skipped**. Skips are the pre-existing opt-in local DB read test and two opt-in live AI acceptance tests.
- Production `npm run build`: passed, including TypeScript and page generation.
- New deterministic tests cover matching/null/invented/ambiguous names, fresh custom/renamed categories, minimal model context, one reasoning call, authentication before DB/AI, 429 handling, final user overrides/null, deleted IDs and same-name replacements, rollback, default status/checklist/Next Action/Activity, and Progress/Replan category isolation.
- Browser harness: all five proposed categories × keep/change/clear (15 flows) passed; no write before confirmation, final selection submitted, one chat request per flow, deleted-category retry and mobile interaction passed. Inspected the rendered preview screenshot. These browser checks use fixture responses; persistence is separately tested against the real finalize handler and a disposable PostgreSQL-compatible PGlite database.

Real configured AI endpoint checks were also run. Initial prompts and expected final draft suggestions:

| Input | Final draft category | Conversation behavior |
| --- | --- | --- |
| Add automated backups to Private Manager | Tech & Software | Proposal on first turn |
| 给 Audi A3 贴车窗黑膜 | Vehicles | Proposal after specifying professional installation and unstarted work |
| 做一个3D打印的洞洞板支架 | Maker & DIY | Proposal after specifying desk mounting and measurement as the next step |
| 准备 Polito 数学考试 | Study & Learning | Proposal after specifying exam timing and available study materials |
| 以后想处理一些事情 | No category | Proposal after explicitly retaining the broad goal without guessing its domain |

All five final drafts matched expectations. For each real draft, keeping its suggestion, clearing it and selecting another existing category persisted correctly through the actual finalize handler in an isolated test database. Live acceptance used five initial conversation calls and four normal clarification follow-ups; this is test usage, not a new classification call in the product.

## Limits and reruns

The model can still ask useful questions about the Object before producing a draft. A vague first message therefore does not guarantee an immediate draft. Category uncertainty itself does not require clarification. Live semantic results can vary across runs; deterministic tests and backend validation do not rely on model consistency.

Dropdown options are the DB snapshot returned with the latest AI conversation response. Concurrent category deletion is rejected during finalization; the user can explicitly select No category or continue the conversation to reload choices. Concurrent renaming preserves identity through the category ID. No user database records were created during validation, and no deployment was performed.

Run normal tests with `npx vitest run`. To intentionally repeat real provider validation, set `RUN_AI_CATEGORY_LIVE=1`, load the configured environment, and run this test file with the name pattern `live`. This invokes both the initial acceptance and its continuation, storing results in ignored `coverage/ai-category-live.json`. Browser harness uses caller-provided `PLAYWRIGHT_MODULE` (or installed Playwright) and Microsoft Edge; results/screenshots go to ignored `coverage/category-validation/`.
