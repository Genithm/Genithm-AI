# Stripe Payments V1

Genithm uses Stripe-hosted checkout and the Stripe Customer Portal. Genithm stores provider identifiers and normalized operational state only. Card numbers, bank-account details, Stripe secret keys, and webhook signing secrets are never stored in application tables.

## Runtime credentials

Configure these only in the deployment secret manager/server environment:

- `STRIPE_SECRET_KEY` — `sk_test_...` during validation, then `sk_live_...` for production.
- `STRIPE_WEBHOOK_SECRET` — signing secret for the Genithm webhook endpoint.
- `SUPABASE_URL` — Genithm Supabase URL.
- `SUPABASE_SECRET_KEY` — backend-only Supabase secret key used by verified webhook/reconciliation code.
- `GENITHM_APP_URL` — canonical HTTPS origin of the deployed web app.

Never expose any of these through a `NEXT_PUBLIC_` variable.

## One-time Stripe Dashboard setup

1. Complete the Stripe account/business verification flow.
2. Attach the payout bank account and choose the payout schedule in Stripe. Genithm does not collect or store bank details.
3. Create a webhook endpoint at `https://YOUR_APP/api/billing/webhook`.
4. Subscribe that endpoint to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.created`
   - `invoice.updated`
   - `invoice.finalized`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `invoice.voided`
   - `refund.created`
   - `refund.updated`
   - `refund.failed`
   - `charge.dispute.created`
   - `charge.dispute.updated`
   - `charge.dispute.closed`
   - `payout.created`
   - `payout.updated`
   - `payout.paid`
   - `payout.failed`
   - `payout.canceled`
5. Copy the webhook endpoint's `whsec_...` signing secret to `STRIPE_WEBHOOK_SECRET` in the deployment secret manager.
6. Enable Stripe Customer Portal features for payment-method updates, invoice history, cancellation/reactivation, and subscription changes. Configure the Genithm products/prices that customers may switch between.

## Activating commercial prices

Open **Platform Admin → Payment setup** with an MFA/AAL2 session. Choose Researcher, Professional, or Team, then enter:

- monthly or yearly interval,
- ISO currency,
- amount in the currency's minor units.

One submit:

1. creates/reuses the Stripe Product,
2. creates the immutable Stripe recurring Price,
3. maps the Stripe price to Genithm,
4. activates the corresponding Genithm commercial plan.

Genithm deliberately does not invent commercial amounts. Enterprise remains contract-oriented rather than public self-service checkout.

## Customer flow

Organization owners/admins use **Payments**:

- first checkout automatically creates a Stripe Customer tagged with `genithm_organization_id`,
- Stripe Checkout handles payment collection,
- verified webhooks synchronize subscription state and entitlements,
- Stripe Customer Portal handles payment methods, invoices, plan changes, cancellation, and reactivation,
- recent normalized invoices are visible in Genithm,
- a manual reconciliation endpoint can pull current Stripe subscriptions/invoices if an operator needs to recover from a delayed webhook.

Only one recurring Stripe price item is supported per Genithm organization subscription in V1. Add-on/multi-item subscriptions require a separate schema and pricing review.

## Webhook integrity and replay behavior

- Signature validation uses Stripe's signed raw request body with HMAC-SHA256.
- Timestamp tolerance is 5 minutes.
- The raw Stripe payload is not persisted.
- Genithm stores the event ID, event type, provider timestamp, SHA-256 payload digest, attempt count, and processing result.
- Duplicate deliveries with the same event ID/digest are idempotent.
- Replays with the same event ID but mismatched payload digest are rejected.
- Subscription synchronization tracks provider event time so an older out-of-order event cannot regress a newer subscription/entitlement state.
- Failed processing returns HTTP 5xx so Stripe can retry.

## Refunds

Refunds are available only from **Platform Admin → Payment operations** and require MFA/AAL2.

- The database authorizes the refund before the external call.
- Pending duplicate refunds for the same invoice are rejected.
- Cumulative pending/successful refund amounts cannot exceed the recorded paid invoice amount.
- The refund request is written to the tamper-evident Genithm audit chain.
- Stripe receives an idempotency key derived from the Genithm refund request ID.
- Stripe refund webhooks reconcile final status.

## Payouts and disputes

Genithm mirrors payout and dispute operational state for platform admins. It does not initiate arbitrary payouts and never stores payout bank credentials. Automatic payout behavior and payout destination remain Stripe-controlled.

Disputes are associated to an organization through the Stripe PaymentIntent/invoice relationship when available; otherwise the dispute is preserved as an unmapped provider operation for investigation rather than guessed onto an organization.

## Test-to-live checklist

1. Use Stripe test credentials and a test webhook endpoint.
2. Configure test prices from Payment setup.
3. Complete a test Checkout payment.
4. Confirm subscription and invoice synchronization in Payments.
5. Test Customer Portal cancellation/reactivation and plan switching.
6. Test one refund with MFA/AAL2 and confirm webhook reconciliation.
7. Confirm webhook event ledger has no failed events.
8. Complete Stripe live account verification and payout-bank setup.
9. Replace `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` together with live values.
10. Configure live commercial prices from Payment setup.
11. Run a small live transaction and verify subscription, invoice, refund (if desired), and payout visibility before public launch.

## Current commercial boundary

Hard scientific/AI usage quotas remain disabled until explicit reviewed limits are configured. Payment activation does not silently invent or enable resource caps.
