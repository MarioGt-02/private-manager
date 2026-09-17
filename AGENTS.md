# AGENTS.md

# Private Manager

## 0. Development Mission

You are building **Private Manager**, a personal object-based Kanban application.

The application is primarily designed for a single user and will initially be self-hosted on a personal NAS and accessed remotely through a personal domain.

The product must remain simple.

Do not turn Private Manager into a traditional project-management or task-management application.

The core philosophy is:

> **Manage things, not tasks.**

And:

> **One Object = One complete thing, outcome, or goal.**

This principle has higher priority than feature completeness.

---

# 1. Product Definition

Private Manager is an object-oriented personal Kanban.

A card represents one complete thing, outcome, or goal.

Examples:

* Make a table
* Make a video
* Build a website
* Prepare for an exam
* Buy a computer
* Renovate a room
* Learn a specific skill

The card is NOT an individual task.

Traditional Kanban:

```text
Card = Task

Make a table
├── Buy wood
├── Cut wood
├── Sand
└── Assemble
```

Private Manager:

```text
Card = Object

┌──────────────────────────────┐
│ 🪑 Make a table              │
│                              │
│ Current                      │
│ Table legs are cut           │
│                              │
│ Next                         │
│ Sand the table legs          │
│                              │
│ ████████████░░ 6/8           │
└──────────────────────────────┘
```

Never split a single Object into multiple Objects merely because it contains multiple steps.

---

# 2. Core Product Model

Every Object has four important concepts:

## 2.1 Goal

What the user ultimately wants to achieve.

Example:

```text
Build a 120 × 60 cm wooden desk.
```

---

## 2.2 Current State

What has actually been accomplished so far.

Example:

```text
The desk legs have been cut.
```

Current State is factual progress, not a status label.

Do not use:

```text
In progress
Planning
Almost done
```

as the Current State.

Those belong to the Kanban status.

---

## 2.3 Next Action

The single most useful next actionable step.

Example:

```text
Sand the desk legs.
```

The Next Action should be concrete enough that the user can immediately start doing it.

Avoid vague actions such as:

```text
Continue working on the desk.
Work on the table.
Make progress.
```

---

## 2.4 Checklist

Checklist represents the internal execution sequence of the Object.

Example:

```text
☑ Determine dimensions
☑ Design structure
☑ Choose material
☑ Buy material
☑ Cut wood
☐ Sand
☐ Assemble
☐ Finish surface
```

Checklist items are NOT Objects.

Users must be able to manually check and uncheck Checklist items.

Manual checklist operations must NOT call the AI.

---

# 3. Non-Negotiable Product Principles

These rules must always be respected.

### Rule 1

One Object represents one complete thing, outcome, or goal.

### Rule 2

Do not create separate Objects for individual checklist items.

### Rule 3

The user does not need to plan every step before starting.

### Rule 4

AI should help the user discover and maintain the next actionable step.

### Rule 5

Users always retain manual control.

### Rule 6

Deterministic operations should be implemented with normal application code.

### Rule 7

Reasoning operations should use AI.

```text
Deterministic operation → Code

Reasoning operation → AI
```

### Rule 8

Never allow AI to directly execute arbitrary database mutations.

AI produces structured proposals.

The backend validates and applies them.

---

# 4. MVP Goal

The MVP exists to validate one question:

> **Can I continuously move forward on many different things without turning everything into dozens of tiny tasks?**

The MVP should make it possible to:

1. Create an Object.
2. Discuss an Object with AI before creating it.
3. Move Objects between Kanban columns.
4. See Current State directly on the card.
5. See Next Action directly on the card.
6. Manually check Checklist items.
7. Tell AI what happened.
8. Let AI update Current State, Next Action, and Checklist.
9. Ask AI for the next action.
10. Replan an Object with user confirmation.
11. See a simple Activity history.

---

# 5. UI

The MVP should initially use one main page.

