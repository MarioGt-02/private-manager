# Private Manager — Phase 3 Engineering Interface Specification

## Scope

Phase 3 implements only:

> AI Create Object

The feature must support:

```text
User starts AI Create
        ↓
Natural conversation
        ↓
AI asks clarification when useful
        ↓
AI produces Object draft
        ↓
User reviews / modifies / continues conversation
        ↓
User explicitly confirms Create
        ↓
Structured output
        ↓
Backend validation
        ↓
Transactional database creation
```

Phase 3 must NOT implement:

* Tell AI What Happened
* Generate Next Action for existing Objects
* Replan
* autonomous AI actions
* background agents
* multi-user AI context
* board-wide reasoning
* AI-triggered automatic status changes
* automatic DB writes during conversation

---

# 1. Core Architecture

AI Create must be separated into two phases:

```text
A. Conversation phase
B. Finalization phase
```

They must have separate server boundaries.

Recommended routes:

```text
POST /api/ai/create-object/chat
POST /api/ai/create-object/finalize
```

Equivalent Next.js Server Actions are acceptable if there is a strong architectural reason, but the same separation of responsibilities must remain.

---

# 2. Critical Safety Rule

The chat endpoint:

```text
/api/ai/create-object/chat
```

MUST NOT create, update, or delete database Objects.

It may only:

* accept conversation input
* call OpenAI
* return natural-language assistant output
* return/update a draft representation
* indicate whether a usable draft exists

Database mutation happens only after explicit user confirmation through finalization.

---

# 3. OpenAI API Key

The OpenAI API key must remain server-side only.

Example:

```env
OPENAI_API_KEY=
```

Never expose it through:

```text
NEXT_PUBLIC_*
client components
browser JavaScript
API responses
logs
```

The browser must never call OpenAI directly.

Correct:

```text
Browser
  ↓
Private Manager server
  ↓
OpenAI API
```

Incorrect:

```text
Browser
  ↓
OpenAI API
```

---

# 4. Conversation Request Type

Recommended TypeScript type:

```ts
type AIMessageRole = "user" | "assistant";

type AIConversationMessage = {
  role: AIMessageRole;
  content: string;
};

type DraftChecklistItem = {
  title: string;
  completed: boolean;
  position: number;
};

type CreateObjectDraft = {
  title: string;
  goal: string;
  currentState: string;
  nextAction: string;
  checklist: DraftChecklistItem[];
};

type CreateObjectChatRequest = {
  messages: AIConversationMessage[];
  currentDraft?: CreateObjectDraft | null;
};
```

Do not accept:

* arbitrary database IDs
* whole-board data
* unrelated Objects
* database credentials
* raw system prompts supplied by client

---

# 5. Conversation Request Validation

Before calling OpenAI, validate:

```text
messages exists
messages is an array
messages is not empty
roles are valid
content is string
message content is not unreasonably large
message count is bounded
currentDraft shape is valid if provided
```

Suggested initial limits:

```text
max messages: 30
max message content: 4000 characters
max total conversation input: reasonable bounded size
```

Exact limits may be adjusted, but input must not be unbounded.

Reject malformed requests before calling OpenAI.

---

# 6. Conversation Endpoint Responsibility

Endpoint:

```text
POST /api/ai/create-object/chat
```

Responsible for:

1. validate request
2. construct server-controlled system prompt
3. pass relevant conversation context to OpenAI
4. receive AI response
5. interpret AI response
6. return a safe response to the frontend

It must NOT:

```text
INSERT objects
UPDATE objects
DELETE objects
INSERT checklist_items
change object status
```

---

# 7. Conversation Response Type

Recommended:

```ts
type CreateObjectChatResponse = {
  message: string;
  phase: "clarifying" | "proposal";
  draft: CreateObjectDraft | null;
};
```

Meaning:

## clarifying

AI is still discussing / asking questions.

Example:

```json
{
  "message": "你准备主要用什么材料？有没有希望完成的时间？",
  "phase": "clarifying",
  "draft": null
}
```

## proposal

AI has enough information to propose an Object.

Example:

```json
{
  "message": "我建议把它整理成下面这个 Object。",
  "phase": "proposal",
  "draft": {
    "title": "制作一张电脑桌",
    "goal": "...",
    "currentState": "...",
    "nextAction": "...",
    "checklist": []
  }
}
```

---

# 8. Draft State

Before creation, draft data must NOT be persisted as a real Object.

For MVP, draft can live in:

```text
React client state
```

Example:

```ts
const [draft, setDraft] = useState<CreateObjectDraft | null>(null);
```

The conversation can also remain client/session state for MVP.

