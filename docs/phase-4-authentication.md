# Private Manager — Phase 4 Authentication Engineering Interface Specification

## 1. Scope

Phase 4 implements only:

> Single-user authentication for Private Manager.

The purpose is to protect the application before it is exposed through a public domain.

Private Manager is currently a personal, single-user application.

Do NOT introduce a general multi-user account system.

---

# 2. Core Goal

The final access flow should be:

```text
Internet
↓
HTTPS
↓
Authentication
↓
Private Manager
↓
PostgreSQL / OpenAI
```

Unauthenticated users must not be able to access:

* the main board
* Object data
* checklist operations
* AI Create
* AI APIs
* database-backed Server Actions

---

# 3. MVP Authentication Model

Use a single administrator/user account.

Phase 4 should support:

* login
* logout
* authenticated session
* protected application pages
* protected AI API routes
* protected mutation actions
* secure password verification
* secure cookies

Do NOT implement:

* registration
* signup
* multiple users
* invitations
* roles
* permissions
* teams
* organizations
* OAuth
* Google login
* GitHub login
* password reset
* email verification
* social login
* account settings
* profile management

---

# 4. Architecture Philosophy

Keep authentication simple.

Preferred model:

```text
Single configured user
+
password hash
+
server-side session
+
HttpOnly cookie
```

Avoid introducing a large authentication framework unless it clearly reduces complexity.

For this single-user MVP, a custom minimal authentication layer is acceptable.

---

# 5. Credentials Source

Do not store a plaintext password in source code.

Recommended environment configuration:

```env
AUTH_USERNAME=
AUTH_PASSWORD_HASH=
AUTH_SECRET=
```

Optional:

```env
AUTH_SESSION_DAYS=30
```

The repository must only contain placeholders:

```env
AUTH_USERNAME=
AUTH_PASSWORD_HASH=
AUTH_SECRET=
```

Never commit a real username, password hash, password, or secret.

---

# 6. Password Storage

The application must never store or compare plaintext passwords.

Use a strong password hashing algorithm.

Recommended:

```text
Argon2id
```

or a well-supported bcrypt implementation if platform compatibility makes Argon2 unnecessarily difficult.

Preferred hierarchy:

```text
Argon2id
↓
bcrypt
```

Do not implement password hashing manually.

Do not use:

```text
MD5
SHA1
SHA256(password)
plain text
Base64
```

as password storage.

---

# 7. Password Hash Generation

Provide a development/helper command to generate a password hash.

Example:

```bash
npm run auth:hash-password
```

Conceptually:

```text
enter password
↓
generate secure hash
↓
print hash
```

The script must not save the plaintext password.

If interactive password input adds unnecessary complexity, a documented one-off script is acceptable.

Do not log the plaintext password.

---

# 8. Username

For MVP, support one configured username.

Example:

```env
AUTH_USERNAME=mario
```

Email-specific behavior is unnecessary unless the user explicitly wants email login.

Treat the username as a login identifier only.

---

# 9. Login Page

Recommended route:

```text
/login
```

The page should include:

```text
Private Manager

Username
Password

[ Log in ]
```

Keep UI consistent with the existing application.

Do not add registration links.

Do not add:

```text
Forgot password?
Create account
Continue with Google
```

---

# 10. Login Request

Recommended route:

```text
POST /api/auth/login
```

or equivalent Server Action.

Request shape:

```ts
type LoginRequest = {
  username: string;
  password: string;
};
```

Validate runtime input.

Suggested limits:

```text
username <= 200 chars
password <= reasonable maximum, e.g. 500 chars
```

Reject empty input.

---

# 11. Login Verification

Server flow:

```text
receive username/password
↓
validate input
↓
compare username against AUTH_USERNAME
↓
verify password against AUTH_PASSWORD_HASH
↓
create authenticated session
↓
set secure session cookie
↓
return success
```

Do not reveal whether:

```text
username exists
password is wrong
```

Use a generic failure:

```text
Invalid username or password.
```

---

# 12. Timing / Credential Enumeration

Avoid clearly different login responses for:

```text
wrong username
wrong password
```

Do not return:

```text
User not found
Incorrect password
```

Use one generic authentication error.

A sophisticated anti-enumeration system is not required for MVP, but avoid obvious information leaks.

---

# 13. Session Model

Preferred:

```text
signed/encrypted session token
stored in HttpOnly cookie
```

For a single-user application, a database-backed session table is not required unless implementation strongly benefits from one.

Do not add a users table purely for Phase 4 unless necessary.

Do not add:

```text
users
roles
permissions
organizations
```