```text
┌──────────────────────────────────────────────────────────────┐
│ Private Manager                              + New Object ✨ │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ Idea        Ready        Doing        Waiting       Done     │
│                                                              │
│ ┌────────┐ ┌────────┐ ┌──────────┐                         │
│ │ 🎥 Video│ │ 🪑 Desk │ │ 💻 Website│                        │
│ │        │ │        │ │          │                         │
│ │Current │ │Current │ │Current   │                         │
│ │Idea    │ │Cutting │ │Coding    │                         │
│ │        │ │        │ │          │                         │
│ │Next    │ │Next    │ │Next      │                         │
│ │Plan    │ │Sand    │ │Test      │                         │
│ │        │ │        │ │          │                         │
│ │0/8     │ │5/8     │ │12/20     │                         │
│ └────────┘ └────────┘ └──────────┘                         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

Do not create multiple pages for Objects in the MVP.

---

# 6. Kanban Columns

MVP has exactly five fixed columns:

```text
idea
ready
doing
waiting
done
```

UI labels:

```text
💡 Idea
📋 Ready
🔨 Doing
⏸ Waiting
✅ Done
```

Cards are draggable.

Dragging a card only changes its status.

Example:

```text
doing → waiting
```

Backend:

```typescript
updateObjectStatus(objectId, "waiting")
```

No AI call is required.

Do not build a workflow engine.

Do not build custom columns in MVP.

---

# 7. Object Card

The front of the card is critical.

Without opening the Object, the user must be able to understand:

1. What is this?
2. Where is it now?
3. What should I do next?
4. How much of the checklist is complete?

Card:

```text
┌──────────────────────────────┐
│ 🪑 Make a table              │
│                              │
│ Current                      │
│ Desk legs have been cut      │
│                              │
│ Next                         │
│ Sand the desk legs           │
│                              │
│ ████████████░░ 6/8           │
└──────────────────────────────┘
```

Do not hide Current State or Next Action behind the drawer.

---

# 8. Object Drawer

Clicking an Object opens a right-side drawer.

Do not navigate to a separate page.

Example:

```text
┌──────────────────────────────────────┐
│ 🪑 Make a table                 ×    │
├──────────────────────────────────────┤
│                                      │
│ Status                               │
│ 🔨 Doing                             │
│                                      │
│ Goal                                 │
│ Build a 120 × 60 cm wooden desk      │
│                                      │
│ Current State                        │
│ Desk legs have been cut              │
│                                      │
│ Next Action                          │
│ Sand the desk legs                   │
│                                      │
│ ──────────────────────────────────── │
│                                      │
│ Checklist                   6 / 8    │
│                                      │
│ ☑ Determine dimensions               │
│ ☑ Design structure                   │
│ ☑ Choose material                    │
│ ☑ Buy material                       │
│ ☑ Cut wood                           │
│ ☑ Cut desk legs                      │
│ ☐ Sand                               │
│ ☐ Assemble                           │
│                                      │
│ ──────────────────────────────────── │
│                                      │
│ ✨ AI                                │
│                                      │
│ [Generate Next Action] [Replan]      │
│                                      │
│ [Tell AI what happened...]    [Send] │
│                                      │
│ Activity                             │
│                                      │
│ 09/08 User: Desk legs are cut       │
│ 09/08 AI: Next → Sand desk legs     │
└──────────────────────────────────────┘
```

---

# 9. Manual Checklist Interaction

Checklist is a first-class user interaction.

Users can:

* Check an item.
* Uncheck an item.
* Add an item.
* Edit an item.
* Delete an item.
* Reorder items.

Normal checklist operations must NOT call the AI.

Example:

```text
☐ Sand
```

User clicks:

```text
☑ Sand
```

Backend simply updates:

```typescript
completed = true
```

No AI request.

The progress indicator should update immediately.

---

# 10. Database

Use PostgreSQL.

MVP should have three core tables:

```text
objects
checklist_items
object_updates
```

Do NOT use the name `projects` in the database.

The conceptual entity is an Object.

---

## 10.1 objects

```typescript
Object {
  id: string

  title: string

  status:
    | "idea"
    | "ready"
    | "doing"
    | "waiting"
    | "done"

  goal: string

  current_state: string

  next_action: string

  created_at: Date

  updated_at: Date
}
```

---

## 10.2 checklist_items

```typescript
ChecklistItem {
  id: string

  object_id: string

  title: string

  completed: boolean

  position: number

  created_at: Date

  updated_at: Date
}
```

Foreign key:

```text
checklist_items.object_id
→ objects.id
```

---

## 10.3 object_updates

```typescript
ObjectUpdate {
  id: string

  object_id: string

  type: string

  content: string

  created_at: Date
}
```

The Activity Log should be based on this table.

Examples:

```text
User:
Desk legs are cut.

