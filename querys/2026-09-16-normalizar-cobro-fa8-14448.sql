/*
  Production correction performed on 2026-09-16.

  Why: Cobros FA/8-14447 and FA/8-14448 from 2026-08-31 were later reused
  by ARCA for unrelated Ventas. Each historical cobro is normalized to its
  sole applied invoice.

  Forward change:
    Cobros FA/8-14447 -> FA/8-14414
    CobrosAplicados receipt key FA/8-14447 -> FA/8-14414
    Cobros FA/8-14448 -> FA/8-14416
    CobrosAplicados receipt key FA/8-14448 -> FA/8-14416

  Rollback (only if explicitly required): replace 14416 with 14448 in both
  receipt-key updates below, preserving the same precondition checks.
*/

-- This file documents the exact production transaction; do not rerun blindly.