Do not add an `ai_conversations` PostgreSQL table in Phase 3.

Do not persist incomplete Objects into `objects`.

---

# 9. Draft Ownership

The currently visible draft is authoritative for user confirmation.

This is important.

If AI originally proposes:

```text
Title: 制作一张电脑桌
```

and the user manually edits it to:

```text
Title: 制作工作室电脑桌
```

then finalization must use:

```text
制作工作室电脑桌
```

not secretly revert to the earlier AI wording.

The user has final control over the draft.

---

# 10. Draft UI

When `phase === "proposal"`:

Display an editable Object preview containing:

```text
Title
Goal
Current State
Next Action
Checklist
```

Recommended controls:

```text
Create Object
Keep Discussing
```

Optional in Phase 3:

```text
Edit Title
Edit Goal
Edit Current State
Edit Next Action
Edit Checklist
```

Manual editing is preferred if it can be implemented cleanly.

---

# 11. Conversation System Prompt

The server must own the system prompt.

The client must not send or override it.

Use the previously defined AI Create behavior, including these rules:

```text
Manage things, not tasks.

One Object = one complete outcome.

Do not fragment one outcome into many Objects.

Ask clarification only when materially useful.

Do not over-question.

Current State = factual progress.

Next Action = one concrete immediately actionable step.

Checklist = meaningful internal execution stages.

Do not output JSON in normal conversation.

Once enough information exists, propose:
Title
Goal
Current State
Next Action
Checklist

Do not claim creation occurred.

Only explicit user confirmation allows finalization.
```

---

# 12. Model Context

For AI Create conversation, send only:

```text
system prompt
conversation messages
current draft if relevant
```

Do NOT send:

```text
all Objects
all checklist items
entire activity history
entire database
board state
unrelated user data
```

Phase 3 does not require board-wide context.

---

# 13. Proposal Detection

Do not rely only on parsing arbitrary natural-language markdown to discover a draft.

Prefer one of these architectures:

## Preferred

Use structured metadata / structured response internally while still rendering conversational text to the user.

For example, OpenAI response conceptually provides:

```ts
{
  message: string;
  phase: "clarifying" | "proposal";
  draft: CreateObjectDraft | null;
}
```

The user still sees natural language.

The application receives deterministic structure.

This is preferable to regex parsing headings such as:

```text
Title:
Goal:
Checklist:
```

Avoid fragile parsing.

---

# 14. Chat Structured Response Schema

If Structured Outputs are used for the chat endpoint, use a schema conceptually like:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "message": {
      "type": "string"
    },
    "phase": {
      "type": "string",
      "enum": [
        "clarifying",
        "proposal"
      ]
    },
    "draft": {
      "anyOf": [
        {
          "type": "null"
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "title": {
              "type": "string"
            },
            "goal": {
              "type": "string"
            },
            "currentState": {
              "type": "string"
            },
            "nextAction": {
              "type": "string"
            },
            "checklist": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "title": {
                    "type": "string"
                  },
                  "completed": {
                    "type": "boolean"
                  },
                  "position": {
                    "type": "integer"
                  }
                },
                "required": [
                  "title",
                  "completed",
                  "position"
                ]
              }
            }
          },
          "required": [
            "title",
            "goal",
            "currentState",
            "nextAction",
            "checklist"
          ]
        }
      ]
    }
  },
  "required": [
    "message",
    "phase",
    "draft"
  ]
}
```

Invariant:

```text
phase = clarifying → draft should normally be null
phase = proposal → draft must be present
```

Backend must enforce this.

---

# 15. Explicit User Confirmation

Creation must only happen after an explicit action.

Preferred UX:

```text
[ Create Object ]
```

Do not infer database authorization merely because the user sends text such as:

```text
looks good
```

if the frontend already offers a dedicated Create button.

For MVP, the Create button should be the canonical confirmation mechanism.

This makes the write boundary deterministic.

---

# 16. Finalize Request Type

Recommended:

```ts
type FinalizeCreateObjectRequest = {
  draft: CreateObjectDraft;
};
```

No need for:

```ts
confirmed: true
```

if the only way to call the endpoint is the explicit Create action.

The server still validates everything independently.

---

# 17. Finalization Endpoint

Endpoint:

```text
POST /api/ai/create-object/finalize
```

Responsibility:

```text
receive confirmed draft
        ↓
validate request
        ↓
normalize draft
        ↓
optional OpenAI structured normalization
        ↓
validate structured creation payload
        ↓
database transaction
        ↓
