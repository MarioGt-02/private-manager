# Private Manager

A personal object-based Kanban application.

> **Manage things, not tasks.** One Object = one complete thing, outcome, or goal.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS
- dnd-kit
- PostgreSQL + Drizzle ORM

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env`, configure authentication as described below, and fill in `DATABASE_URL`:

   ```bash
   cp .env.example .env
   ```

   Example:

   ```env
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/private_manager
   ```

   To use the AI Create Object feature, also set `OPENAI_API_KEY` (server-side only):

   ```env
   OPENAI_API_KEY=sk-...
   ```

   Configure the OpenAI-compatible endpoint and Responses API options as needed:

   ```env
   OPENAI_BASE_URL=https://api.openai.com/v1
   OPENAI_MODEL=gpt-5.4-mini
   OPENAI_REASONING_EFFORT=high
   OPENAI_STORE=false
   ```

   `OPENAI_BASE_URL` is optional and supports compatible providers. AI requests
   use `client.responses.create()`; `OPENAI_STORE=false` disables response
   storage.

3. Start a local PostgreSQL instance (for example with Docker):

   ```bash
   docker run --name private-manager-db \
     -e POSTGRES_PASSWORD=postgres \
     -e POSTGRES_DB=private_manager \
     -p 5432:5432 \
     -d postgres:16
   ```

4. Generate, apply migrations, and seed development data:

   ```bash
   npm run db:generate   # generate SQL migrations from the Drizzle schema
   npm run db:migrate    # apply migrations to the database
   npm run db:seed       # insert realistic example Objects (wipes existing rows)
   ```

5. Run the app:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Database

The schema lives in `lib/db/schema.ts`. There are three tables:

- `objects` — one complete thing (status, goal, current_state, next_action)
- `checklist_items` — the internal execution sequence of an Object
- `object_updates` — append-only activity history (future Activity Log / AI history)

Status is stored as a PostgreSQL enum: `idea`, `ready`, `doing`, `waiting`, `done`.

Migrations are generated with `drizzle-kit` and stored in `drizzle/`.

## Current status

Implemented:

- Read-only per-Object Activity Log (latest 30, refresh after successful saves)

- Kanban board with five fixed columns (Idea, Ready, Doing, Waiting, Done)
- Object cards showing title, Current State, Next Action, and checklist progress
- Object drawer with Goal, Current State, Next Action, Checklist, and AI placeholders
- Manual checklist check/uncheck (persisted)
- Drag and drop between columns (status persisted)
- PostgreSQL persistence via Drizzle ORM
- Migration and seed workflow
- AI Create Object (conversational, with explicit user confirmation)
- Single-user login/logout with protected board, AI routes, and Server Actions

Not yet implemented (later phases):

- AI Progress Update ("Tell AI What Happened")
- AI Generate Next Action for existing Objects
- AI Replan


## Authentication setup (Phase 4)

Set `AUTH_USERNAME` to your single login identifier (case-sensitive, 1–200
characters). Generate a strong password hash locally:

```bash
npm run auth:hash-password
```

The interactive terminal prompts twice with input hidden. It prints a bcrypt
hash with cost 12 and never saves or prints the plaintext password. Do not pass
passwords as command-line arguments. Passwords must contain 1–72 UTF-8 bytes;
longer passwords are rejected rather than truncated (non-ASCII characters can
use multiple bytes). The helper requires an interactive terminal.

Paste the result into `AUTH_PASSWORD_HASH`. In Next.js `.env` files, escape
**each dollar sign** as `\$`, even inside quotes, because Next.js expands `$`
references. For example, the prefix `$2b$12$` becomes `\$2b\$12\$`.
When setting an environment variable directly through a container UI, use the
original hash without these Next.js environment-file escapes. Supported bcrypt
hashes use `$2a$` or `$2b$` and cost 12, matching the fixed dummy hash's work
factor so an unknown username does not take a cheaper hashing path.

Generate `AUTH_SECRET` using:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use the complete output. This generates 32 random bytes (256 bits of entropy),
encoded as 64 hexadecimal characters. The runtime requires at least 32 UTF-8
bytes but cannot measure entropy; use this random generator rather than a
phrase or repeated characters. No default secret is provided.

`AUTH_SESSION_DAYS` defaults to 30 when absent and accepts integers from 1–365.
Missing credentials, malformed hashes, short secrets, or invalid lifetime
configuration fail closed. Login returns a safe `AUTH_CONFIG_ERROR`; protected
pages redirect to login and protected APIs return 401. All auth environment
variables are server-only; never use a `NEXT_PUBLIC_` prefix or commit credentials.

The `/login` form sends a same-origin POST to `/api/auth/login`. Wrong usernames
perform one comparison against a fixed cost-12 dummy bcrypt hash; wrong usernames
and passwords return the same public error. No rate-limit service is included.

Sessions are **signed, not encrypted**, HS256 JWTs verified by `jose`. The payload
contains only `authenticated`, `username`, `iat`, and `exp`; it contains no private
Object data, password hash, or secret. The `private_manager_session` cookie is
HttpOnly, SameSite=Lax, Path=/, host-only, and expires with the fixed JWT lifetime.
There is no sliding refresh and no browser storage token.

In production the cookie is always Secure: access must use HTTPS. Local
`npm run dev` supports HTTP localhost. A future HTTPS reverse proxy must preserve
the public `Host` header; no production hostname is hardcoded. Authentication
POSTs reject explicitly cross-origin requests. Next.js Server Action origin
protection stays enabled. This phase does not configure or deploy a proxy.

The board authenticates before reading data. Both AI Create routes and both
manual mutation Server Actions independently require a valid session. Low-level
DB helpers remain reusable by server code and scripts. No middleware, auth
database tables, or authentication events in `object_updates` are added.

Logout POSTs to `/api/auth/logout`, expires the cookie, and redirects to `/login`.
This clears the current browser's session; a copied token remains valid until
expiration. Rotate `AUTH_SECRET` and restart the app to invalidate all outstanding
tokens, including when changing credentials. Logout works even with invalid
cookies or missing auth configuration.

## Authentication validation

```bash
npm run test:auth
npx tsc --noEmit
npm run lint
npm run build
npm run test:auth:smoke
```

Auth tests generate temporary credentials and mock cookies, navigation, DB, and
OpenAI boundaries. They cover credentials, dummy-hash comparison, session
integrity/expiry, login/logout, and zero DB/OpenAI calls for unauthenticated
requests. These tests do not replace live PostgreSQL/OpenAI integration testing.
The smoke command starts and stops local production servers with temporary auth
credentials, verifies actual HTTP responses/cookies, and also checks missing
configuration. It requires the preceding build. It sends cookies explicitly over
local HTTP to test the server; production browser use still requires HTTPS.

Builds require no auth configuration, PostgreSQL, OpenAI key, or production
domain. Auth configuration is validated only on requests; DB and OpenAI clients
remain lazy and pages that inspect sessions are dynamic. You can test login and
logout without a database; an authenticated board then shows the existing DB
unavailable message.

## Phase 8 — Activity Log

The Object Drawer lazily loads the selected Object's latest 30 persisted events,
newest first. Each entry shows a browser-local timestamp, a readable event label,
and the original stored content. Unknown event types use the label `Activity`.
Loading, empty, and retry states affect only this section.

`GET /api/objects/[objectId]/activity` authenticates before validating the ID and
reading history. The query filters by Object, sorts and limits in PostgreSQL,
and returns only display fields. Responses are not cached. Opening Activity
performs no database mutations and no OpenAI requests.

Successful status, field, checklist, Progress Apply and Replan Apply mutations
refresh the selected Object's activity. Failed or optimistic writes never invent
history rows. No schema migration is required; the existing Object ID index is
retained.

Run all tests with `npm run test:auth`. The optional read-only database acceptance
can be run in PowerShell with the existing local database configuration:

```powershell
$env:RUN_ACTIVITY_DB_READ = "1"
npx vitest run tests/activity-db.integration.test.ts
Remove-Item Env:RUN_ACTIVITY_DB_READ
```

This optional check reads up to two existing Objects and compares displayed
history with persisted rows; it does not create or edit any data.