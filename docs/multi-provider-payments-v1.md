# Multi-provider Payments V1

Genithm billing is provider-neutral. Plans, entitlements and usage live in Genithm; external payment providers supply only the financial rails.

## Supported adapters

### Stripe
Capabilities: checkout, subscriptions, Customer Portal, invoices, refunds, disputes, payouts, webhooks.

Server secrets/config:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Webhook endpoint: `/api/billing/webhook`

### PayPal
Capabilities: subscription checkout, recurring billing, subscription management, subscription-payment ledger, audited refunds, dispute visibility and webhook reconciliation. PayPal uses OAuth 2.0 client credentials.

Server secrets/config:
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_WEBHOOK_ID`
- `PAYPAL_ENVIRONMENT=sandbox|live`

Webhook endpoint: `/api/billing/paypal/webhook`

The webhook handler verifies the message through PayPal's verify-webhook-signature REST API before processing it. Subscription state is re-read from PayPal before Genithm changes organization plan state.

Financial webhook events used by Genithm include:
- `PAYMENT.SALE.COMPLETED`
- `PAYMENT.SALE.PENDING`
- `PAYMENT.SALE.DENIED`
- `PAYMENT.SALE.REVERSED`
- `PAYMENT.SALE.REFUNDED`
- `CUSTOMER.DISPUTE.*`
- existing `BILLING.SUBSCRIPTION.*` lifecycle events

Subscription sale IDs are persisted as the authoritative PayPal refund target. Payment/refund/dispute amounts are stored in provider currency major units so currencies are not incorrectly forced into a two-decimal minor-unit model.

PayPal refunds initiated from Genithm require Platform Admin + AAL2/MFA. Full remaining refund is used when amount is blank; partial refund amounts are supported. Cumulative pending/completed refund requests are deducted before a new refund is authorized. A refund initiated directly in the PayPal dashboard is also materialized by webhook reconciliation so later Genithm refunds cannot ignore it.

PayPal sandbox and live financial records are explicitly separated. A refund request is authorized only against a sale in the currently configured PayPal environment.

### Wise
Capabilities: international transfer/payout rail and signed transfer-state webhooks. Wise is not treated as a recurring SaaS checkout processor.

Server secrets/config:
- `WISE_API_TOKEN`
- `WISE_PROFILE_ID`
- `WISE_ENVIRONMENT=sandbox|live`
- `WISE_WEBHOOK_PUBLIC_KEY`

Webhook endpoint: `/api/billing/wise/webhook`

Wise webhooks are verified with RSA-SHA256 against the raw body and `X-Signature-SHA256`. Genithm stores Wise recipient/account IDs only; raw recipient bank details are not stored.

## Provider onboarding flow

1. Put provider credentials only in the deployment secret manager/runtime environment.
2. Open `/dashboard/admin/billing/payments/setup` as platform admin with AAL2/MFA.
3. Click **Verify connection** for the provider.
4. For Stripe or PayPal, create commercial plan pricing from the same setup page. Product/price/plan IDs are created and mapped automatically.
5. Configure the provider webhook endpoint and its verification material.
6. Test in sandbox/test mode before configuring the separate live catalog.

For PayPal, subscribe the configured webhook to subscription lifecycle, `PAYMENT.SALE.*`, and `CUSTOMER.DISPUTE.*` events used above. The PayPal webhook ID must match the app/environment that produced the events.

## Subscription safety

Genithm permits only one active paid subscription rail for an organization at a time. Starting a second Stripe/PayPal checkout while another provider subscription is active is rejected.

The provider's external status is normalized into `organization_subscriptions`; cancellation/expiry falls back to the Free plan. Provider events have idempotency ledgers and subscription event-ordering guards.

## Financial operations safety

- Stripe keeps its existing hardened invoice/PaymentIntent refund flow.
- PayPal subscription payments are recorded from verified sale webhooks before they become eligible for Genithm-admin refunds.
- PayPal refund authorization is mode-specific (`sandbox` vs `live`) and Platform Admin + AAL2/MFA gated.
- PayPal refund requests are audited and cumulative refund amounts are checked before provider execution.
- PayPal refunds initiated outside Genithm are reconciled into the same refund ledger from verified webhooks.
- PayPal disputes are mirrored into the provider-neutral transaction ledger for operational visibility; dispute resolution actions remain provider-side unless explicitly implemented later.
- Raw webhook payloads are not retained. Only provider event identity/type/digest and normalized financial state are stored.

## Wise transfer safety

Wise transfer creation is platform-admin + AAL2/MFA gated. Genithm creates an authenticated quote and transfer instruction for an existing Wise recipient ID. Funding availability depends on the Wise account, region and integration permissions; the application does not pretend that every Wise API token can fund transfers automatically.

## Provider-neutral extension contract

Provider metadata/capabilities are stored in `billing_payment_providers`. Provider-neutral connection, price mapping, subscription, transaction, refund-request, transfer and webhook tables avoid hard-coding the commercial model to Stripe.

A future provider such as Adyen, Paddle, Razorpay or another payout rail should be added as a server adapter plus a provider registry entry/capability mapping. Organization plan, entitlement and usage schemas do not need to be redesigned.

## Security boundaries

- No provider secret is stored in Postgres.
- No provider secret is exposed through `NEXT_PUBLIC_*`.
- No raw card data is stored by Genithm.
- No raw Wise recipient bank details are stored by Genithm.
- Provider webhook payloads are not persisted; only identity, event type and SHA-256 digest are retained.
- Provider-neutral tables use RLS + FORCE RLS and deny direct anon/authenticated access.
- Service synchronization functions are service-role only.
- Member billing views are organization-authorized.
- Provider configuration, PayPal refunds and Wise transfer creation require platform-admin + AAL2/MFA where financially sensitive.

## Current commercial activation state

Adding provider support does not activate prices or charges. Paid plans remain non-chargeable until credentials are attached, connections are verified and a commercial price is explicitly created for that provider/environment.
