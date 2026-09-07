# Signed audit checkpoints

Genithm's database audit ledger is hash-chained and append-only at the application boundary. Signed checkpoints add an independent cryptographic trust root so a database-only attacker cannot silently rewrite history and manufacture a trusted checkpoint without the external signing key.

## Flow

1. Every organization has an independent SHA-256 audit chain.
2. Chain sequence `1`, then every `25` events, creates an internal checkpoint request.
3. The database constructs a deterministic UTF-8 payload containing the organization ID, chain sequence, and chain-head hash and stores its SHA-256.
4. A dedicated `audit-worker` claims the request through service-only RPCs.
5. The worker recomputes the payload SHA-256 before signing.
6. The worker signs the exact payload with Ed25519 using a private 32-byte seed held only in the deployment secret manager.
7. The database stores the signature, raw public key, public-key SHA-256 fingerprint, key ID, payload hash, and signed timestamp in append-only `public.audit_checkpoints`.
8. Organization members may read proofs through RLS but cannot create, update, or delete them.

Checkpoint signing is asynchronous. An audit-signer outage must not block scientific transactions; failed checkpoint requests are bounded and retryable.

## Trust boundary

The Ed25519 private key MUST NOT be stored in:

- GitHub source code or Actions PR secrets
- Supabase tables, Vault, Storage, or frontend environment variables
- application logs
- browser-accessible configuration

Use a deployment secret manager or, in a later enterprise deployment, a KMS/HSM-backed signer.

The public key stored beside a checkpoint is useful cryptographic material but is **not by itself an independent trust root**. A privileged database attacker could replace database state with a checkpoint signed by a different key. Therefore production verification MUST compare `public_key_sha256` to a trusted fingerprint published outside the database trust domain (for example a controlled Trust Center, signed release metadata, or another independently protected registry).

## Canonical signing payload

Version `ed25519-v1` signs exactly:

```text
genithm-audit-checkpoint-v1
organization_id=<uuid>
chain_sequence=<integer>
chain_head_hash=<64 lowercase hex chars>
```

A final newline is included. No JSON canonicalization is required for this checkpoint format.

## Rotation

Key rotation creates a new `GENITHM_AUDIT_SIGNING_KEY_ID` and independently published public-key fingerprint. Historical checkpoints retain their original key identity and remain verifiable. Never overwrite old checkpoint rows or reuse a key ID for different key material.

## Current limitation

This milestone provides externally keyed signatures but does not yet export checkpoints to WORM/independent storage or use a hardware-backed KMS/HSM. Those are future hardening layers. It also does not claim blockchain consensus or absolute immutability.
