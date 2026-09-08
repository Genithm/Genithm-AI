# Plans & Entitlements Foundation V1

## Purpose

This slice introduces Genithm's provider-independent commercial policy layer without activating payment collection or arbitrary launch-time quotas.

The database, not plan-name conditionals in application code, is the operational source of truth for:

- organization plan assignment,
- subscription lifecycle state,
- feature entitlements,
- configurable soft/hard limits,
- idempotent usage metering.

A future payment provider may become the source of truth for payment settlement and provider subscription events, but provider state must be normalized into this controlled Genithm policy layer before it affects product authorization.

## V1 baseline

The migration seeds one active `free` baseline plan. It enables every Genithm capability that is already available before this migration. All soft and hard commercial limits are initially `NULL`.

That means:

- existing product behavior remains compatible,
- usage can be recorded and displayed,
- no customer is blocked by an invented quota,
- future plan changes are data/configuration changes rather than hard-coded feature branches.

## Tables

- `billing_plans`: plan catalog and lifecycle.
- `billing_features`: stable feature registry.
- `billing_usage_metrics`: stable metering definitions.
- `billing_plan_entitlements`: plan-to-feature policy.
- `billing_plan_limits`: plan-to-meter soft/hard limits.
- `organization_subscriptions`: one operational subscription assignment per organization.
- `usage_events`: immutable, idempotent usage ledger.

All V1 billing tables use forced RLS and deny direct Data API access. Reads and trusted writes pass through narrowly granted RPCs.

## Organization initialization

Every new organization receives the active baseline `free` plan using a database trigger. Existing organizations are backfilled idempotently during migration.

The trigger fails closed if no active baseline plan is configured.

## Member read surface

Authenticated organization members may call:

- `get_organization_plan_summary(organization_id)`
- `has_organization_entitlement(organization_id, feature_key)`

Both authorize against current organization membership inside the database.

The Plan & Usage dashboard shows:

- current plan and operational subscription status,
- enabled capabilities,
- usage meters,
- configured limits,
- whether commercial hard-limit enforcement is active.

## Trusted usage writer

`record_organization_usage(...)` is service-role-only. Browser clients cannot write usage.

Each usage event requires a per-organization idempotency key. Replaying the exact same event returns the existing event ID. Reusing the same key with different metering data fails.

Usage rows cannot be updated or deleted.

## Admin visibility

Platform admins receive aggregate billing operations visibility only:

- active plan count,
- organization subscription count,
- subscription state distribution,
- plan distribution,
- number of metered organizations,
- usage event count.

The admin surface does not expose payment instruments, provider credentials, invoices, scientific payloads, or user payment details.

## Explicitly out of scope

V1 does not implement:

- checkout,
- payment methods,
- invoices,
- refunds,
- taxes,
- provider webhooks,
- paid-plan assignment UI,
- price management,
- provider customer IDs,
- hard quota enforcement in scientific request RPCs.

Those belong to a subsequent payment-provider integration after the provider, commercial catalog, webhook verification, reconciliation, audit, and failure policy are defined.

## Enforcement rollout

Commercial enforcement should be enabled only after all of the following are true:

1. A real plan catalog has approved limits.
2. Usage writers are wired to authoritative execution points.
3. Provider lifecycle events are verified and idempotent.
4. Reconciliation exists for missed/out-of-order provider events.
5. Limit behavior has regression tests for scientific and AI workflows.
6. User-facing upgrade/payment recovery paths exist.

Until then, `NULL` hard limits mean observe-only metering rather than implicit unlimited commercial promises.
