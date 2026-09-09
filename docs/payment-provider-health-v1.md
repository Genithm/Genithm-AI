# Payment Provider Health V1

## Purpose

The provider health control plane detects and repairs stale provider state without weakening webhook verification or deleting failed-event history.

Admin page: `/dashboard/admin/billing/payments/health`

## Signals

For each configured Stripe, PayPal or Wise environment, Genithm reports:
- connection verification state and last verification time,
- unresolved failed signed webhook events,
- stale provider subscription state,
- organization subscription/plan drift,
- stale Wise transfer state,
- latest reconciliation outcome.

The initial stale threshold is 24 hours for connection verification and authoritative sync freshness.

## Reconciliation

`Verify & reconcile` requires Platform Admin + AAL2/MFA. It verifies provider credentials first, creates an auditable reconciliation run, and then re-reads locally known external IDs from the provider.

V1 coverage:
- Stripe: mapped customer subscriptions.
- PayPal: mapped subscriptions.
- Wise: recorded transfer IDs.

A target failure makes the run `partial` or `failed`; the provider connection is marked degraded when the overall reconciliation cannot complete.

## Failed webhook resolution

Failed webhook rows are historical evidence and are never deleted. A successful reconciliation can mark only the event families that the reconciliation actually re-read:
- Stripe `customer.subscription.*`,
- PayPal `BILLING.SUBSCRIPTION.*`,
- Wise transfer state/failure/refund events.

Uncovered Stripe checkout/invoice/refund/dispute/payout failures and PayPal sale/refund/dispute failures remain unresolved. They require provider retry or a future authoritative financial reconciliation path.

## Security

- Provider credentials remain runtime secrets only.
- Raw provider webhook payloads are not stored.
- Reconciliation mutation RPCs are service-role only.
- The public health wrapper is security-invoker; its private implementation validates platform-admin access.
- Reconciliation run tables use RLS + FORCE RLS and deny direct table access.
- No reconciliation result can activate pricing or create a charge.
