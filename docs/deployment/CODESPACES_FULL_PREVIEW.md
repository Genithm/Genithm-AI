# Codespaces Full Preview

This is a preview-only runtime for exercising the real Genithm application without provisioning Oracle, Render, or Cloudflare infrastructure.

## What runs

- Next.js web application on port 3000
- production API image on port 8000
- all six production worker images
- real Supabase project for auth, queues, and application data
- isolated temporary S3-compatible object storage inside the Codespace for FASTA uploads
- real NCBI, BLAST, Qwen, and DeepSeek integrations when their credentials are available

The production Oracle + Cloudflare deployment files are not changed by this preview runtime.

## Required Codespaces secrets

Create these repository Codespaces secrets before launching:

- `SUPABASE_SECRET_KEY`
- `QWEN_API_KEY`
- `DEEPSEEK_API_KEY`

Optional:

- `NCBI_API_KEY` for higher NCBI request limits
- `NCBI_EMAIL` to override the repository contact email
- `GENITHM_AI_PRIMARY_ENDPOINT` and `GENITHM_AI_PRIMARY_MODEL` for a different Qwen workspace/region
- `GENITHM_AI_BACKUP_ENDPOINT` and `GENITHM_AI_BACKUP_MODEL` for a different DeepSeek deployment

Never commit these values to the repository.

## Launch

Create a Codespace from `main`, then run from the repository root:

```bash
bash scripts/codespaces_preview.sh
```

The launcher prints the Genithm web preview URL when web and API health checks pass.

## Notes

- The preview object-storage credentials and audit-signing key are generated automatically for the Codespace session.
- The preview object storage is temporary and is not production R2.
- The web app proxies API requests through its own origin so the browser only needs the port-3000 preview URL.
- Stopping/deleting the Codespace stops the API and workers. This is not a 24/7 production deployment.
- Payment-provider flows still require their own Stripe/PayPal/Wise sandbox credentials if those screens are being tested.