AI:
Next action → Sand desk legs.
```

---

# 11. AI Philosophy

AI is not an autocomplete feature.

AI acts as a personal project/object manager.

However:

> AI must not take control away from the user.

AI should:

* Ask questions.
* Clarify vague goals.
* Suggest plans.
* Generate checklists.
* Determine Current State.
* Determine Next Action.
* Interpret user progress.
* Suggest replanning.
* Summarize history.

AI should NOT:

* Automatically create multiple Objects.
* Automatically delete user work.
* Automatically overwrite a user's checklist during replanning.
* Directly execute arbitrary database queries.
* Be called for deterministic UI operations.

---

# 12. AI Create Object — Conversational Creation

This is an important part of the MVP.

Do NOT implement Object creation as:

```text
User input
↓
AI
↓
JSON
↓
Immediately create Object
```

Instead use a conversational flow.

---

## 12.1 Start

User clicks:

```text
✨ AI Create
```

The interface opens a conversational dialog.

Example:

```text
What do you want to make or accomplish?

[ I want to make a table ]
```

---

## 12.2 AI conversation

The AI should behave like a normal conversational assistant.

Example:

User:

```text
I want to make a table.
```

AI:

```text
Sure.

Do you already know roughly what size you want,
and what will you use the table for?
```

User:

```text
120 × 60 cm, mainly for my computer.
```

AI:

```text
Got it.

So far I understand:

• A 120 × 60 cm computer desk
• You want to make it yourself

Do you already know what material you want to use?
```

User:

```text
Pine wood. I want it finished by the end of the month.
```

AI:

```text
That is enough information to create the Object.

I suggest:

Make a 120 × 60 cm pine computer desk

Goal:
Finish the desk by the end of the month.

Current state:
Planning

Next action:
Decide the desk structure and thickness.

Checklist:
1. Decide dimensions
2. Design structure
3. Choose material
4. Buy material
5. Cut wood
6. Sand
7. Assemble
8. Finish surface

Create this Object?
```

The user can then:

```text
Create
```

or:

```text
Keep discussing
```

---

# 13. AI Create Confirmation

The AI must not decide on its own when to create the final database record.

The user must confirm.

Possible UI:

```text
┌──────────────────────────────────┐
│ Ready to create Object            │
│                                  │
│ Make a 120 × 60 cm desk          │
│                                  │
│ Goal                             │
│ Finish by the end of the month   │
│                                  │
│ Current                          │
│ Planning                         │
│                                  │
│ Next                             │
│ Decide structure and thickness   │
│                                  │
│ Checklist                        │
│ 8 items                          │
│                                  │
│ [Create Object] [Continue Chat]  │
└──────────────────────────────────┘
```

Only after the user confirms should the backend create:

```text
objects
+
checklist_items
```

---

# 14. AI Create Conversation Data

The conversational creation process is temporary until the user confirms creation.

The MVP does not require a separate permanent conversation database.

The conversation can initially live in frontend state.

If persistence becomes necessary later, introduce:

```text
ai_conversations
```

Do NOT add this table unless needed.

Keep the MVP database minimal.

---

# 15. Structured Output

Structured output is still required, but only at the point where structured data is actually needed.

During normal conversation:

```text
AI → natural language
```

When creating the Object:

```text
AI → structured output
```

When updating an Object:

```text
AI → structured output
```

When replanning:

```text
AI → structured output
```

Never force every AI message into JSON.

---

# 16. AI Create Schema

When the user confirms creation, AI should produce structured data similar to:

```typescript
CreateObjectSchema = {
  title: string,
  goal: string,
  current_state: string,
  next_action: string,
  checklist: string[]
}
```

Example:

```json
{
  "title": "Make a table",
  "goal": "Build a 120 × 60 cm pine computer desk and finish it by the end of the month.",
  "current_state": "Planning",
  "next_action": "Decide the desk structure and thickness.",
  "checklist": [
    "Decide dimensions",
    "Design structure",
    "Choose material",
    "Buy material",
    "Cut wood",
    "Sand",
    "Assemble",
    "Finish surface"
  ]
}
```

Backend validates the result before inserting it.

---

# 17. AI Function: Generate Next Action

This is one of the most important AI features.

User clicks:

```text
✨ Generate Next Action
```

Send only the necessary Object context:

```json
{
  "object": {
    "title": "Make a table",
    "goal": "Build a 120 × 60 cm desk",
    "current_state": "Desk legs have been cut",
    "next_action": "Sand desk legs",
    "status": "doing"
  },
  "checklist": [
    {
      "title": "Determine dimensions",
      "completed": true
    },
    {
      "title": "Cut desk legs",
      "completed": true
    },
    {
      "title": "Sand",
      "completed": false
    }
  ]
}
```

AI returns:

```json
{
  "current_state": "Desk legs have been cut",
  "next_action": "Sand the desk legs"
}
```

Backend validates and updates the Object.

---

# 18. AI Function: Tell AI What Happened

This should be a core MVP feature.

User writes:

```text
The desk top and legs have both been sanded,
but I haven't applied the finish yet.
```

AI determines:

```text
Completed:
- Sanding