return created Object
```

---

# 18. Important Finalization Design Decision

If the proposal returned by `/chat` is already fully structured and editable, OpenAI does NOT need to be called again during finalization unless normalization is truly necessary.

Preferred MVP architecture:

```text
/chat
↓
OpenAI returns structured draft + conversational message
↓
user edits draft
↓
Create Object
↓
server validates current visible draft
↓
DB transaction
```

This is simpler, cheaper, and safer than:

```text
chat
↓
draft
↓
Create
↓
call OpenAI again
↓
hope it reproduces the same draft
```

The user's confirmed draft should be the source of truth.

---

# 19. Final Database Creation Type

Convert camelCase UI draft into DB-oriented input:

```ts
type CreateObjectInput = {
  title: string;
  status: "idea" | "ready";
  goal: string;
  current_state: string;
  next_action: string;
  checklist: {
    title: string;
    completed: boolean;
    position: number;
  }[];
};
```

For MVP:

```text
status = "idea"
```

by default.

Do not allow the AI to create directly in:

```text
doing
waiting
done
```

---

# 20. Final Structured Output

If OpenAI is used during finalization, its allowed output must strictly match:

```json
{
  "name": "create_object",
  "strict": true,
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "title": {
        "type": "string",
        "minLength": 1,
        "maxLength": 120
      },
      "status": {
        "type": "string",
        "enum": [
          "idea",
          "ready"
        ]
      },
      "goal": {
        "type": "string",
        "minLength": 1,
        "maxLength": 1000
      },
      "current_state": {
        "type": "string",
        "minLength": 1,
        "maxLength": 1000
      },
      "next_action": {
        "type": "string",
        "minLength": 1,
        "maxLength": 500
      },
      "checklist": {
        "type": "array",
        "minItems": 1,
        "maxItems": 30,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "title": {
              "type": "string",
              "minLength": 1,
              "maxLength": 300
            },
            "completed": {
              "type": "boolean"
            },
            "position": {
              "type": "integer",
              "minimum": 0
            }
          },
          "required": [
            "title",
            "completed",
            "position"
          ]
        }
      }
    },
    "required": [
      "title",
      "status",
      "goal",
      "current_state",
      "next_action",
      "checklist"
    ]
  }
}
```

---

# 21. Backend Validation

Never trust model output or browser input solely because TypeScript types exist.

Runtime validation is mandatory.

A validation library such as Zod may be introduced if appropriate.

Do not add a large framework solely for this.

Validate:

## Object

```text
title
goal
currentState
nextAction
```

must be non-empty after trimming.

## Length

Enforce reasonable maximum lengths.

## Checklist

Must:

```text
be an array
contain at least 1 item
not exceed configured maximum
have non-empty titles
have boolean completed values
```

## Position

Do not trust client/AI positions.

Normalize server-side:

```ts
checklist.map((item, index) => ({
  ...item,
  position: index,
}));
```

## Status

For MVP creation:

```text
idea
```

or at most:

```text
idea | ready
```

Do not accept arbitrary status strings.

---

# 22. Input Normalization

Before DB insertion:

```text
trim strings
remove accidental empty checklist items
normalize checklist positions
apply default status
```

Do not silently rewrite the meaning of the Object.

Normalization should fix structure, not content.

---

# 23. Database Transaction

Final creation must use the existing Phase 2 transactional `createObject` data-access function or equivalent.

One transaction:

```text
BEGIN

INSERT objects

INSERT checklist_items

INSERT object_updates

