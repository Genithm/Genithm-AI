# Genithm V40: simplified light research workspace

This release changes the real authenticated application, not a generated product mockup.

## Design contract

- One root light theme independent of OS color scheme. Shared variables in `app/genithm-light.css` supply surface, text, accent, border, success, error and focus colors.
- Keep the existing `public/genithm-logo.webp` artwork supplied by the researcher. The shared `GenithmBrand` is used in both public and authenticated headers; no invented replacement logo.
- One header and one navigation rail. Six everyday destinations: AI Chat, Projects, Data, Pipelines, Results and Tools. Specialized labs and operational pages are available through Tools or the collapsed More menu.
- Real page/tool finder with Ctrl/Cmd+K, native dialog focus behavior and Escape-to-close. It does not claim to search the content of private data.
- The chat start screen offers three prompt suggestions, one composer and three quick actions. The technical run list and environment details are collapsed. Existing conversation pages use the same light theme and recent-chat sidebar.
- Result comparisons and metadata are disclosed on demand; scientific approval controls and truthful availability warnings stay visible.
- Projects and Data show actual end-user/RLS-scoped records with bounded queries and explicit failures. The Data page reuses the existing upload component; it never offers fake BAM/VCF uploads.
- Light treatment is applied to the chat, composer, pipeline, results, saved comparisons, notebook, FASTQ QC, VCF QC and scientific result explorer. Plot values and algorithms do not change.

## Preserved boundaries

No Supabase schema migration, credential change, worker update, storage migration, billing action or scientific job submission is required for this design release. Existing authentication, row-level policies, consent checks, source integrity checks, parsers and numerical calculations remain in effect. Features and metrics from the reference mockups are not inserted as real research results.

## Preview

Update the existing Codespace from `main` and refresh the port-3000 URL at `/dashboard/ai` after signing in. Existing dev servers use Fast Refresh; restart the configured web launcher if it is stopped. No Docker devcontainer rebuild is required for these source changes. `/preview` remains a sample workbench and is not the authenticated product.

## Review checklist

Check the start screen and a conversation, keyboard navigation/search, small-screen menu, empty Projects/Data, and saved results. Use a private test account for authenticated checks. Build/test success is not a production deployment or proof that all remote scientific workers are healthy.
