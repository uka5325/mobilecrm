# Feature Structure

Domain-oriented feature boundaries. Feature-owned code lives here; only
cross-cutting infrastructure and shared primitives remain under `lib/`.

## Slices

- `domain/` — pure business rules, types, calculations, and shared client/server contracts (no framework or SDK imports).
- `data/` — API, Firestore, Storage, mapping, and cache access. Client SDK (`data/client`) and Admin SDK (`data/server`) code are kept in separate subfolders and must not import across that boundary.
- `ui/` — view/layout helpers specific to a feature (schedule layout, timeline formatting, etc.).
- `validators/` — input and payload validation.
- `jobs/` — resumable jobs, retries, leases, and cron workers.
- `tests/` — feature-focused tests. Broad suites currently stay in the root `tests/` directory.

Empty slices are tracked with `.gitkeep`. Prefer specific module paths over
barrel `index.ts` re-exports.

## What stays in `lib/`

Cross-cutting infrastructure and primitives shared by multiple features, e.g.
`firebase`, `firebaseAdmin`, `apiAuth`, `auth`, `adminUtils`, `dateUtils`,
`stringUtils`, `clientCache`, `csv`, `logs`, and the shared write-time
primitives `reservationLocks`, `patientIdentity`, `searchTokens`. Moving these
into a single feature would create feature-to-feature coupling, so they remain
neutral in `lib/`.

## Features

- `reservations/`: reservation domain/contracts, client + server data access, schedule/timeline ui, and jobs.
- `patients/`: patient domain, data access, client summary cache, and mutation/reconciliation jobs.
- `photos/`: medical photo domain, Storage/metadata access, and cleanup jobs.
- `invoices/`: invoice domain, client reads, and server (Admin SDK) writes.
- `settlements/`: settlement client reads and server writes (shared `settlementMath` stays in lib).
- `settings/`: settings client data access and helpers.
- `dashboard/`: KPI domain calculations and data access.
