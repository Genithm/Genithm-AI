# CI Cost Optimization V1

Genithm's private repository has a finite GitHub-hosted Actions allowance. CI therefore uses change-aware routing while preserving fail-closed security behavior.

## Always-on checks

Every CI run still performs:

- changed-path classification;
- repository security policy enforcement, including immutable action pins, digest-pinned Docker bases, non-root Dockerfiles, secretless workflows, and tracked high-risk secret pattern detection;
- dependency-free tests of the CI path classifier.

Superseded runs for the same pull request or branch are cancelled automatically.

## Targeted validation

- `apps/web/**` runs web install, TypeScript typecheck, and production build.
- `apps/api/**` runs API tests.
- `apps/<worker>-worker/**` runs that worker's test suite.
- worker files outside `tests/**` also run that worker's hardened image build, non-root/read-only runtime probe, HIGH/CRITICAL vulnerability gate, and CycloneDX SBOM generation.
- dependency audits run only when the corresponding dependency manifest changes, or when the routing implementation itself requires full code validation.
- a change to `.github/workflows/worker-image.yml` validates all six hardened worker images.
- unknown or newly introduced repository areas fail closed to full code, dependency, and image validation until explicitly classified.

Changes to the CI routing implementation itself run all application and worker tests plus dependency audits, but do not rebuild six unrelated worker images solely to validate routing logic.

## Worker release behavior

A successful `main` CI run still triggers the Worker Release workflow, but the workflow first checks the tested commit's changed paths.

Automatic six-image GHCR publication occurs only when worker runtime/image code or release/deployment assets require a new worker release. Unrelated UI, database, documentation, admin, or billing commits become a cheap validated no-op in Worker Release.

Manual Worker Release dispatch remains an explicit request for a complete six-image release and always publishes all workers.

## Security boundary

Cost reduction must not be implemented by weakening vulnerability severity, allowing mutable image tags, exposing secrets, removing the repository security policy, or bypassing relevant tests. If a path is not understood, the classifier deliberately chooses the more expensive full validation path.
