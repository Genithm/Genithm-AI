# Sequence Validation Worker Deployment Contract

The Genithm sequence worker is a private background process. It does not expose a public HTTP port.

## Required runtime environment

- `SUPABASE_URL` - Genithm Supabase project URL.
- `SUPABASE_SECRET_KEY` - server-side Supabase secret key. Never expose this to browsers or commit it to source control.
- `GENITHM_SEQUENCE_VISIBILITY_SECONDS` - queue visibility lease, default `300`.
- `GENITHM_SEQUENCE_MAX_ATTEMPTS` - bounded infrastructure retries, default `3`.
- `GENITHM_SEQUENCE_POLL_SECONDS` - idle polling interval, default `2`.

## Security requirements

- Run the container as its built-in non-root user.
- Inject secrets through the deployment platform's secret store, not an image layer, command line, repository variable, or public environment variable.
- Do not publish ports; the worker only makes outbound TLS requests to Supabase.
- Prefer a read-only root filesystem and drop Linux capabilities where the deployment platform supports it.
- Restrict outbound networking to required Supabase endpoints when practical.
- Do not log raw FASTA content, authorization headers, or secret values.
- Treat `SUPABASE_SECRET_KEY` as privileged infrastructure material and rotate it if exposure is suspected.

## Processing model

1. The browser reserves an upload row and uploads the FASTA object to private Storage.
2. `complete_sequence_upload` verifies the authenticated user, the registered object path, and object existence before enqueueing.
3. The worker claims one queue message with a visibility timeout.
4. The worker downloads the registered private object and checks the downloaded byte count against the database record.
5. The deterministic validator classifies and validates the FASTA input.
6. A worker-only RPC atomically stores scientific metadata/provenance and deletes the queue message.
7. Infrastructure failures retry up to the configured maximum; scientific format failures are recorded as `rejected` rather than retried.

## Initial scaling posture

Start with one worker replica. The queue and visibility lease support horizontal scaling later, but concurrency should only be increased after observing validation latency, database load, Storage throughput, and retry behavior.

## Container checks

CI must verify that the image builds, the CLI entrypoint responds to `--help`, and the runtime UID is not root. A deployment is not considered live until a real deployment environment has the required server-side secret configured and the worker is observed processing queue jobs successfully.