Current State:
The desk top and legs have been sanded.

Next Action:
Apply the surface finish.
```

Structured output:

```json
{
  "current_state": "The desk top and legs have been sanded.",
  "next_action": "Apply the surface finish.",
  "completed_items": [
    "Sand"
  ],
  "new_items": []
}
```

The backend must verify that the referenced checklist items actually exist.

Do not blindly trust AI output.

---

# 19. AI Progress Update Rules

When processing a progress update:

1. Preserve existing completed work.
2. Infer which existing checklist items are completed.
3. Update Current State.
4. Determine the most useful Next Action.
5. Do not unnecessarily rewrite the entire checklist.
6. Do not create a new Object.
7. Do not delete checklist items.
8. Only add new checklist items when genuinely necessary.
9. If the AI wants to significantly change the plan, recommend Replan instead.

---

# 20. AI Replan

User can click:

```text
✨ Replan
```

Example:

```text
I decided that I don't want to build the drawers anymore.
```

AI analyzes the current Object and proposes a new plan.

The new plan must NOT immediately overwrite the existing checklist.

Instead show a diff:

```text
AI suggests a new plan

Current:
8 checklist items

Proposed:
6 checklist items

Removed:
- Build drawers
- Install drawer slides

Changed:
- Assemble desk

[Apply Changes]
[Cancel]
```

Only after user confirmation should the backend apply the changes.

Completed checklist items must be preserved whenever possible.

---

# 21. AI Database Safety

AI must NEVER directly access PostgreSQL.

Never implement:

```text
User
↓
AI
↓
Database
```

Use:

```text
User
↓
AI
↓
Structured Proposal
↓
Backend Validation
↓
Database
```

Backend validation must verify:

* Object ID
* Checklist item IDs
* Allowed status values
* Required fields
* String lengths
* Existing checklist items
* Allowed update operations

The AI has no database credentials.

---

# 22. AI Context

Never send the entire database to the AI.

For a single Object, normally send:

```text
Object:
- title
- goal
- current_state
- next_action
- status

Checklist:
- title
- completed

Recent updates:
- recent user updates
- recent AI updates
```

Target approximately:

```text
1,000–3,000 tokens
```

for normal Object reasoning.

Do not send unrelated Objects unless a feature specifically requires cross-Object reasoning.

---

# 23. Token Strategy

Do NOT call AI for:

* Opening the application.
* Loading the board.
* Opening an Object.
* Dragging a card.
* Changing status.
* Checking a checklist.
* Unchecking a checklist.
* Editing a checklist item.
* Reordering checklist items.
* Editing a title manually.

AI should only be called for reasoning tasks.

Examples:

```text
✨ AI Create
✨ Tell AI What Happened
✨ Generate Next Action
✨ Replan
```

This keeps API usage and latency low.

---

# 24. Activity Log

Activity history is part of the MVP.

Example:

```text
Activity

09/08
User:
Desk legs have been cut.

09/08
AI:
Next action → Sand desk legs.

09/09
User:
Desk top and legs have both been sanded.

