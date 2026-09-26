# FA/8 Cobros normalization and prevention

## Purpose

Legacy cash sales stored some receipt identities as `Cobros FA/8/<number>`.
ARCA later assigned those same numbers to unrelated fiscal invoices. `Cobros`
is not linked to `Ventas` by a foreign key, so both records could coexist.

## Already normalized

| Old receipt key | New receipt key | Applied invoice | Amount |
| --- | --- | --- | ---: |
| FA/8-14447 | FA/8-14414 | FA/8-14414 | 9,000 |
| FA/8-14448 | FA/8-14416 | FA/8-14416 | 27,000 |

## Completed normalization set

Every row below was verified before execution and normalized in one
transaction: one `Cobros` row, one
`CobrosAplicados` row, same customer and delivery point as the target invoice,
and no `Cobros` row already using the target key.

| Old receipt key | New receipt key |
| --- | --- |
| FA/8-14452 | FA/8-14420 |
| FA/8-14457 | FA/8-14429 |
| FA/8-14459 | FA/8-14434 |
| FA/8-14460 | FA/8-14432 |
| FA/8-14461 | FA/8-14433 |
| FA/8-14462 | FA/8-14435 |
| FA/8-14465 | FA/8-14438 |
| FA/8-14466 | FA/8-14439 |
| FA/8-14469 | FA/8-14444 |
| FA/8-14470 | FA/8-14445 |
| FA/8-14472 | FA/8-14447 |
| FA/8-14473 | FA/8-14448 |

The transaction changed only the receipt key in `Cobros` and the matching
receipt-side key in `CobrosAplicados`. It does not change `Ventas`, items,
movements, CAE, dates, amounts, or the applied-invoice side of
`CobrosAplicados`.

Post-transaction verification: 12 `Cobros` rows and 12 matching
`CobrosAplicados` rows were found at their destination keys; no row remained
at an origin key.

## Historical collision repair

The following 17 collisions were individually audited after the preventive
pass. Each has exactly one application to a FA/8 invoice belonging to the
same client and delivery point. Some destination keys are another source key,
so the production transaction first moves all receipt keys to temporary
numbers and then to their final values.

| Old receipt key | New receipt key |
| --- | --- |
| FA/8-14394 | FA/8-14395 |
| FA/8-14395 | FA/8-14397 |
| FA/8-14397 | FA/8-14399 |
| FA/8-14398 | FA/8-14406 |
| FA/8-14400 | FA/8-14402 |
| FA/8-14401 | FA/8-14403 |
| FA/8-14402 | FA/8-14405 |
| FA/8-14403 | FA/8-14404 |
| FA/8-14404 | FA/8-14407 |
| FA/8-14405 | FA/8-14408 |
| FA/8-14406 | FA/8-14411 |
| FA/8-14407 | FA/8-14409 |
| FA/8-14408 | FA/8-14410 |
| FA/8-14409 | FA/8-14412 |
| FA/8-14410 | FA/8-14413 |
| FA/8-14450 | FA/8-14417 |
| FA/8-14451 | FA/8-14418 |

Rollback is the inverse map, applied through a temporary key range in one
transaction. It is only safe while every resulting receipt keeps exactly one
matching application; do not run it after attaching additional payments.

## Intentionally excluded

`FA/8-14022` remains unchanged. Its `Cobro` has 11 applications, so there is
no single invoice identity to assign without a separate business review.

## Rollback

Each mapping is reversible by swapping its old and new receipt numbers in
both tables within one transaction. Before any rollback, require that the
new key still has exactly one matching application and that the old key is
unused. Do not run a bulk rollback if additional payments were later attached.

## Application safeguards

1. Before a new FA/FB point-8 authorization, query ARCA for the next number.
2. Block before the invoice POST if that number already exists as a `Cobros`
   receipt identity.
3. Repeat the `Cobros` collision check in the local fiscal insert.
4. When a pending invoice is renumbered after authorization, migrate the
   associated receipt only if it is a single same-client application to that
   original invoice. Ambiguous or split receipts are intentionally untouched.