COMMIT
```

On failure:

```text
ROLLBACK
```

No partial creation.

---

# 24. Activity Record

Successful AI-assisted creation should write:

```text
type = "object_created"
```

Recommended content:

```text
Object created with AI assistance.
```

If current Phase 2 event names still use:

```text
created
status
checklist
```

Phase 3 is a good time to standardize them to stable values:

```text
object_created
status_changed
checklist_changed
```

Do not store chain-of-thought.

Do not store hidden AI reasoning.

---

# 25. Finalize Response Type

Recommended:

```ts
type FinalizeCreateObjectResponse = {
  object: ManagedObject;
};
```

If desired:

```ts
type FinalizeCreateObjectResponse =
  | {
      ok: true;
      object: ManagedObject;
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };
```

Choose one consistent API convention.

Do not return database secrets or raw SQL errors.

---

# 26. Error Response Standard

Recommended API error structure:

```ts
type APIErrorResponse = {
  error: {
    code:
      | "INVALID_REQUEST"
      | "AI_UNAVAILABLE"
      | "AI_INVALID_RESPONSE"
      | "DRAFT_INVALID"
      | "DATABASE_ERROR"
      | "RATE_LIMITED"
      | "INTERNAL_ERROR";
    message: string;
  };
};
```

Frontend uses `message`.

Detailed server exception information remains server-side.

---

# 27. Chat Error Cases

## Invalid input

Examples:

```text
empty message list
invalid role
oversized message
invalid draft
```

Return:

```text
400 INVALID_REQUEST
```

No OpenAI call.

---

## OpenAI unavailable

Examples:

```text
timeout
network failure
provider error
```

Return:

```text
503 AI_UNAVAILABLE
```

Frontend:

```text
Could not reach AI. Your current draft and conversation are still here.
```

Do not clear user input.

---

## Rate limit

Return:

```text
429 RATE_LIMITED
```

Keep conversation state.

---

## Invalid AI structured response

If response violates schema/invariants:

```text
502 AI_INVALID_RESPONSE
```

Do not invent a draft on the server.

Do not write DB.

---

# 28. Finalize Error Cases

## Invalid draft

Return:

```text
400 DRAFT_INVALID
```

No DB mutation.

---

## Database failure

Return:

```text
500 DATABASE_ERROR
```

Transaction rolls back.

Frontend must NOT display:

```text
Object created
```

unless the server confirms success.

---

## Duplicate submission

The UI should disable the Create button while the request is in flight.

For MVP this is sufficient.

If double creation becomes a real problem later, add idempotency.

Do not over-engineer idempotency in Phase 3 unless necessary.

---

# 29. Frontend State Model

Recommended conceptual state:

```ts
type AICreateState = {
  messages: AIConversationMessage[];
  draft: CreateObjectDraft | null;
  phase: "conversation" | "proposal" | "creating" | "error";
  isSending: boolean;
  error: string | null;
};
```

Do not add Redux/Zustand solely for this feature.

Local React state is sufficient for MVP.

---

# 30. AI Create UI Flow

Initial state:

```text
✨ AI Create
```

User clicks.

Open modal / drawer / dedicated AI panel.

Recommended behavior:

```text
AI Create
────────────────────────

User:
我想做一张桌子

AI:
你准备做多大？主要什么用途？

User:
120×60，电脑桌，我自己做。

...
```

When draft is ready:

```text
AI proposal
────────────────────────

Title
[ 制作一张电脑桌 ]

Goal
[ ... ]

Current State
[ ... ]

Next Action
[ ... ]

Checklist
☐ ...
☐ ...
☐ ...

[ Keep Discussing ] [ Create Object ]
```

---

# 31. On Successful Creation

After API success:

1. close or transition AI Create UI
2. add returned Object to board
3. place in Idea column
4. optionally open Object Drawer
5. clear AI Create conversation state

Do not reload entire page unless implementation simplicity strongly favors it.

Prefer updating board state with returned Object.

---

# 32. No Hidden AI Calls

The following operations must not call OpenAI:

```text
opening AI Create UI
opening Object Drawer
loading the board
dragging Object
checking checklist item
unchecking checklist item
editing normal Object fields
closing AI Create
viewing Activity Log
```

OpenAI is called only when:

```text
user sends an AI Create conversation message
```

and optionally:

```text
finalization requires explicit model normalization
```

For the preferred architecture, finalization should NOT require a second AI call.

---

# 33. Token / Context Strategy

Do not resend unlimited conversation history forever.

For MVP, cap conversation count/input size.

The AI only needs:

```text
AI Create system prompt
current creation conversation
current draft
```

Target normal requests to remain compact.

No entire database context.

---

# 34. Prompt Injection Boundary

User text must be treated as user content, not system instructions.

The server-controlled system prompt takes precedence.

Do not concatenate user text into the system prompt.

Correct:

```ts
messages: [
  { role: "system", content: SYSTEM_PROMPT },
  { role: "user", content: userMessage }
]
```

Avoid constructing:

```text
SYSTEM PROMPT + user supplied text
```

as one untrusted instruction blob.

---

# 35. AI Output Trust Boundary

The AI may propose:

```text
title
goal
currentState
nextAction
checklist
```

The AI may NOT control:

```text
database IDs
timestamps
foreign keys
API keys
SQL
authorization
database table names
server routes
```

These remain application-controlled.

---

# 36. Database Trust Boundary

Only server code can call:

```text
getObjects
createObject
updateObject
deleteObject
updateObjectStatus
updateChecklistItem
createObjectUpdate
```

Client components must not import database clients or query modules.

---

# 37. Logging

Safe to log:

```text
AI request failed
provider status
validation failure code
database operation failed
```

Avoid logging:

```text
OPENAI_API_KEY
DATABASE_URL
database password
full sensitive conversation payloads by default
hidden reasoning
```

Development logging may include concise diagnostic information.

---

# 38. Phase 3 Suggested File Structure

Example:

```text
app/
  api/
    ai/
      create-object/
        chat/
          route.ts
        finalize/
          route.ts