09/09
AI:
Next action → Apply the surface finish.
```

Activity should be append-only.

Do not use AI to generate fake history.

Record actual user actions and AI actions.

---

# 25. Authentication and External Access

Private Manager will be deployed on a personal NAS and accessed through a public domain.

Therefore, authentication is REQUIRED even in the MVP.

This is not a feature to postpone.

The MVP only needs simple single-user authentication.

Do NOT build:

* Teams
* Roles
* Permissions
* Organizations
* Invitations
* Sharing

But the application must not be publicly usable without authentication.

Minimum requirement:

```text
Internet
↓
HTTPS
↓
Authentication
↓
Private Manager
↓
PostgreSQL
```

Never expose PostgreSQL directly to the Internet.

PostgreSQL should only be accessible from the application/server network.

---

# 26. NAS Deployment

The target deployment environment is a personal NAS.

Prefer Docker-based deployment.

Recommended architecture:

```text
Internet
    │
    ▼
Domain
    │
    ▼
HTTPS / Reverse Proxy
    │
    ▼
Private Manager
    │
    ▼
PostgreSQL
```

PostgreSQL should run privately inside the NAS environment.

Do not expose port 5432 publicly.

The application should be deployable using Docker Compose or an equivalent containerized setup.

Keep environment-specific configuration in environment variables.

Never commit:

* API keys
* Database passwords
* Authentication secrets
* Domain-specific secrets

to the repository.

---

# 27. Database Choice

Use PostgreSQL.

Use:

```text
PostgreSQL
+
Drizzle ORM
```

Do not use Supabase as the required production database for this project.

The application is intended to be self-hosted on the user's NAS.

Supabase may be used for development or temporary experimentation, but the application architecture must not depend on Supabase-specific database functionality.

The production database should be normal PostgreSQL.

This keeps the application portable.

---

# 28. Technology Stack

## Frontend

```text
Next.js
TypeScript
```

## UI

```text
Tailwind CSS
```

## Drag and Drop

```text
dnd-kit
```

## Backend

Use Next.js server-side functionality.

Do not create a separate backend service unless a concrete requirement appears.

## Database

```text
PostgreSQL
```

## ORM

```text
Drizzle ORM
```

## AI

OpenAI API.

API keys must only exist on the server.

Never expose the OpenAI API key to browser code.

---

# 29. Suggested Project Structure

```text
app/
├── page.tsx
│
├── api/
│   └── ai/
│       ├── create-object/
│       ├── update-progress/
│       ├── next-action/
│       └── replan/
│
components/
├── board/
│   ├── Board.tsx
│   ├── Column.tsx
│   ├── ObjectCard.tsx
│   └── ObjectDrawer.tsx
│
├── ai/
│   ├── AICreateDialog.tsx
│   ├── AIConversation.tsx
│   ├── AIInput.tsx
│   ├── AIResponsePreview.tsx
│   └── ReplanPreview.tsx
│
├── checklist/
│   └── Checklist.tsx
│
├── auth/
│   └── LoginForm.tsx
│
lib/
├── db/
│   ├── schema.ts
│   └── index.ts
│
├── ai/
│   ├── prompts.ts
│   ├── schemas.ts
│   └── client.ts
│
└── types/
    ├── object.ts
    └── ai.ts
```

Avoid names such as:

```text
Task
TaskCard
TaskList
TaskManager
```

Use:

```text
Object
ObjectCard
ObjectDrawer
ChecklistItem
ObjectUpdate
```

---

# 30. AI System Prompt

Base system prompt:

```text
You are the AI assistant for Private Manager,
an object-based personal Kanban application.

Core principle:

One Object represents one complete thing,
outcome, or goal.

Do NOT unnecessarily split one Object into multiple Objects.

The user may start with broad goals such as:

"Make a table."

"Make a video."

"Build a website."

"Prepare for an exam."

Your job is to help the user turn a broad goal
into an actionable internal plan while keeping
the entire goal as ONE Object.

Always distinguish:

1. goal

What the user ultimately wants.

2. current_state

What has actually been accomplished.

3. next_action

The single most useful concrete action the user
can take next.

4. checklist

A lightweight sequence of steps required to complete
the Object.

The next_action must be concrete enough that the user
can start immediately.

Do not create unnecessary micro-tasks.

Do not create separate Objects for checklist items.

Prefer approximately 5–15 checklist items for normal
Objects, but use fewer when the Object is simple.

When discussing a new Object:

- behave conversationally
- ask useful clarification questions
- do not immediately force structured output
- help the user clarify the goal
- identify missing information only when it materially
  improves the plan
- do not ask unnecessary questions

Only return structured JSON when the application explicitly
requests structured output.

When the user reports progress:

- infer which existing checklist items are completed
- update current_state
- determine next_action
- preserve completed work
- avoid unnecessarily rewriting the whole checklist

