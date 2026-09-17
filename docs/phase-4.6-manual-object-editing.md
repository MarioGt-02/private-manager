# Private Manager — Phase 4.6 Manual Object Editing

## 1. Scope

Phase 4.6 implements only:

> Manual editing of an existing Object and its checklist.

The purpose is to make every important Object field directly editable without using AI.

This phase must preserve the current Kanban, authentication, PostgreSQL persistence, and AI Create behavior.

Do NOT implement later AI features in this phase.

---

# 2. Core Principle

Manual editing is deterministic.

The rule is:

```text
User edits
↓
Server validates
↓
PostgreSQL persists
```

No OpenAI call.

Manual editing must never trigger:

* AI Progress Update
* Generate Next Action
* Replan
* AI Create
* any hidden OpenAI request

---

# 3. Fields That Must Be Editable

Inside the existing Object Drawer, support manual editing of:

* Title
* Goal
* Current State
* Next Action

Checklist must support:

* check / uncheck
* add item
* rename item
* delete item
* reorder items

Status continues to be controlled primarily through Kanban drag/drop.

Do not redesign the lifecycle model.

---

# 4. UX Direction

Prefer inline editing over a large dedicated Edit mode.

Example:

```text
TITLE
Make a video
```

Clicking the value may turn it into:

```text
[ Make a video________________ ]

[ Save ] [ Cancel ]
```

Equivalent edit icons/buttons are acceptable if clearer.

Keep interaction compact and fast.

---

# 5. Field Editing Behavior

For Title, Goal, Current State, and Next Action:

1. user enters edit mode
2. local draft value is created
3. user changes text
4. user saves
5. server validates
6. database updates
7. UI reflects persisted value

Cancel must discard the unsaved local edit.

Do not mutate the visible persisted value before save unless using a carefully handled optimistic update.

---

# 6. Recommended Save Interaction

For multi-line fields:

* Goal
* Current State

Use textarea-style editing.

For shorter fields:

* Title
* Next Action

Use text input or textarea as appropriate.

Keyboard behavior may support:

```text
Esc → cancel
Ctrl/Cmd + Enter → save
```

Optional:

```text
Enter → save
```

for single-line fields.

Do not make keyboard shortcuts mandatory for MVP.

---

# 7. Validation Rules

Runtime server-side validation is required.

Suggested limits:

```text
title: 1–120 chars
goal: 1–1000 chars
current_state: 1–1000 chars
next_action: 1–500 chars
checklist title: 1–300 chars
```

Trim strings before validation.

Reject effectively empty strings.

Do not rely only on HTML input attributes or TypeScript types.

---

# 8. Object Field Update Boundary

Add a server-side mutation equivalent to:

```ts
updateObjectFields(
  objectId,
  {
    title?,
    goal?,
    currentState?,
    nextAction?
  }
)
```

Alternatively use smaller dedicated actions if that fits the existing code better.

Do not create an over-general arbitrary patch API.

Only explicitly allowed fields may be updated.

---

# 9. Authentication

Every manual editing mutation must require authentication.

Pattern:

```text
Server Action / Route
↓
requireAuth()
↓
validate input
↓
DB mutation
```

Unauthenticated mutation:

```text
rejected
↓
0 DB changes
```

Do not rely solely on the Drawer being visible to an authenticated user.

---

# 10. Database Layer

Keep authorization at the browser-facing server boundary.

Low-level DB query functions should remain reusable.

Suggested DB functions:

```ts
updateObjectFields(...)
createChecklistItem(...)
renameChecklistItem(...)
deleteChecklistItem(...)
reorderChecklistItems(...)
```

Existing:

```ts
updateChecklistItem(...)
```

may continue handling completed state.

Avoid duplicating SQL logic in React components.

---

# 11. Updated At

When an Object field changes:

```text
objects.updated_at
```

must be updated.

When a checklist item changes, its:

```text
checklist_items.updated_at
```

must be updated.

If checklist changes materially affect the Object, updating:

```text
objects.updated_at
```

