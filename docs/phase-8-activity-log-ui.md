可以，建议保存成：

docs/phase-8-activity-log-ui.md
# Private Manager — Phase 8 Activity Log UI Engineering Specification

## 1. Scope

Phase 8 implements only:

> Activity Log UI for each existing Object.

The backend already records Object activity in `object_updates`.

This phase makes that history visible inside the Object Drawer.

Do NOT add new AI reasoning behavior in this phase.

---

## 2. Goal

The user should be able to open an Object and understand:

- what changed
- when it changed
- whether it was manual or AI-assisted
- how the Object reached its current state

The Activity Log is read-only.

Core flow:

```text
Open Object Drawer
↓
Load recent object_updates
↓
Map event types to readable labels
↓
Show newest first
3. Existing Event Sources

The implementation should inspect the current repository and support the actual stable event types already written by previous phases.

Expected event types include:

object_created
status_changed
checklist_changed
object_edited
checklist_item_added
checklist_item_renamed
checklist_item_deleted
checklist_reordered
ai_progress_update
ai_replan

If the repository contains additional legitimate event types, support them cleanly.

Do not rename historical database rows just for this UI.

4. UI Placement

Add an Activity section inside the existing Object Drawer.

Recommended order:

Title
Status

Goal
Current State
Next Action

Checklist

AI

Activity

Activity should be visually secondary to Current State, Next Action, and Checklist.

Do not let the Activity Log dominate the Drawer.

5. Basic Activity UI

Recommended display:

ACTIVITY

Today, 10:42
AI Replan applied

Today, 10:31
Checklist updated

Yesterday, 18:05
Status changed to Doing

Yesterday, 17:52
Object created

Each row should show at least:

readable event label/content
timestamp

Optional:

small icon
event category badge

Keep it visually simple.

6. Ordering

Display newest activity first:

created_at DESC

Do not show oldest-first by default.

7. Initial Limit

For MVP, load only a bounded number of recent updates.

Recommended:

20–50 entries

Prefer:

30

No infinite scroll is required.

No pagination UI is required unless already trivial.

8. Data Access

Add or reuse a server-side query such as:

getObjectUpdates(objectId, limit)

Requirements:

filter by object_id
order by created_at DESC
limit result count
return only fields needed by UI

Suggested shape:

type ObjectUpdate = {
  id: string;
  objectId: string;
  type: string;
  content: string;
  createdAt: Date | string;
};

Use the repository's existing naming conventions.

9. Authentication

Activity data is private.

Any browser-accessible server boundary used to fetch Activity must require authentication.

Pattern:

requireAuth()
↓
validate objectId
↓
load object activity

Unauthenticated access:

401 / redirect
0 private activity returned

Do not rely solely on the Drawer being protected.

10. Ownership / Integrity

Even though this is a single-user application, verify that activity rows belong to the requested Object.

Do not allow arbitrary update IDs to be fetched independently without Object context unless needed.

11. Read-only Behavior

Activity Log must not modify:

Object
Checklist
Status
Next Action
Activity rows

Opening, scrolling, or viewing Activity must produce:

0 DB mutations
0 OpenAI calls
12. No AI Calls

Activity rendering is deterministic.

Do NOT call OpenAI to:

summarize activity
rename activity
explain activity
group events
generate descriptions

Use stored type + content.

Future AI summaries may be added later, but not in Phase 8.

13. Event Presentation

Create a centralized mapping from event type to user-facing presentation.

Conceptually:

const activityMeta = {
  object_created: {
    label: "Object created"
  },
  status_changed: {
    label: "Status changed"
  },
  checklist_changed: {
    label: "Checklist updated"
  },
  object_edited: {
    label: "Object edited"
  },
  checklist_item_added: {
    label: "Checklist item added"
  },
  checklist_item_renamed: {
    label: "Checklist item renamed"
  },
  checklist_item_deleted: {
    label: "Checklist item deleted"
  },
  checklist_reordered: {
    label: "Checklist reordered"
  },
  ai_progress_update: {
    label: "AI Progress Update"
  },
  ai_replan: {
    label: "AI Replan"
  }
};

Do not scatter event-label conditionals throughout the component.

14. Activity Content

Use the existing content field as the main human-readable description.

Example:

type: checklist_item_added
content: Checklist item added: Buy wall plugs

UI may render:

Checklist item added
Buy wall plugs

if parsing is simple and robust.

However, do not create fragile regex parsing just to make the UI prettier.

If necessary, display:

Checklist item added
Checklist item added: Buy wall plugs

until future event metadata becomes more structured.

Correctness is more important than perfect formatting.

15. Unknown Event Types

The Activity UI must fail gracefully when it sees an unknown event type.

Example:

Unknown activity
<stored content>

or:

Activity
<stored content>

Do not crash because a historical/future event type is not mapped.

16. Timestamps

Display timestamps in the user's local browser time.

Recommended formatting:

Today, 10:42
Yesterday, 18:05
Sep 8, 14:31

A simpler localized format is acceptable:

09/09/2026 10:42

Do not hardcode one timezone.

The database should continue storing absolute timestamps.

17. Relative Date Formatting

If implemented, keep relative formatting deterministic.

Examples:

Today
Yesterday
Sep 8

Do not use an AI model for date formatting.

A lightweight utility or built-in Intl.DateTimeFormat is preferred.

18. Loading Strategy

Choose the simplest architecture that fits the current Drawer.

Acceptable approaches:

Option A — load activity with Object data

When opening Drawer, Object already contains recent updates.

Option B — lazy fetch when Drawer opens
Drawer opens
↓
fetch recent activity

Preferred if current Object payload should remain small.

Either approach is acceptable.

Do not refetch the entire board just to load Activity.

19. Lazy Loading Recommendation

If practical, prefer lazy loading Activity because:

board card data stays small
activity is only needed when an Object is opened
future history may grow

Example:

Object Drawer opens
↓
GET /api/objects/[id]/activity
↓
show latest 30

Equivalent authenticated Server Action is acceptable.

20. Recommended Endpoint

If using a route:

GET /api/objects/[objectId]/activity

Response:

type ActivityResponse = {
  updates: ObjectUpdate[];
};

Authentication required.

This route must:

0 OpenAI calls
0 DB mutations
21. Error Handling

Handle:

unauthorized
Object not found
database error
invalid Object ID

UI should show a small recoverable message:

Could not load activity.

Do not break the entire Drawer if Activity loading fails.

The rest of the Object must remain usable.

22. Loading State

Show a lightweight loading state:

Loading activity…

or skeleton rows.

Do not introduce a new UI framework solely for this.

23. Empty State

If an Object has no Activity rows:

No activity yet.

Do not hide the whole section without explanation.

24. Refresh After Mutations

Activity should update after meaningful Object changes.

Examples:

manual edit
checklist add/delete/rename
status change
AI Progress Apply
AI Replan Apply

Preferred behavior:

mutation succeeds
↓
refresh/reload Activity section

Do not require a full page refresh.

25. Avoid Optimistic Fake Activity

Do not invent Activity rows client-side before the server confirms the mutation.

The Activity Log represents persisted history.

Preferred:

server mutation succeeds
↓
server has inserted object_updates
↓
reload activity

This avoids timestamp/ID mismatches.

26. Activity and AI Progress

When Phase 5 Apply succeeds:

type = ai_progress_update

Activity UI should display it distinctly enough that the user can recognize an AI-assisted update.

Example:

✨ AI Progress Update
Completed installation position and updated next step.

Do not expose hidden model reasoning.

27. Activity and Replan

When Phase 7 Apply succeeds:

type = ai_replan

Example display:

✨ AI Replan
Changed the mounting plan to a desk-clamp storage solution.

Again, use the stored summary.

28. Activity and Manual Editing

Manual changes should remain clearly distinguishable from AI-assisted changes.

Example:

Object edited
Next Action updated.

versus:

AI Progress Update
Installation position confirmed.

Do not falsely label manual edits as AI-generated.

29. Status Changes

Status activity should be visible.

Example:

Status changed
Doing → Waiting

If current stored content only contains simpler text, display what exists.

Do not redesign the underlying event schema in this phase unless required for correctness.

30. Checklist Events

Checklist history can include:

Checked: Confirm dimensions
Unchecked: Prepare tools
Checklist item added: Buy screws
Checklist item renamed: Buy screws → Buy wall plugs
Checklist item deleted: Old mounting step
Checklist reordered.

Use stored activity content.

No need to reconstruct history from current checklist state.

31. Historical Accuracy

Activity represents what happened at that time.

Do not dynamically rewrite old entries based on the current Object title/checklist.

Example:

If an item was renamed later, historical entry may still say:

Checked: Buy screws

That is acceptable.

Activity is history, not current-state projection.

32. Deletion

Do not add Activity deletion controls.

Activity is append-only history for the MVP.

No:

delete activity
edit activity
clear history
33. Filtering

Do not implement advanced filters.

No need for:

AI only
Manual only
Checklist only
Date range
Search

in Phase 8.

All recent activity in one list is sufficient.

34. Grouping

Optional:

Group entries by:

Today
Yesterday
Older

Only if simple.

Do not make grouping a requirement.

35. Activity Count

No unread count or badge is required.

Do not add notification semantics.

36. Drawer Performance

Do not load thousands of Activity rows.

Use the limit.

Ensure opening an Object remains responsive.

37. Database Index

Inspect current schema.

If object_updates does not already have a useful index for:

object_id
created_at

consider adding an index such as:

(object_id, created_at)

or at least:

object_id

Only add a migration if materially useful.

Do not over-index the MVP.

38. API Response Validation

If using a route, runtime validate:

Object ID
optional limit if exposed
result serialization

Do not expose raw DB records containing unnecessary fields.

39. Client State

Keep Activity state local to the Drawer or a small Activity component.

Conceptual state:

{
  updates,
  loading,
  error
}

Do not introduce Redux/Zustand.

40. Recommended Components

Possible structure:

components/
  activity/
    ActivityLog.tsx
    ActivityItem.tsx

or keep it inside ObjectDrawer.tsx if small.

Do not over-componentize.

41. Recommended Read Function

Conceptually:

async function getObjectUpdates(
  objectId: string,
  limit = 30
): Promise<ObjectUpdate[]>

Order:

created_at DESC
42. Activity Refresh Trigger

After successful mutations, the Drawer should have a simple mechanism such as:

activityVersion++

or:

reloadActivity()

Do not tightly couple every mutation component directly to database reads.

Use a clean callback/event pattern.

43. AI Create

When a newly AI-created Object is opened, Activity should show:

Object created
Object created with AI assistance.

Do not add new special history storage.

Reuse object_updates.

44. No Schema Redesign

Phase 8 should primarily be a UI/read-layer phase.

Do not replace:

object_updates(type, content, created_at)

with a large JSON event system.

A richer event schema may be designed later if needed.

45. Accessibility

Activity entries should remain readable without depending only on color.

Use:

text labels
readable timestamps
reasonable contrast

Icons/colors may supplement labels, not replace them.

46. Mobile / Narrow Drawer

Activity content must wrap.

Long stored content should not overflow horizontally.

Do not require a wide desktop layout.

47. Tests

Add focused tests where practical.

At minimum:

Authentication
unauthenticated activity fetch
→ rejected
→ no private data
Ordering
updates returned newest first
Limit
only configured maximum rows returned
Object isolation
activity for Object A
→ never includes Object B
Unknown event type
renders without crash
Empty state
0 updates
→ "No activity yet."
Error state
DB/read failure
→ Activity error only
→ Drawer remains usable
AI boundary
activity fetch/render
→ 0 OpenAI calls
48. Runtime Acceptance Scenario

Open the existing Object:

安装120×60cm电竞洞洞板

Its history should include events from previous phases such as:

Object created
Status changed to Doing
Checklist item completed
AI Progress Update
AI Replan

Exact content depends on existing database history.

Expected:

ACTIVITY

Today 10:40
AI Replan
Changed plan to a desk-clamp storage solution.

Today 10:15
AI Progress Update
Confirmed the installation position.

Today 09:50
Checklist updated
Checked: 确定安装位置和布局需求

Today 09:30
Status changed
Status changed to Doing

Newest first.

49. Refresh Acceptance

Perform:

manual checklist edit
↓
save
↓
Activity section refreshes
↓
new persisted event appears at top

Then refresh browser.

Expected:

same Activity row still present
50. Phase 8 Definition of Done

Phase 8 is complete when:

Object Drawer contains an Activity section.
Activity reads from object_updates.
Only the current Object's activity is shown.
Newest entries appear first.
Entries show timestamp.
Event types have readable labels.
Stored content is displayed.
Unknown event types do not crash.
Empty state exists.
Read failure does not break the Drawer.
Authentication protects Activity reads.
Activity fetch performs zero DB mutations.
Activity performs zero OpenAI calls.
Recent history is bounded.
AI Progress events are visible.
AI Replan events are visible.
Manual events are visible.
Activity refreshes after successful Object mutations.
No Activity editing/deletion exists.
Existing Object functionality remains intact.
TypeScript passes.
ESLint passes.
Tests pass.
Production build passes.
51. Explicitly Out of Scope

Do not implement:

Activity search
Activity filters
Activity deletion
Activity editing
Activity export
notifications
unread badges
AI activity summaries
cross-Object activity feed
global timeline
audit dashboard
multi-user attribution
52. Engineering Principle

Activity answers:

What happened to this Object?

It does not answer:

What should happen next?

The log is historical, deterministic, and read-only.

Permanent rule:

Persisted Object events
↓
Readable history
↓
No AI required