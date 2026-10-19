# Engineering Decisions — OpsDesk

## 1. SQLite over a separately operated database
**Choice:** SQLite with WAL mode and indexes.  
**Why:** This challenge is a time-boxed, local-first demonstration; SQLite keeps setup reproducible and avoids requiring a database service.  
**Trade-off:** A single SQLite file is not the intended final database for a large distributed deployment. For production, use PostgreSQL with connection pooling and managed backups.

## 2. Server-enforced roles and team scoping
**Choice:** The API checks role permissions on every mutation and scopes list/detail queries to the authenticated user's team. The frontend only hides editing controls as a usability feature.  
**Why:** UI-only restrictions are not security.  
**Trade-off:** The demo seeds one team; multi-team administration and team-management screens are outside this one-day implementation.

## 3. Optimistic concurrency with a version column
**Choice:** Every work item has an integer `version`. A mutation must include the version the client read; SQL updates use `WHERE id = ? AND version = ?` and increment the version atomically. A stale request returns HTTP 409.  
**Why:** This prevents a late update from silently overwriting a more recent change.  
**Trade-off:** The client must refresh and retry after a conflict; automatic field-level merge is not implemented.

## 4. Idempotency keys for create retries
**Choice:** `POST /api/items` accepts an `Idempotency-Key`, scoped to the authenticated user. Repeated requests with the same key return the stored response instead of inserting another row.  
**Why:** Retries after a timeout should not create duplicate work items.  
**Trade-off:** The demonstration keeps keys indefinitely. A production service should expire old keys and apply storage limits.

## 5. Transactional activity history
**Choice:** Item updates and their activity events are written inside one SQLite transaction.  
**Why:** The history should not claim an update happened if the update itself failed.  
**Trade-off:** Events are stored in the same database instead of a dedicated event stream. This is simpler and reliable for the challenge, but not an event-sourcing architecture.

## 6. Cursor pagination and bounded result size
**Choice:** The API caps each page at 50 rows and returns a cursor; it never returns the whole work-item table in one response. Search and filters are server-side.  
**Why:** This limits response size as data grows.  
**Trade-off:** This demo uses an ID cursor and ID-descending ordering. A production feed sorted by mutable timestamps should use a stable compound cursor such as `(updated_at, id)`.

## 7. No background queue in the MVP
**Choice:** The current workflow is synchronous; no queue is added just to demonstrate infrastructure.  
**Why:** There is no essential long-running task in this brief MVP, and an unused queue adds failure modes.  
**Trade-off:** If future work includes notifications, bulk imports, or external integrations, add a durable queue with retry limits, idempotent consumers, and a dead-letter path.
