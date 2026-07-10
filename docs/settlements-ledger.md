
# Settlement ledger

## Source of truth

`settlements` is the source of truth for actual money received and refunded. Reservation fields such as `depositAmount` and `surgeryCost` are legacy quoted/entered values and are no longer edited by the schedule or patient-management UI.

Each settlement record is connected to one reservation and stores an actual payment or refund, its category, date, method, and audit metadata. Records are accumulated rather than overwritten. Incorrect records are voided instead of hard-deleted.

## Invoice synchronization

For every active invoice linked to the affected reservation, regardless of `draft`, `confirmed`, or `void` status:

- `totalAmount` is the net actual amount (`payments - refunds`).
- payment-method totals are rebuilt from the ledger.
- `commissionBase` is rebuilt using the existing VAT policy.
- `commissionAmount` is recalculated from the stored commission rate.
- the invoice status remains unchanged.
- confirmed invoices set `updatedAfterConfirmation=true` and every sync increments `invoiceRevision`.

## Patient summary

The patient document stores exact list-view summary values:

- `settlementCount`
- `totalSettlementPaid`
- `totalSettlementRefunded`
- `netSettlementAmount`
- `lastSettlementAt`

The customer-management page reads these fields for its settlement badge and opens the ledger only on demand.

## Legacy reservation amounts

Legacy reservation amount fields are not automatically migrated because a quoted or entered surgery cost is not proof of actual payment. The settlement UI warns when legacy values exist without ledger entries. Actual historical payments must be reviewed and entered explicitly before any migration is approved.