When replanning:

- preserve completed work
- propose changes instead of silently applying them
- never delete user work without confirmation

The user remains in control of all changes.
```

---

# 31. AI Response Modes

AI has two fundamentally different response modes.

## Conversational Mode

Used when discussing an Object.

```text
Natural language
```

Examples:

* Clarifying questions
* Suggestions
* Discussion
* Planning

No JSON required.

---

## Structured Mode

Used when the application needs to apply a change.

Examples:

```text
Create Object
Update Progress
Generate Next Action
Replan
```

Use strict schema validation.

---

# 32. Structured AI Schemas

Use Structured Outputs / JSON Schema or the equivalent strict schema mechanism provided by the selected OpenAI API.

Never parse arbitrary natural-language AI responses as if they were database commands.

Example:

```typescript
UpdateProgressSchema = {
  current_state: string,
  next_action: string,
  completed_item_ids: string[],
  new_items: string[]
}
```

The backend must validate the IDs and values before applying them.

---

# 33. Deterministic vs AI Operations

This distinction is mandatory.

## Deterministic → Code

```text
Drag card
Change status
Check checklist
Uncheck checklist
Edit title
Edit checklist
Delete checklist item
Reorder checklist
Open drawer
Calculate checklist progress
```

## Reasoning → AI

```text
Clarify an idea
Create an Object from conversation
Interpret user progress
Generate Next Action
Replan
Summarize
Recommend what to do next
```

Never use AI where normal application logic is sufficient.

---

# 34. MVP Features

The MVP includes:

```text
✓ Single Kanban board
✓ Five fixed columns
✓ Object cards
✓ Drag and drop
✓ Object drawer
✓ Goal
✓ Current State
✓ Next Action
✓ Checklist
✓ Manual checklist interaction
✓ Checklist progress
✓ Activity Log
✓ Simple authentication
✓ PostgreSQL
✓ AI conversational Object creation
✓ AI progress update
✓ AI Next Action
✓ AI Replan
```

---

# 35. Explicitly Do NOT Build in MVP

Do not implement:

```text
✗ Teams
✗ Multi-user collaboration
✗ Sharing
✗ Roles
✗ Permissions
✗ Comments
✗ @mentions
✗ File management
✗ Calendar
✗ Gantt
✗ Timeline
✗ Dependencies
✗ Sub-projects
✗ Recurring tasks
✗ Notifications
✗ Email
✗ Mobile app
✗ Desktop app
✗ Plugin system
✗ Multiple boards
✗ Custom columns
✗ Advanced automation
✗ AI autonomous execution
✗ AI agents
```

Do not add features merely because they are common in Trello or project-management software.

---

# 36. Future Feature: "What Should I Do Now?"

This is a post-MVP feature.

Example:

```text
✨ What should I do now?
```

AI can analyze multiple Objects and recommend the best next action.

Example:

```text
You currently have 7 active Objects.

Recommended:

🪑 Make a table

Why:
- No blockers
- Next Action is clear
- Estimated time: 30 minutes
- Completing it unlocks the next step

Do this now:

→ Sand the desk legs
```

Another example:

```text
I only have 30 minutes.
What can I do?
```

AI:

```text
Sand the desk legs.

Estimated time: 25 minutes.
```

This feature should be implemented only after the single-Object AI experience works reliably.

---

# 37. Development Order

Do NOT implement the entire application at once.

Build incrementally.

## Phase 1 — UI

Build:

```text
Board
Columns
ObjectCard
ObjectDrawer
Drag & Drop
```

Use temporary local data.

No AI.

No database initially.

---

## Phase 2 — Database

Implement:

```text
objects
checklist_items
object_updates
```

Use:

```text
PostgreSQL
Drizzle ORM
```

Implement CRUD.

---

## Phase 3 — Object Experience

Implement:

```text
Current State
Next Action
Checklist
Progress
Activity
```

Make sure the card front communicates the Object without opening it.

---

## Phase 4 — Manual Interaction

Implement:

```text
Drag status
Check/uncheck checklist
Add/edit/delete checklist items
Reorder checklist
Edit Object fields
```

All deterministic.

No AI calls.

---

## Phase 5 — Authentication

Implement the minimum single-user authentication required for secure external access.

Do not build a multi-user permission system.

---

## Phase 6 — AI Conversational Creation

Implement:

```text
User
↓
Conversation
↓
Clarification
↓
AI proposes Object
↓
User confirms
↓
Structured output
↓
Backend validation
↓
PostgreSQL
```

Do NOT implement one-shot JSON creation as the only flow.

---

## Phase 7 — AI Progress Update

Implement:

```text
User:
"The desk legs are finished."

