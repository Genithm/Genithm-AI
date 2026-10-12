# Science V5: Codespaces MSA, conservation and phylogenetics

This is **local Codespaces development-only**. No Oracle deployment, production Supabase schema changes, research-job submissions or AI planner registration.

## Scientific pipeline

1. Paste 3–8 uniquely named, ungapped DNA/RNA FASTA records, maximum 300 nucleotides per record.
2. MAFFT aligns them through the existing scientific-worker wrapper and checks aligned sequence integrity against every input record. Runtime budget: 22 seconds.
3. The deterministic conservation profile reports position-by-position dominant A/C/G/T frequency, entropy, gap/missing rate, consensus, fully conserved/variable/parsimony-informative sites.
4. Optional FastTree infers an **unrooted** approximate maximum-likelihood topology. The returned Newick is strictly parsed, bounded and checked for exactly the submitted tips. Runtime budget: 18 seconds.
5. Export aligned FASTA, conservation CSV, JSON and Newick. JSON includes normalized multi-FASTA input SHA-256, but is unsigned, unsaved development evidence.

**Scientific limitations:** N and gaps are excluded from confirmed conservation frequencies. All-gap columns return an unknown score, not 0% conservation. Tree branch lengths are relative; there is no inferred biological root or divergence timeline. FastTree local support labels are not ordinary bootstrap probabilities. This does not classify pathogens, ancestry or clinical risk.

## Start in Codespaces

New Codespaces installs binaries during container setup. Existing Codespaces need to pull latest main and run setup again:

\`\`\`bash
bash .devcontainer/setup.sh
bash .devcontainer/start.sh
python3 scripts/test_codespaces_msa_v5.py
\`\`\`

Open the private forwarded port **3000**, then Development Preview → **Discover conservation and evolutionary patterns**. Choose MSA + conservation or MSA + conservation + FastTree.

## Verification

GitHub Actions Codespaces Preview Contract installs real MAFFT and FastTree executables, runs unit validation, TypeScript typecheck and real HTTP MSA phylogeny smoke tests. Full repository CI and hardened image security gates must pass before merge.

No production worker or Supabase migration is deployed by this milestone.