just to support one account.

---

# 14. Session Contents

Keep session payload minimal.

Conceptually:

```ts
type SessionPayload = {
  authenticated: true;
  username: string;
  issuedAt: number;
  expiresAt: number;
};
```

Do not put:

* password hash
* plaintext password
* API keys
* database credentials
* OpenAI credentials

inside the cookie.

---

# 15. Session Signing

Use:

```env
AUTH_SECRET=
```

to cryptographically protect session integrity.

`AUTH_SECRET` must be:

* long
* random
* server-side only

Never expose through:

```env
NEXT_PUBLIC_AUTH_SECRET
```

---

# 16. Session Expiration

Recommended MVP default:

```text
30 days
```

because this is a personal application.

Allow configuration if simple:

```env
AUTH_SESSION_DAYS=30
```

Expired sessions must be treated as unauthenticated.

---

# 17. Cookie Requirements

Session cookie should use:

```text
HttpOnly = true
SameSite = Lax
Path = /
```

In production over HTTPS:

```text
Secure = true
```

Development on localhost must still work without HTTPS.

Cookie name example:

```text
private_manager_session
```

Do not store authentication tokens in:

```text
localStorage
sessionStorage
normal JavaScript-readable cookies
```

---

# 18. Secure Flag

Recommended behavior:

```ts
secure: process.env.NODE_ENV === "production"
```

Production deployment must be HTTPS.

Do not disable Secure cookies in production to work around proxy configuration.

Configure reverse proxy correctly instead.

---

# 19. Authentication Helper

Create a small server-only authentication module.

Example:

```text
lib/auth/
  config.ts
  password.ts
  session.ts
  require-auth.ts
```

Exact structure may vary.

Provide functions conceptually similar to:

```ts
verifyCredentials(username, password)
createSession(...)
getSession(...)
requireAuth(...)
destroySession(...)
```

Keep them server-only.

---

# 20. `requireAuth`

Centralize authorization checks.

Conceptually:

```ts
async function requireAuth() {
  const session = await getSession();

  if (!session) {
    throw new UnauthorizedError();
  }

  return session;
}
```

Do not duplicate cookie parsing and verification throughout the application.

---

# 21. Page Protection

Main Private Manager UI must require authentication.

Unauthenticated request to:

```text
/
```

should redirect to:

```text
/login
```

Authenticated request to:

```text
/login
```

should preferably redirect to:

```text
/
```

---

# 22. Middleware vs Server Checks

Middleware may be used for fast route-level redirect behavior.

However:

> Middleware alone is NOT sufficient authorization.

Sensitive server operations must still independently verify authentication.

Correct:

```text
Middleware
+
server-side requireAuth()
```

Incorrect:

```text
Middleware only
```

Never assume that because the UI page was protected, API routes and Server Actions are automatically secure.

---

# 23. Protected API Routes

At minimum protect:

```text
/api/ai/create-object/chat
/api/ai/create-object/finalize
```

Before any OpenAI or database work:

```text
requireAuth()
```

Unauthenticated:

```text
401 Unauthorized
```

No OpenAI call.

No DB mutation.

---

# 24. Server Actions Protection

Phase 2 Server Actions must also require authentication.

Examples:

```text
moveObjectToStatus
setChecklistItemCompleted
```

and any future:

```text
createObject
updateObject
deleteObject
```

Do not trust the browser merely because only authenticated pages render those buttons.

Every mutation boundary must independently enforce auth.

---

# 25. Database Query Protection

Do not put `requireAuth()` inside every low-level DB helper unless the architecture strongly requires it.

Preferred separation:

```text
Route / Server Action
↓
requireAuth()
↓
DB query function
```

This keeps DB functions reusable and authentication explicit at trust boundaries.

---

# 26. Board Data Protection

The main board server page must authenticate before reading Objects.

Conceptually:

```text
page.tsx
↓
requireAuth()
↓
getObjects()
```

Unauthenticated users must not trigger a DB read of private board content.

---

# 27. Login API Error Format

Recommended:

```ts
type LoginResponse =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: {
        code: "INVALID_CREDENTIALS" | "INVALID_REQUEST" | "AUTH_CONFIG_ERROR";
        message: string;
      };
    };
```

Do not expose internal details.

---

# 28. Authentication Configuration Errors

If required environment values are missing:

```text
AUTH_USERNAME
AUTH_PASSWORD_HASH
AUTH_SECRET
```

authentication should fail safely.

Do not silently allow access.

Recommended behavior:

```text
500 AUTH_CONFIG_ERROR
```

