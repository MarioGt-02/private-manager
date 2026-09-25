# Phase 13 — Object Workspace Layout V2

This phase is a layout/UX refactor of the Object detail experience. It does not
change the data model, Object semantics or any feature behaviour: it only changes
where the existing pieces live and how much space they get.

## Why

The right-side Object Drawer grew to hold Title, Status, Category, Goal, Current
State, Next Action, Occurrence note, Checklist, Tables / Records, Dependencies,
Recurring, AI actions and Activity in one narrow 640px column. With Object Tables
in the picture, the main content needed more width, and history needed its own
region instead of trailing the content.

## Layout

```text
dialog.workspace-dialog[data-size="workspace"]     width: min(1180px, 94vw)
├── header (persistent, never scrolls)
│     OBJECT WORKSPACE · One complete thing.        [Archive] [Delete] [Close ×]
│     [Doing] [Category]
│     Title (inline editable)
├── confirmation / lifecycle error strip (only when needed)
└── body
    │   below lg: single stacked scroll · lg and up: fixed height, two columns
    ├── section[aria-label="Object content"]  (scrolls on its own from lg)
    │     Archived notice · Goal · Current State | Next Action
    │     · Occurrence note · Checklist · Tables / Records · Dependencies
    │     · Recurring · AI actions
    └── <aside>                               (scrolls on its own from lg)
          Activity
```

The header uses a flex column with an inner scroll region, so it stays visible
without `position: sticky` and creates no nested sticky behaviour.

## Dimensions

```css
.workspace-dialog[data-size="workspace"] { width: min(1180px, 94vw); }
```

- The base `.workspace-dialog` rule (640px) is untouched, so the eight other
  dialogs keep their size; only the Object workspace opts in by attribute.
- Activity sidebar: 250px at `lg`, 280px at `xl` — the main column (and therefore
  Tables / Records) keeps as much width as possible.
- 94vw keeps a sliver of the dimmed Board visible, so the Object still feels
  opened from the Board rather than like a separate page.

## Responsive behaviour

| Width | Behaviour |
| --- | --- |
| `xl` (≥1280px) | main column + 280px Activity sidebar |
| `lg` (1024–1279px) | main column + 250px Activity sidebar |
| below `lg` | one column: header, Object content, then Activity |

The two-column grid is `lg:`-prefixed only, so mobile never gets a forced
two-column layout, and the DOM order (content, then Activity) is the stacking
order on small screens.

## Scrolling

- `<dialog showModal>` plus `height: 100dvh` means the Board and the page behind
  the workspace never scroll.
- Desktop: the body is a fixed-height `overflow-hidden` grid and each column has
  its own `overflow-y-auto`. Two predictable scroll regions, no nested scrolling,
  and a long history never forces the main content to become extremely tall.
- Below `lg`: the body itself is the single `overflow-y-auto` container.
- The workspace never scrolls horizontally. Only a wide table's own viewport
  (`overflow-x-auto`) does.

## Activity sidebar

`ActivityLog` is reused as-is — one activity system, one persistence model, one
set of semantics. Only presentation changed: an optional `variant="panel"` drops
the inner `max-h-96` history cap (so the sidebar is the single scroll owner) and
the section's own top border, because the sidebar already provides the
separation. Loading, error, retry and the `version`-keyed refresh are unchanged.

## Table improvements

- Tables now use the width of the main column instead of the old 640px Drawer.
  Wide tables still scroll horizontally inside their own viewport.
- The column options no longer expand inside the table header. They are a compact
  `⋮` trigger plus a floating panel, so opening it cannot push table content down
  and cannot be clipped by the table viewport.

## Column menu (popover)

- Trigger: a real `<button aria-haspopup="dialog" aria-expanded aria-label>` per
  column header.
- Panel: `role="dialog"`, `position: fixed`, measured from the trigger on click.
  Fixed positioning is what makes the overlay work here: it is not clipped by the
  table's `overflow-x-auto` ancestor and does not participate in table layout,
  while still living inside the modal dialog's top layer and focus trap (a portal
  to `document.body` would land outside both). `app/globals.css` documents the
  constraint that the dialog must not gain `transform`/`filter`/`contain`.
- Operations: Rename (switches to a small input), Type, Currency (only for the
  currency type), carry-forward, Move left / Move right, Delete column. Deleting
  opens an inline confirmation step, so the menu never destroys data on a single
  click. Backend validation for incompatible type changes is unchanged.
- Keyboard/dismissal: the panel takes focus on open, returns focus to the trigger
  on close, closes on Escape or an outside pointer, and repositions while the
  table scrolls.

## Row carry-forward

Unchanged semantics. The row control is now a compact `↻` switch
(`role="switch"`, `aria-checked`) with the explicit accessible label
"Repeat this row in the next occurrence: row N" and the same text as a
`title` tooltip, so the icon never has to communicate on its own. It stays
visible only for recurring Objects.

## Density

Goal and Occurrence note dropped the boxed variant (which reserved ~88px of empty
space each) and now use the compact label + inline `+ Add …` treatment. Section
headings, borders and padding stay consistent with the rest of the app; no field
became a large card.

## Not changed

Object Tables backend (schema, `carry_forward`, API, cell validation, limits,
migration 0009), the recurrence copy algorithm, Activity persistence and
semantics, AI prompts/schemas/behaviour, the Board, and the data model. **No new
migration** and no Neon changes.
