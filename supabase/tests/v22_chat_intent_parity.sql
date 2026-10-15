-- Science V22: the PostgreSQL consent gate and the chat UI must agree on
-- supported research requests. Uses the same corpus as the Node test.
-- Execute against disposable local Supabase after migration replay.
begin;
create temporary table v22_intent_cases (
  id text primary key,
  prompt text not null,
  expected_template text not null,
  expected_accession text not null
) on commit drop;

\copy v22_intent_cases FROM 'supabase/tests/v22_chat_intent_corpus.tsv' WITH (FORMAT csv, DELIMITER E'\t', HEADER true)

do $v22_intent_parity$
declare
  fixture record;
  actual_template text;
  actual_accession text;
  result_count integer;
begin
  if (select count(*) from v22_intent_cases) < 25 then
    raise exception 'V22 intent parity corpus is incomplete';
  end if;
  for fixture in select * from v22_intent_cases order by id loop
    select count(*),max(template),max(accession)
      into result_count,actual_template,actual_accession
    from app_private.parse_fixed_chat_protocol(fixture.prompt);
    if result_count <> case when fixture.expected_template='-' then 0 else 1 end
       or coalesce(actual_template,'-') <> fixture.expected_template
       or coalesce(actual_accession,'-') <> fixture.expected_accession then
      raise exception 'V22 SQL consent parity failed on case % (got % / %; expected % / %)',
        fixture.id,coalesce(actual_template,'-'),coalesce(actual_accession,'-'),
        fixture.expected_template,fixture.expected_accession;
    end if;
  end loop;
end
$v22_intent_parity$;
rollback;
