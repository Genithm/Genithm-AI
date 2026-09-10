create index billing_provider_refunds_requested_by_idx
  on public.billing_provider_refunds(requested_by)
  where requested_by is not null;
