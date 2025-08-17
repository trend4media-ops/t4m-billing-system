# Roadmap / To‑Do – SUPER SMART TikTok LIVE Agency Tool

This is a living checklist of upcoming features and refinements.

## Billing & Commission Engine
- [ ] Downline calculator parity check: ensure rates from `systemConfig.downlineRates` are used end‑to‑end (A/B/C) with audit logs.
- [ ] Diamond bonus eligibility snapshot at month close; auto‑award job with retry and idempotency.
- [ ] Graduation bonus: implement first‑milestone per creator detection with historical check and tests.
- [ ] Commission preview UI: per‑manager delta drill‑down; CSV export of deltas.
- [ ] Config diff viewer between versions; changelog with actor and timestamp.

## Payouts
- [ ] Pro‑forma invoice generator (client) to help managers download a PDF template before upload.
- [ ] Bank details vaulting: store IBAN/BIC per manager and suggest in form with masked preview.
- [ ] Admin bulk status updates with filters and optional CSV export for accounting.
- [ ] Webhook emitter for accounting systems when status changes to PAID.

## Incentives
- [ ] Rule management: enable deactivate/activate; effectiveFrom validator with overlapping rule checks.
- [ ] More rule types: tiered NET growth thresholds, team‑based boosts, streak rewards.
- [ ] Preview grouping by rule with totals; one‑click revert (undo) for last apply batch.

## Genealogy
- [ ] Visual tree editor with drag‑and‑drop and validation before commit.
- [ ] Historical assignments view per creator/manager for auditability.

## Frontend UX
- [ ] Admin search across managers, creators, payouts, messages in a unified bar.
- [ ] Localized help popovers for complex fields (commission overrides, incentives).
- [ ] Loading states audit; skeletons for heavy tables.

## Observability & Ops
- [ ] Admin dashboard cards for: pending payouts, FX cache status, config lock status per month.
- [ ] Alerting on FX fetch failures and commission apply errors.
- [ ] E2E tests for Settings, Incentives, Payout flows.

## Docs
- [ ] Deep dive: CommissionConfig lifecycle and safety rails.
- [ ] Guide: Monthly close checklist for admins.
- [ ] FAQ: FX rates, EUR vs USD handling, and rounding rules. 