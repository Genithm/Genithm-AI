# NCBI Connector Contract

Genithm retrieves public sequence records through a dedicated backend connector. The frontend and AI layer never call NCBI directly.

## V1 operation

`retrieve_sequence(database, accession)` supports `nucleotide` and `protein` accessions. The connector uses NCBI EFetch GBSeq XML/GenPept XML, validates the returned accession/version and sequence length, normalizes the record, renders deterministic FASTA, stores that FASTA in the private `sequence-inputs` bucket, then hands the object to the existing deterministic validation/statistics queue.

## Provenance

Each retrieval records the requested and resolved accession, source database, record title, organism, reported length, NCBI record update date, connector version, and retrieval timestamp. Versioned accessions are required to resolve to the exact requested version.

## Security and reliability

- fixed NCBI E-utilities base URL; users cannot supply arbitrary URLs
- backend-only optional NCBI API key
- required NCBI developer email and tool identifier
- bounded retries for transient HTTP/network failures
- 50 MiB ingestion limit
- independent queue and worker from the deterministic sequence validator
- worker runs non-root and exposes no public port
- service-role functions are not executable by browser roles
- external XML is parsed and validated before being normalized

Production network policy should allow only required Supabase endpoints and NCBI E-utilities for this worker.
