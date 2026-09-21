# Codespaces Full Preview

This is a preview-only runtime for exercising the real Genithm application without provisioning Oracle, Render, or Cloudflare infrastructure.

## What runs

- Next.js web application on port 3000
- production API image on port 8000
- all six production worker images
- real Supabase project for auth, queues, and application data
- isolated temporary S3-compatible object storage inside the Codespace for FASTA uploads
- real NCBI and BLAST integrations
- DeepSeek as the preview AI provider

The production Oracle + Cloudflare deployment files are not changed by this preview runtime.

## Required Codespaces secrets

Create these repository Codespaces secrets before launching:

- `SUPABASE_SECRET_KEY`
- `DEEPSEEK_API_KEY`

Qwen is not required for the Codespaces preview.

Optional:

- `NCBI_API_KEY` for higher NCBI request limits
- `NCBI_EMAIL` to override the repository contact email
- `GENITHM_AI_PRIMARY_ENDPOINT` to override the DeepSeek API endpoint
- `GENITHM_AI_PRIMARY_MODEL` to override the DeepSeek model; the preview default is `deepseek-flash`

Never commit these values to the repository.

## Launch

Create a Codespace from `main`, then run from the repository root:

```bash
bash scripts/codespaces_preview.sh
```

The launcher prints the Genithm web preview URL only after Supabase Auth confirms email login/signup are enabled, web/API health checks pass, and the authoritative Supabase release-readiness RPC reports all six worker heartbeats current.

## Notes

- The preview object-storage credentials and audit-signing key are generated automatically for the Codespace session.
- The preview object storage is temporary and is not production R2.
- The web app proxies API requests through its own origin so the browser only needs the port-3000 preview URL.\n- Signup confirmation redirects use the server-side `GENITHM_APP_URL`; the browser cannot override the confirmation origin.\n- If any worker fails to heartbeat or a required queue is missing, the launcher exits non-zero and prints the readiness result instead of reporting a healthy preview.
- Stopping/deleting the Codespace stops the API and workers. This is not a 24/7 production deployment.
- Payment-provider flows still require their own Stripe/PayPal/Wise sandbox credentials if those screens are being tested.