and server-side concise logging.

Never log the full secret/hash.

---

# 29. Logout

Recommended route:

```text
POST /api/auth/logout
```

or Server Action.

Logout must:

```text
invalidate/delete session cookie
↓
redirect user to /login
```

It does not need to modify PostgreSQL.

---

# 30. Logout UX

Add a simple Logout control to the authenticated application.

Example:

```text
Private Manager                         Logout
```

Keep it unobtrusive.

Do not build a user profile dropdown unless needed.

---

# 31. CSRF

Using:

```text
SameSite=Lax
HttpOnly
server-side auth checks
```

provides a reasonable baseline for this MVP.

For authentication-changing endpoints and sensitive writes, prefer:

* POST for mutations
* same-origin requests
* no state-changing GET endpoints

Do not create:

```text
GET /logout
GET /delete-object
```

that mutate state.

A full standalone CSRF framework is not required unless architecture requires it.

---

# 32. Brute-force Protection

Because the application will eventually be public, basic login rate limiting is desirable.

However, do not over-engineer it during Phase 4 if it requires Redis or new infrastructure.

Minimum acceptable MVP:

```text
generic login error
secure password hash
strong password
HTTPS
```

Optional simple in-process throttling may be added, but remember it is not reliable across multiple instances/restarts.

A proper persistent/rate-limit service can be added later if necessary.

---

# 33. Authentication and OpenAI

Unauthenticated users must never be able to consume the user's OpenAI quota.

Flow must be:

```text
request
↓
requireAuth()
↓
OpenAI call
```

Never:

```text
OpenAI call
↓
check auth
```

---

# 34. Authentication and PostgreSQL

Unauthenticated users must never be able to:

```text
read Objects
create Objects
change status
check checklist items
delete Objects
```

through API routes or Server Actions.

---

# 35. No Client Secrets

Client-side code may know:

```text
authenticated / unauthenticated state
username if desired
```

Client-side code must NOT receive:

```text
AUTH_PASSWORD_HASH
AUTH_SECRET
DATABASE_URL
OPENAI_API_KEY
```

---

# 36. Environment File

Update `.env.example`:

```env
DATABASE_URL=

OPENAI_API_KEY=
OPENAI_MODEL=

AUTH_USERNAME=
AUTH_PASSWORD_HASH=
AUTH_SECRET=
AUTH_SESSION_DAYS=30
```

Real `.env` remains ignored by Git.

---

# 37. Generating `AUTH_SECRET`

Document a simple secure method.

Example with Node:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

This creates a 256-bit random value.

Do not ship a default production secret.

---

# 38. Password Hash Helper

Recommended script:

```text
scripts/hash-password.ts
```

Possible npm script:

```json
"auth:hash-password": "tsx scripts/hash-password.ts"
```

The script can:

```text
ask for password
↓
hash
↓
print AUTH_PASSWORD_HASH value
```

If secure hidden terminal input is inconvenient, clearly document any limitation.

Do not commit the generated hash into source files.

---

# 39. Authentication UI State

Login page should handle:

```text
idle
submitting
invalid credentials
server/config error
```

Disable the login button while submitting.

Do not clear the username unnecessarily on a failed login.

Password may be cleared on failure.

---

# 40. Redirect Handling

After successful login:

```text
/login
↓
/
```

Optional future enhancement:

```text
/login?next=/...
```

Not required for Phase 4.

Keep MVP simple.

---

# 41. Session Validation

Every session read must verify:

```text
signature
expiration
expected payload shape
```

Do not decode a session cookie and trust it without verification.

Invalid cookie:

```text
treat as unauthenticated
```

Do not crash.

---

# 42. Session Renewal

Sliding expiration is optional.

For MVP, fixed expiry is sufficient.

Do not add session-refresh complexity unless it is trivial.

---

# 43. Activity Log

Authentication events do not need to be written into `object_updates`.

That table is Object-specific.

Do not misuse it for:

```text
login
logout
failed login
```

No authentication audit table is required for MVP.

---

# 44. Database Schema

Phase 4 should preferably require:

```text
zero new PostgreSQL tables
```

because credentials and sessions can be handled without DB state for this single-user setup.

Do not add a `users` table merely because conventional apps have one.

---

# 45. Recommended File Structure

Example:

```text
app/
  login/
    page.tsx

  api/
    auth/
      login/
        route.ts
      logout/
        route.ts

lib/
  auth/
    config.ts
    password.ts
    session.ts
    require-auth.ts

components/
  auth/
    LoginForm.tsx
    LogoutButton.tsx

scripts/
  hash-password.ts
```

