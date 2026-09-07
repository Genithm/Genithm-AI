# Protein Properties V1

Genithm Protein Properties V1 is a deterministic, offline physicochemical analysis for one validated protein FASTA record.

## Accepted input

- sequence upload status: `ready`
- exactly one FASTA record
- sequence type: `protein`
- 1–200,000 residues
- canonical 20 amino acids only: `ACDEFGHIKLMNPQRSTVWY`
- no gap characters
- immutable input SHA-256 is rechecked by the scientific worker before calculation

Ambiguous or non-standard residue symbols are rejected rather than silently approximated.

## Versioned calculations

Tool: `genithm-protein-properties/0.1.0`

The result includes:

- amino-acid composition counts
- sequence length
- average molecular weight using fixed average residue masses plus one water molecule
- aromaticity as the `F + W + Y` fraction
- GRAVY using the fixed Kyte–Doolittle hydropathy scale
- estimated net charge at pH 7 using the Genithm Henderson–Hasselbalch V1 pKa set
- estimated isoelectric point by deterministic bisection of the same zero-charge model over pH 0–14

All method identifiers and the immutable input SHA-256 are persisted in provenance.

## Scientific limitations

Charge and pI are model-based estimates, not experimental measurements. V1 does not model post-translational modifications, disulfide state, cofactors, terminal modifications, non-standard amino acids, structural context, domains, motifs, or biological function.

Domain/motif/function workflows must use separate evidence-backed scientific tools and authoritative-source provenance rather than infer those claims from this physicochemical result.

## Execution and result integrity

The analysis is executed by the isolated scientific worker, not the API server. It requires no outbound network access. Results are stored privately in `analysis-results` as `protein-properties.json`; retries only accept an existing artifact when its bytes match the deterministic output. The normalized result and provenance are validated by a service-role-only completion RPC before the job can enter `completed` state.