↓
AI

↓
Structured proposal

↓
Backend validation

↓
Update Object
```

---

## Phase 8 — AI Next Action

Implement:

```text
[✨ Generate Next Action]
```

---

## Phase 9 — AI Replan

Implement:

```text
[✨ Replan]

AI proposal
↓
Diff preview
↓
User confirmation
↓
Apply
```

---

## Phase 10 — Polish

Only after the core workflow works:

```text
Loading states
Error handling
Empty states
Animations
Keyboard shortcuts
Responsive layout
Dark mode
```

Do not polish the UI before the core Object workflow works.

---

# 38. MVP Acceptance Scenario

The MVP is not complete because "the page works."

It must pass this scenario.

## Step 1

User starts with:

```text
I want to make a table.
```

AI discusses the idea naturally.

AI may ask questions.

AI does NOT immediately create the Object.

---

## Step 2

After enough information is available, AI proposes:

```text
Make a table

Current:
Planning

Next:
Determine dimensions

Checklist:
8 items
```

User confirms.

Only now is the Object created.

---

## Step 3

Object appears:

```text
Make a table

Current: Planning

Next: Determine dimensions

0/8
```

---

## Step 4

User drags:

```text
Idea → Doing
```

No AI call.

---

## Step 5

User manually checks:

```text
☑ Determine dimensions
```

Card immediately becomes:

```text
1/8
```

No AI call.

---

## Step 6

User tells AI:

```text
The table dimensions are now 120 × 60 cm.
```

AI updates:

```text
Current:
Dimensions are confirmed.

Next:
Choose the wood and thickness.
```

Checklist progress updates if appropriate.

---

## Step 7

User manually checks additional checklist items.

No AI calls.

---

## Step 8

User says:

```text
The table legs and tabletop have both been sanded.
```

AI identifies the completed checklist item(s), updates Current State, and determines:

```text
Next:
Apply the finish.
```

---

## Step 9

User drags:

```text
Doing → Waiting
```

No AI call.

---

## Step 10

At no point does the system create a second Object for:

```text
Buy wood
Cut wood
Sand
Assemble
```

There remains exactly:

```text
ONE Object

Make a table
```

If this scenario works reliably:

> **MVP is successful.**

---

# 39. Engineering Rules for Codex

Before implementing a feature, ask:

```text
Does this help the user continuously move an Object forward?
```

If not, it probably does not belong in MVP.

Prefer:

```text
Simple
Predictable
Local
Deterministic
```

over:

```text
Over-engineered
Highly abstract
AI-driven
Distributed
```

Do not introduce unnecessary services.

Do not introduce unnecessary dependencies.

Do not build generic abstractions before they are needed.

Do not build enterprise architecture for a personal application.

Keep the codebase understandable to one developer.

---

# 40. Most Important Product Rule

When there is a conflict between feature requests and the core product philosophy, prioritize:

> **One Object = One complete thing.**

The purpose of Private Manager is not to help users create more tasks.

Its purpose is to help users answer:

> **"What am I working on, where is it now, and what should I do next?"**

The user should be able to keep a broad goal such as:

```text
Make a table
```

without needing to manually transform it into:

```text
Buy wood
Cut wood
Sand
Assemble
Finish
...
```

The system should maintain that internal execution structure for the user.

The user owns the Object.

The user controls the Checklist.

The AI helps manage the path forward.

---

# 41. Final Product Philosophy

Private Manager should feel like:

```text
A personal manager
that remembers what I am working on,
understands where each thing currently stands,
and tells me the next useful action.
```

Not:

```text
A Todo List with AI.
```

Not:

```text
Trello with ChatGPT added.
```

Not:

```text
An autonomous AI agent.
```

The core loop is:

```text
Thing
 ↓
Clarify
 ↓
Object
 ↓
Do
 ↓
Report what happened
 ↓
AI understands progress
 ↓s
Next Action
 ↓
Do
 ↓
Repeat
```

This loop is the heart of Private Manager.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
