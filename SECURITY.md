# Security Policy

Genithm is designed around least privilege, tenant isolation, auditable changes, and reproducible scientific execution.

## Never commit

- Supabase secret keys or legacy `service_role` keys
- Database passwords or direct production connection strings
- OAuth client secrets
- Private genomic/research datasets
- Production access tokens or credentials

Use deployment-native secret stores for server-side credentials. Frontend code may use only the Supabase project URL and publishable key, with Row Level Security enforcing authorization.

## Reporting security issues

Do not open a public issue for a suspected vulnerability. Report it privately to the project owner until a dedicated security contact is published.
