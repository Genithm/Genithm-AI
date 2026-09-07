# FastTree Phylogeny V1

Genithm Phylogeny V1 derives an approximate maximum-likelihood phylogenetic tree from a completed Genithm Multiple Sequence Alignment (MSA) job.

## Workflow boundary

`completed MSA -> immutable result dependency -> scientific_standard queue -> isolated scientific worker -> FastTree -> validated Newick -> private result artifact -> provenance + audit`

A phylogeny request never reads arbitrary user-supplied filesystem paths and never invokes an arbitrary command. The database resolves the completed source MSA and records its immutable result path, byte count, and SHA-256 in the tree job parameters and `scientific_job_dependencies`.

## Tool and models

- FastTree package: `2.1.11-2`
- Nucleotide/RNA invocation: `/usr/bin/FastTree -nt -gtr <alignment>`
- Protein invocation: `/usr/bin/FastTree <alignment>`
- Nucleotide/RNA model label: `gtr_cat`
- Protein model label: `jtt_cat`
- Worker: `genithm-scientific-worker/0.3.0`

FastTree produces an approximate maximum-likelihood tree. Internal support labels are FastTree local SH-like support values, not bootstrap percentages.

## V1 bounds

- source must be a completed Genithm MSA job
- 3-50 aligned sequences
- one validated sequence type across the source MSA
- source MSA artifact <= 25 MiB
- Newick result <= 4 MiB in the worker
- execution timeout: 300 seconds
- user rate limit: 10 requests/hour
- organization rate limit: 40 requests/hour
- standard scientific active-job concurrency limits also apply

## Input integrity

Before execution, the worker downloads the private MSA result from `analysis-results` and verifies:

1. exact expected byte count,
2. exact SHA-256,
3. ASCII FASTA structure,
4. exact `seq1..seqN` identifiers,
5. no duplicate or missing identifiers,
6. one equal non-zero aligned length across records.

The worker normalizes record order before passing the alignment to FastTree.

## Controlled execution

The command is constructed from fixed application constants. `subprocess.run` uses `shell=False`, stdin is disabled, stdout/stderr are captured, and execution is bounded by the tool timeout.

The scientific worker container pins the Debian Trixie `fasttree=2.1.11-2` package and verifies the installed package version and executable during image build.

## Output validation

FastTree stdout is parsed as a single Newick tree. Genithm rejects results with:

- malformed Newick structure,
- missing/duplicate/unexpected leaves,
- non-finite or negative branch lengths,
- local support values outside 0..1,
- trailing content after the terminating semicolon,
- result size above the worker limit.

The normalized result is stored privately as:

`<organization>/<project>/<job>/tree-result.nwk`

The worker uses no-overwrite upload semantics. On retry, an existing artifact is accepted only if its bytes hash to the expected deterministic result SHA-256.

## Provenance

A completed tree records:

- source MSA job ID,
- source MSA result SHA-256 and object path,
- FastTree tool/version,
- worker executor version,
- selected model,
- request fingerprint,
- result SHA-256 and byte count,
- leaf count,
- number of support-labelled internal nodes.

The explicit `scientific_job_dependencies` row preserves MSA -> tree lineage independently of UI presentation.

## Deployment note

The database, worker code, container, and UI workflow are production-oriented, but automatic execution still requires deployment of the scientific worker with server-side Supabase credentials supplied through a deployment secret manager. No server-side secret belongs in the browser or repository.
