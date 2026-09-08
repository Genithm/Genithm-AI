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
Capabilities: subscription checkout, recurring billing, subscription management, webhook reconciliation. PayPal uses OAuth 2.0 client credentials.

Server secrets/config:
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_WEBHOOK_ID`
- `PAYPAL_ENVIRONMENT=sandbox|live`

Webhook endpoint: `/api/billing/paypal/webhook`

The webhook handler verifies the message through PayPal's verify-webhook-signature REST API before processing it. Subscription state is re-read from PayPal before Genithm changes organization plan state.

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

## Subscription safety

Genithm permits only one active paid subscription rail for an organization at a time. Starting a second Stripe/PayPal checkout while another provider subscription is active is rejected.

The provider's external status is normalized into `organization_subscriptions`; cancellation/expiry falls back to the Free plan. Provider events have idempotency ledgers and event ordering guards.

## Wise transfer safety

Wise transfer creation is platform-admin + AAL2/MFA gated. Genithm creates an authenticated quote and transfer instruction for an existing Wise recipient ID. Funding availability depends on the Wise account, region and integration permissions; the application does not pretend that every Wise API token can fund transfers automatically.

## Provider-neutral extension contract

Provider metadata/capabilities are stored in `billing_payment_providers`. Provider-neutral connection, price mapping, subscription, transaction, transfer and webhook tables avoid hard-coding the commercial model to Stripe.

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
- Provider configuration and Wise transfer creation require platform-admin + AAL2/MFA.

## Current commercial activation state

Adding provider support does not activate prices or charges. Paid plans remain non-chargeable until credentials are attached, connections are verified and a commercial price is explicitly created for that provider/environment.