Existing protected routes/actions remain in place.

Exact structure may differ if cleaner.

---

# 46. Build Requirements

As with earlier phases:

```text
npm run build
```

must NOT require:

* reachable PostgreSQL
* live OpenAI
* successful login
* production domain

Build may read environment presence only if it does not make external calls.

Prefer runtime validation of auth configuration.

---

# 47. Development Without Full Auth Config

If auth environment values are absent during static build:

```text
build should still pass
```

At runtime, authentication should fail safely and clearly.

This preserves current development workflow.

---

# 48. HTTPS Deployment Requirement

Before exposing the application publicly:

```text
HTTPS is mandatory
```

Reverse proxy should terminate TLS.

Production flow:

```text
Domain
↓
HTTPS reverse proxy
↓
Private Manager
```

Do not expose the Next.js development server directly to the public internet.

---

# 49. Reverse Proxy Awareness

Authentication must work behind the future NAS reverse proxy.

Do not hardcode:

```text
localhost
specific IP address
development port
```

into cookie/auth logic.

Use normal same-origin cookies.

---

# 50. Security Headers

Phase 4 may add basic security headers if simple.

Useful examples:

```text
X-Content-Type-Options: nosniff
Referrer-Policy
frame restrictions
```

But do not turn Phase 4 into a large security-header project.

Authentication protection is the priority.

---

# 51. Runtime Authentication Tests

## Test 1 — unauthenticated board

Request:

```text
/
```

Expected:

```text
redirect /login
```

No private board shown.

---

## Test 2 — bad login

Input:

```text
wrong username/password
```

Expected:

```text
Invalid username or password.
```

No session cookie.

---

## Test 3 — valid login

Expected:

```text
session cookie created
redirect /
board visible
```

---

## Test 4 — refresh

After login:

```text
refresh /
```

Expected:

```text
still authenticated
```

---

## Test 5 — logout

Expected:

```text
cookie removed
redirect /login
```

Refresh `/`:

```text
redirect /login
```

---

## Test 6 — protected AI route

Without session:

```text
POST /api/ai/create-object/chat
```

Expected:

```text
401
```

and:

```text
0 OpenAI calls
```

---

## Test 7 — protected finalize

Without session:

```text
POST /api/ai/create-object/finalize
```

Expected:

```text
401
0 database mutations
```

---

## Test 8 — protected status mutation

Without session, attempt Object drag/status action.

Expected:

```text
rejected
no DB mutation
```

---

## Test 9 — protected checklist mutation

Without session:

```text
rejected
no DB mutation
```

---

## Test 10 — tampered session

Modify session cookie manually.

Expected:

```text
treated as unauthenticated
```

No server crash.

---

## Test 11 — expired session

Expected:

```text
redirect/login or 401
```

depending on boundary.

---

## Test 12 — missing auth configuration

Remove `AUTH_SECRET` or hash.

Expected:

```text
safe authentication failure
clear server diagnostic
no bypass
```

---

# 52. Static Validation

Run:

```bash
npx tsc --noEmit
npm run lint
npm run build
```

All must pass.

---

# 53. Phase 4 Definition of Done

Phase 4 is complete only when:

1. `/login` exists.
2. Valid configured user can log in.
3. Invalid credentials cannot log in.
4. Password is verified using a secure password hash.
5. Session uses an HttpOnly cookie.
6. Session is cryptographically protected.
7. Session expires.
8. `/` is protected.
9. Authenticated user can access board.
10. Unauthenticated user is redirected to login.
11. AI chat route requires auth.
12. AI finalize route requires auth.
13. Server Actions require auth.
14. Board data reads require auth.
15. Logout works.
16. Tampered/expired cookies are rejected.
17. Secrets remain server-side.
18. No registration exists.
19. No multi-user system exists.
20. No new user/role DB schema is introduced unless absolutely necessary.
21. Build does not require external services.
22. TypeScript passes.
23. ESLint passes.
24. Production build passes.

---

# 54. Explicitly Out of Scope

Do not implement:

```text
registration
password reset
email verification
OAuth
Google login
GitHub login
multi-user
teams
roles
permissions
admin panel
account management
authentication audit dashboard
2FA
passkeys
magic links
SSO
```

These are not needed for the current Private Manager MVP.

---

# 55. Engineering Principle

The authentication layer should be:

```text
small
predictable
server-controlled
secure enough for public personal deployment
```

Do not build a SaaS identity platform for a single-user personal application.

The rule is:

```text
No authenticated session
↓
No private data
No DB mutations
No OpenAI usage
```
