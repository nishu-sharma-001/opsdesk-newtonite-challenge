# OpsDesk — Internal Operations Work Management

A one-day full-stack MVP built against the Newtonite Software Engineering Challenge brief.

## Features
- Work items: Task, Issue, Investigation; status, priority, owner, description.
- Search and server-side status/priority filters.
- Bounded pagination (10 per page in the UI; API caps at 50).
- JWT sign-in with server-enforced roles; viewer is read-only.
- Team-scoped list/detail access and assignee validation.
- Activity history for create and field changes.
- Version-based optimistic concurrency; stale edits return `409 Conflict`.
- Idempotency key support for safe create retries.
- Workflow transition validation.
- Automated API tests for authorization, idempotency, stale versions, and workflow rules.

## Requirements
- Node.js 18 or newer (Node 20 LTS recommended)
- npm

## Run locally
1. Extract the ZIP and open this folder in VS Code.
2. Open a terminal in this folder.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the API and frontend:
   ```bash
   npm run dev
   ```
5. Open the Vite URL shown in the terminal (usually `http://localhost:5173`).

The API runs at `http://localhost:4000`. The SQLite database is created automatically in `server/opsdesk.db` and demo records are seeded on first run.

## Demo accounts
All accounts use password `demo1234`.
- `admin@opsdesk.local` — can create and update work items
- `manager@opsdesk.local` — can create and update work items
- `member@opsdesk.local` — can create and update work items
- `viewer@opsdesk.local` — read-only

## Tests
Stop the dev server if needed, then run:
```bash
npm test
```
The test suite starts an ephemeral HTTP server and exercises core correctness behavior. Tests use the same local SQLite database as the app; test-created records remain in the local database.

## Build frontend
```bash
npm run build
```

## Security note
The fallback JWT secret is for local demo only. Before any deployment, set a long random `JWT_SECRET` environment variable, use HTTPS, add rate limiting and CSRF/security-header hardening as appropriate, and review password/account lifecycle.

## Known limitations
- Demo uses a single seeded team and SQLite; no UI for creating teams or users.
- No password reset, invitation, email verification, or production session management.
- No deployment configuration included.
- Activity feed is capped at the most recent 100 events per item.
- ID cursor is optimized for the current descending-ID list; a production mutable sort should use a compound cursor.
- No async queue is used because the current MVP has no long-running external operation.
- This is a challenge MVP, not a production-ready system for thousands of concurrent users.