components/
  ai/
    AICreateDialog.tsx
    AICreateConversation.tsx
    ObjectDraftPreview.tsx

lib/
  ai/
    openai.ts
    prompts.ts
    schemas.ts
    types.ts

  validation/
    object-create.ts

lib/
  db/
    index.ts
    schema.ts
    queries.ts
```

Do not force this exact structure if existing architecture suggests a cleaner equivalent.

---

# 39. Suggested Shared Types

Keep DB types and AI Draft types distinct.

Example:

```ts
type CreateObjectDraft = {
  title: string;
  goal: string;
  currentState: string;
  nextAction: string;
  checklist: DraftChecklistItem[];
};
```

versus persisted:

```ts
type ManagedObject = {
  id: string;
  title: string;
  status: ObjectStatus;
  goal: string;
  currentState: string;
  nextAction: string;
  checklist: ChecklistItem[];
  createdAt: string;
  updatedAt: string;
};
```

Do not pretend a Draft is already a database Object.

---

# 40. Primary Invariants

The implementation must always preserve these invariants.

## Invariant 1

```text
Conversation != database mutation
```

## Invariant 2

```text
One AI Create flow creates exactly one Object
```

## Invariant 3

```text
One Object may contain many Checklist items
```

## Invariant 4

```text
Current State != Next Action
```

## Invariant 5

```text
User confirmation is required before creation
```

## Invariant 6

```text
AI never writes directly to PostgreSQL
```

## Invariant 7

```text
Backend validates all AI/client structured data
```

## Invariant 8

```text
Database creation is transactional
```

---

# 41. Phase 3 Acceptance Tests

## Test 1 — vague request

User:

```text
我想做一张桌子
```

Expected:

```text
AI asks useful clarification
no Object in DB
```

---

## Test 2 — detailed request

User:

```text
我想自己做一张120×60cm松木电脑桌，月底完成。
```

Expected:

```text
AI can quickly propose draft
no Object yet
```

---

## Test 3 — draft visible

Expected draft contains:

```text
Title
Goal
Current State
Next Action
Checklist
```

---

## Test 4 — continue discussing

User changes:

```text
桌腿改成金属的
```

Expected:

```text
draft updated
no DB mutation
```

---

## Test 5 — manual edit

User manually edits Title.

Expected:

```text
final creation uses manually edited Title
```

---

## Test 6 — Create button

Before clicking Create:

```text
0 new objects
```

After clicking and successful server response:

```text
exactly 1 new object
```

---

## Test 7 — transaction

Simulate checklist insertion failure.

Expected:

```text
Object insert rolled back
no partial Object
```

---

## Test 8 — AI failure

Simulate OpenAI failure during conversation.

Expected:

```text
existing conversation/draft remains
no DB changes
user sees recoverable error
```

---

## Test 9 — DB failure

Simulate DB failure during finalization.

Expected:

```text
no success state
draft remains available
transaction rolled back
```

---

## Test 10 — task fragmentation

User:

```text
我要做一张桌子
```

Expected:

```text
one Object
multiple checklist items
```

Not:

```text
multiple Objects
```

---

# 42. Phase 3 Definition of Done

Phase 3 is complete only when:

1. AI Create UI exists.
2. User can have a natural conversation with AI.
3. AI can ask clarification.
4. AI can produce a structured Object draft.
5. Draft displays Title / Goal / Current State / Next Action / Checklist.
6. User can continue discussing instead of creating.
7. User explicitly confirms creation.
8. No DB write happens before confirmation.
9. Backend validates draft.
10. One Object is created transactionally.
11. Checklist items are persisted.
12. `object_updates` receives creation activity.
13. Created Object appears on the board.
14. OpenAI API key remains server-side.
15. Board load/drag/checklist actions make no AI calls.
16. AI failure does not destroy current draft.
17. DB failure does not create partial data.
18. TypeScript passes.
19. ESLint passes.
20. Production build passes.

---

# 43. Explicitly Out of Scope

Do not continue into:

```text
AI Progress Update
Generate Next Action for existing Object
Replan
Activity Log UI
Authentication
multi-user context
agent execution
scheduled AI
AI board prioritization
What should I do now?
```

These belong to later phases.

---

# 44. Final Engineering Principle

The Phase 3 implementation should enforce this boundary:

```text
AI proposes.
User decides.
Backend validates.
Database persists.
```

AI is the reasoning layer.

It is not the authority layer.