is also acceptable and recommended for consistent Object freshness.

---

# 12. Activity Events

Manual edits should create Activity records in `object_updates`.

Use stable event names.

Recommended:

```text
object_edited
checklist_item_added
checklist_item_renamed
checklist_item_deleted
checklist_reordered
checklist_changed
```

Existing check/uncheck behavior may continue to use:

```text
checklist_changed
```

Do not create overly granular event types unless needed.

---

# 13. Activity Content

Keep activity text concise and human-readable.

Examples:

```text
Title updated.
Goal updated.
Current State updated.
Next Action updated.
Checklist item added: Buy screws
Checklist item renamed: Buy material → Buy pine boards
Checklist item deleted: Check dimensions
Checklist reordered.
```

Do not store secrets or hidden AI reasoning.

---

# 14. Transactions

Any operation requiring multiple database writes must use a transaction.

Example:

```text
update object field
+
insert object_updates row
```

should ideally be atomic.

Checklist operations that include:

```text
change checklist
+
update Object timestamp
+
insert activity
```

should use a transaction.

No partial state.

---

# 15. Checklist Add

User can add a checklist item.

UI example:

```text
+ Add item
```

On add:

1. create local input
2. user enters title
3. save
4. server validates
5. determine position
6. insert row
7. create activity
8. return persisted item

New item defaults:

```text
completed = false
```

Position should normally be appended after the last current item.

---

# 16. Checklist Rename

Existing checklist item text must be editable.

Example:

```text
☐ Buy material
```

becomes:

```text
☐ [ Buy pine boards________ ]
```

Save persists the title.

Check state must remain unchanged.

Position must remain unchanged.

---

# 17. Checklist Delete

Checklist item can be deleted.

A small:

```text
×
```

or menu action is acceptable.

For MVP, a lightweight confirmation is recommended if accidental deletion is likely.

Example:

```text
Delete this checklist item?
```

Do not create a complex modal framework solely for this.

---

# 18. Empty Checklist

Existing product philosophy expects Objects to normally have an execution path.

However, manual deletion may result in zero checklist items.

Choose one consistent MVP rule:

Preferred:

> Allow zero checklist items temporarily.

Reason:

Manual editing should not trap the user.

AI Create can still require at least one checklist item at creation time.

Existing Objects may temporarily have none during manual restructuring.

Do not auto-create placeholder items.

---

# 19. Checklist Reordering

Support manual ordering.

Preferred:

```text
drag-and-drop checklist items
```

or simple move controls if implementation is cleaner.

Reordering must persist `position`.

After reorder, normalize positions:

```text
0
1
2
3
...
```

Do not trust arbitrary client positions.

---

# 20. Reorder Request

Recommended conceptual input:

```ts
{
  objectId: string;
  orderedItemIds: string[];
}
```

Server must verify:

* Object exists
* all listed items belong to that Object
* no duplicate IDs
* no foreign Object items included
* list is structurally valid

Then assign normalized positions.

---

# 21. Reorder Security

Never let the client submit arbitrary:

```text
itemId + objectId
```

and assume ownership.

Server must verify the relationship.

A user may only reorder checklist items belonging to the specified Object.

Even though this is single-user, maintain data integrity.

---

# 22. Editing and AI Fields

Manual editing of:

```text
Current State
Next Action
```

must be allowed even though AI will later manage these fields too.

The user always remains the authority.

Future AI features must respect manually edited values.

---

# 23. No Automatic Derived Changes

When manually editing:

```text
Current State
```

do NOT automatically update:

```text
Next Action
Checklist
Status
```

When manually editing:

```text
Next Action
```

do NOT automatically alter checklist.

Manual edit means:

> Change exactly what the user asked to change.

No hidden reasoning.

---

# 24. Checklist Check/Uncheck

Preserve the current existing behavior.

Checking/unchecking:

```text
does not call AI
```

Persist immediately.

The activity event remains recorded.

Do not regress Phase 2 functionality.

---

# 25. Optimistic Updates

Optimistic UI is acceptable and desirable for:

* check/uncheck
* simple text update
* checklist reorder

Requirements:

```text
optimistic update
↓
server mutation
↓
success → keep
failure → rollback + error message
```

Do not leave the UI displaying data that failed to persist.

---

# 26. Error Handling

At minimum handle:

```text
invalid field value
not authenticated
Object not found
Checklist item not found
Checklist item/Object mismatch
database failure
```

Do not expose raw SQL/database errors.

UI may show a simple inline message.

No toast framework is required.

---

# 27. Editing State

Keep local UI state simple.

Example:

```ts
editingField
draftValue
saving
error
```

Checklist rows may manage their own temporary edit value or be controlled by Drawer state.

Do not introduce Redux/Zustand for this phase.

---

# 28. Concurrent Saves

Disable the corresponding save action while a mutation is in progress.

Avoid duplicate requests.

Full optimistic concurrency/versioning is not required for a single-user MVP.

---

# 29. Drawer Structure

Recommended resulting Drawer:

```text
Object Title
Status

GOAL
editable

CURRENT STATE
editable

NEXT ACTION
editable

CHECKLIST
☑ item
☐ item
☐ item

+ Add item

AI
Generate Next Action
Replan
Tell AI What Happened
```

AI buttons may remain placeholders until their phases are implemented.

---

# 30. Preserve Status Dragging

Do not replace the existing Kanban drag behavior.

The user should still move lifecycle status through the board:

```text
Idea
Ready
Doing
Waiting
Done
```

No separate elaborate status editor is necessary.

---

# 31. Title Editing and Card Refresh

If Title changes in the Drawer:

```text
Drawer title updates
+
ObjectCard title updates
```

immediately after successful persistence.

No page reload should be required.

---

# 32. Other Field Synchronization

After editing:

```text
Current State
Next Action
```

the ObjectCard must also reflect the updated values.

Goal remains Drawer-only unless the card already displays it.

Checklist progress must recalculate after:

```text
add
delete
check
uncheck
```

Reorder alone does not alter progress.

---

# 33. Board State

The existing Board should remain the primary client state holder unless current architecture suggests another simple structure.

On successful edit, update the matching Object in board state.

Avoid refetching the entire board after every small edit unless necessary.

---

# 34. Checklist Item Return Values

Server mutation should preferably return persisted data when useful.

Example:

```ts
createChecklistItem(...)
→ ChecklistItem
```

This prevents the client from inventing DB IDs.

Never generate a fake permanent ID client-side and assume it matches the database.

Temporary optimistic IDs are acceptable only if carefully replaced after success.

---

# 35. IDs

Database remains responsible for persistent:

```text
Object IDs
ChecklistItem IDs
```

Client must not control permanent DB identity.

---

# 36. Manual Editing API Boundary

Server Actions are recommended because the project already uses them for:

```text
moveObjectToStatus
setChecklistItemCompleted
```

Possible actions:

```text
updateObjectFieldsAction
addChecklistItemAction
renameChecklistItemAction
deleteChecklistItemAction
reorderChecklistItemsAction
```

Exact names may vary.

Do not expose database helpers directly to client code.

---

# 37. Validation Library

Reuse existing Zod.

Create schemas for manual edit inputs.

Do not duplicate validation logic across components.

Example conceptual schemas:

```text
objectFieldUpdateSchema
checklistCreateSchema
checklistRenameSchema
checklistDeleteSchema
checklistReorderSchema
```

Keep them focused.

---

# 38. AI Boundary Test

Add a test/assertion ensuring manual actions never import or invoke OpenAI.

At minimum verify manual edit Server Actions can execute with AI mocks showing:

```text
0 OpenAI calls
```

This product rule is important enough to test.

---

# 39. Authentication Boundary Tests

For each mutation type:

```text
unauthenticated
→ reject
→ 0 DB mutation calls
```

Test representative boundaries.

Do not assume Phase 4 tests automatically cover new actions.

---

# 40. Data Integrity Tests

Add focused tests for:

```text
field validation
add item
rename item
delete item
reorder normalization
duplicate reorder IDs rejected
foreign checklist item rejected
empty item title rejected
```

---

# 41. Existing Activity Compatibility

Preserve existing events:

```text
object_created
status_changed
checklist_changed
```

Do not break Activity records generated by previous phases.

---

# 42. No AI Calls

Explicitly ensure these operations have zero OpenAI calls:

```text
edit Title
edit Goal
edit Current State
edit Next Action
add checklist item
rename checklist item
delete checklist item
reorder checklist
check checklist
uncheck checklist
```

---

# 43. Database Persistence Acceptance

For each manual edit:

```text
edit
↓
save
↓
refresh browser
↓
change remains
```

This must be true.

---

# 44. Runtime Acceptance Scenario

Use an existing Object.

Example:

```text
Make a video
```

### Edit Title

Change:

```text
Make a video
```

to:

```text
Make desk build video
```

Expected:

```text
Drawer updates
Card updates
Refresh preserves title
```

---

### Edit Goal

Change Goal.

Expected:

```text
saved
refresh persists
```

---

### Edit Current State

Change:

```text
Planning
```

to:

```text
Topic and rough outline are complete.
```

Expected:

```text
Drawer + card update
refresh persists
no AI call
```

---

### Edit Next Action

Change to:

```text
Record the first camera test.
```

Expected:

```text
Drawer + card update
refresh persists
no AI call
```

---

### Add Checklist Item

Add:

```text
Create thumbnail
```

Expected:

```text
new persisted checklist row
progress denominator increases
```

---

### Rename Checklist Item

Rename:

```text
Publish
```

to:

```text
Publish on YouTube
```

Expected:

```text
completion state preserved
```

---

### Delete Checklist Item

Delete one item.

Expected:

```text
item removed
progress recalculates
refresh persists
```

---

### Reorder

Move:

```text
Create thumbnail
```

before:

```text
Edit video
```

Expected:

```text
new order displayed
refresh keeps order
positions normalized
```

---

# 45. Failure Acceptance

Simulate DB failure.

Expected:

```text
UI shows failure
optimistic change rolls back
no false success
```

---

# 46. Build Requirements

Must continue to pass:

```bash
npx tsc --noEmit
npm run lint
npm run build
```

Build must not require:

* reachable PostgreSQL
* OpenAI
* production domain

---

# 47. Recommended File Changes

Likely additions/changes:

```text
components/board/ObjectDrawer.tsx
components/checklist/Checklist.tsx

lib/actions/object-actions.ts
lib/db/queries.ts

lib/validation/
  object-edit.ts
```

Additional small components are acceptable:

```text
InlineEditableField.tsx
ChecklistItemEditor.tsx
```

Do not over-componentize simple UI.

---

# 48. Phase 4.6 Definition of Done

Phase 4.6 is complete when:

1. Title can be manually edited.
2. Goal can be manually edited.
3. Current State can be manually edited.
4. Next Action can be manually edited.
5. Checklist item can be added.
6. Checklist item can be renamed.
7. Checklist item can be deleted.
8. Checklist can be reordered.
9. Existing checklist check/uncheck still works.
10. All changes persist to PostgreSQL.
11. All mutation boundaries require auth.
12. ObjectCard updates with changed title/current state/next action.
13. Checklist progress updates correctly.
14. Failed writes rollback correctly.
15. Relevant activity records are written.
16. No manual operation invokes OpenAI.
17. Existing AI Create remains functional.
18. Existing drag/drop remains functional.
19. TypeScript passes.
20. ESLint passes.
21. Production build passes.

---

# 49. Explicitly Out of Scope

Do not implement:

```text
AI Progress Update
Generate Next Action
Replan
Activity Log UI
notifications
attachments
comments
multi-user permissions
Object dependencies
calendar
recurring tasks
deployment changes
```

---

# 50. Engineering Principle

Manual editing is the user's direct control path.

The permanent rule is:

```text
User may always correct the system manually.
```

AI may assist later, but AI must never become the only way to modify an Object.
