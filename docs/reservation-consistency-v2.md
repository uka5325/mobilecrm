# Reservation consistency v2

This document records the invariants enforced by the reservation consistency refactor.

## Mutation invariants

- Missing reservation documents return `404 RESERVATION_NOT_FOUND` for delete and surgery-toggle commands.
- Reservation creation always stores one non-empty canonical `patientId` on both the patient and reservation documents.
- Conflicting patient IDs are rejected with `PATIENT_ID_MISMATCH`.
- Server-generated patient IDs retain a stable legacy duplicate identity so concurrent identical creates contend on the same reservation lock.
- Reservation locks are calculated only after canonical patient resolution.

## Client consistency

Successful reservation mutations invalidate the patient summary, full-history, and amount-row caches through one shared helper. Deposit and surgery-cost edits therefore use the same refreshed source in reservation and patient-management views.

## Summary maintenance

Normal create, update, and delete operations update reservation summaries incrementally from before/after deltas. A full reservation scan remains available for bootstrap, backfill, and dirty-summary reconciliation. When a patient is already capped, the displayed count stays at the cap until reconciliation determines the exact count.

## API contract

Reservation actions and payloads are declared in `lib/reservationApiContracts.ts`. Removed legacy actions (`read_one` and `read_by_date`) are rejected as `UNKNOWN_ACTION`.

## Verification

The branch is expected to pass lint, TypeScript, unit tests, application build, Firestore rules tests, Storage rules tests, and API emulator tests before review.
