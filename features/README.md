# Feature Structure Skeleton

This directory prepares domain-oriented feature boundaries without moving or changing existing production code.

## Rules

- Existing code under `app/`, `components/`, `hooks/`, and `lib/` remains unchanged in this step.
- No import paths, runtime behavior, Firebase queries, API routes, or tests are changed.
- Empty directories are tracked with `.gitkeep`.
- Files will be migrated incrementally in later steps.
- `domain/` is reserved for pure business rules, types, and calculations.
- `data/` is reserved for API, Firestore, Storage, mapping, and cache access. Client SDK and Admin SDK code must remain clearly separated when implementations are added.
- `validators/` is reserved for reservation input and payload validation.
- `jobs/` is reserved for resumable jobs, retries, leases, and cron workers.
- `tests/` is reserved for feature-focused tests; existing tests stay in the root `tests/` directory until a later migration.

## Features

- `reservations/`: reservation domain, data access, validation, and tests
- `patients/`: patient domain, data access, mutation/reconciliation jobs, and tests
- `photos/`: medical photo domain, Storage/metadata access, cleanup jobs, and tests
- `dashboard/`: KPI domain calculations, data access, and tests
- `settlements/`: settlement domain calculations, data access, and tests
