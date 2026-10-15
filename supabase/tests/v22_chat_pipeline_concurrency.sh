#!/usr/bin/env bash
# Disposable local Supabase only: two *separate* authenticated sessions
# contend on one saved message. All approved jobs remain in local PostgreSQL
# and are discarded when GitHub Actions stops the local database.
set -euo pipefail
db="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
tmp=$(mktemp -d)
first_pid=""
second_pid=""
cleanup() {
  if [[ -n "$first_pid" ]]; then kill "$first_pid" 2>/dev/null || true; fi
  if [[ -n "$second_pid" ]]; then kill "$second_pid" 2>/dev/null || true; fi
  rm -rf "$tmp"
}
trap cleanup EXIT

# These fixtures are committed in the disposable CI database so multiple
# independent connections can see them; unlike the single-session V22 test,
# a surrounding ROLLBACK cannot provide concurrency coverage.
cat > "$tmp/fixture.sql" <<'SQL'
begin;
insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at)
values ('b1000000-0000-4000-8000-000000000001',
        '00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','science-v22-concurrent@localhost.invalid','',now());
insert into public.organizations (id,name,slug,created_by)
values ('b2000000-0000-4000-8000-000000000001',
        'V22 concurrent local org','v22-concurrent-local-org',
        'b1000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id,user_id,role)
values ('b2000000-0000-4000-8000-000000000001',
        'b1000000-0000-4000-8000-000000000001','owner');
insert into public.projects (id,organization_id,name,created_by)
values ('b3000000-0000-4000-8000-000000000001',
        'b2000000-0000-4000-8000-000000000001',
        'V22 concurrent local project','b1000000-0000-4000-8000-000000000001');
insert into public.ai_conversations (id,organization_id,project_id,created_by,title,status)
values ('b4000000-0000-4000-8000-000000000001',
        'b2000000-0000-4000-8000-000000000001',
        'b3000000-0000-4000-8000-000000000001',
        'b1000000-0000-4000-8000-000000000001',
        'V22 parallel consent test','active');
insert into public.ai_messages
 (id,conversation_id,organization_id,project_id,conversation_owner_id,role,content,protocol_input_scope)
values
 ('b5000000-0000-4000-8000-000000000001',
  'b4000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'user','Retrieve NM_000546.6 and run an ORF scan','text_only'),
 ('b5000000-0000-4000-8000-000000000002',
  'b4000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'user','Retrieve NM_000546.5 and run an ORF scan','text_only');
commit;
SQL
psql "$db" -X -qAt -v ON_ERROR_STOP=1 -f "$tmp/fixture.sql"

run_pair() {
  local msg="$1" outcome="$2" expected="$3" first_run second_run found blocked
  cat > "$tmp/first.sql" <<SQL
begin;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select public.approve_chat_research_pipeline('$msg') as run_id \\gset
\\echo APPROVED=:run_id
select pg_sleep(5);
$outcome;
SQL
  cat > "$tmp/second.sql" <<SQL
begin;
set local role authenticated;
set local statement_timeout='20000ms';
select pg_catalog.set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
\\echo REQUESTING_APPROVAL
select public.approve_chat_research_pipeline('$msg') as run_id \\gset
\\echo APPROVED=:run_id
commit;
SQL
  : > "$tmp/first.log"
  : > "$tmp/second.log"
  psql "$db" -X -qAt -v ON_ERROR_STOP=1 -f "$tmp/first.sql" > "$tmp/first.log" 2>&1 &
  first_pid=$!
  found=0
  for _ in $(seq 1 100); do
    if grep -q '^APPROVED=' "$tmp/first.log"; then found=1; break; fi
    if ! kill -0 "$first_pid" 2>/dev/null; then break; fi
    sleep 0.1
  done
  if [[ "$found" != "1" ]]; then cat "$tmp/first.log"; echo "First approval did not reach lock" >&2; exit 1; fi

  PGAPPNAME="v22-waiting-approval" psql "$db" -X -qAt -v ON_ERROR_STOP=1 -f "$tmp/second.sql" > "$tmp/second.log" 2>&1 &
  second_pid=$!
  blocked=0
  for _ in $(seq 1 30); do
    found=$(psql "$db" -X -qAt -v ON_ERROR_STOP=1 -c \
      "select count(*) from pg_catalog.pg_stat_activity where application_name='v22-waiting-approval' and wait_event_type='Lock';")
    if [[ "$found" == "1" ]]; then blocked=1; break; fi
    if grep -q '^APPROVED=' "$tmp/second.log"; then break; fi
    sleep 0.1
  done
  if [[ "$blocked" != "1" ]]; then
    cat "$tmp/first.log" "$tmp/second.log"
    echo "Second request did not block on the first transaction" >&2
    exit 1
  fi
  if grep -q '^APPROVED=' "$tmp/second.log"; then
    echo "Second approval returned before the first released its transaction" >&2
    exit 1
  fi

  if ! wait "$first_pid"; then cat "$tmp/first.log"; exit 1; fi
  first_pid=""
  if ! wait "$second_pid"; then cat "$tmp/second.log"; exit 1; fi
  second_pid=""
  first_run=$(sed -n 's/^APPROVED=//p' "$tmp/first.log" | tail -n 1)
  second_run=$(sed -n 's/^APPROVED=//p' "$tmp/second.log" | tail -n 1)
  if [[ -z "$first_run" || -z "$second_run" ]]; then
    cat "$tmp/first.log" "$tmp/second.log"; exit 1
  fi
  if [[ "$expected" == "same" && "$first_run" != "$second_run" ]]; then
    echo "Simultaneous approvals created different pipeline runs" >&2; exit 1
  fi
  if [[ "$expected" == "different" && "$first_run" == "$second_run" ]]; then
    echo "Rolled-back approval incorrectly left its run behind" >&2; exit 1
  fi
  local persisted
  persisted=$(psql "$db" -X -qAt -v ON_ERROR_STOP=1 -c \
    "select coalesce(research_pipeline_run_id::text,'') from public.ai_messages where id='$msg';")
  if [[ "$persisted" != "$second_run" ]]; then
    echo "Stored message link does not match successful approval" >&2; exit 1
  fi
  local count
  count=$(psql "$db" -X -qAt -v ON_ERROR_STOP=1 -c \
    "select count(*) from public.research_pipeline_runs where id='$persisted' and requested_by='b1000000-0000-4000-8000-000000000001' and project_id='b3000000-0000-4000-8000-000000000001';")
  if [[ "$count" != "1" ]]; then
    echo "Committed pipeline missing or outside authorized owner/project" >&2; exit 1
  fi
  echo "PASS: $expected run identity under two contending sessions"
}

run_pair 'b5000000-0000-4000-8000-000000000001' commit same
run_pair 'b5000000-0000-4000-8000-000000000002' rollback different
count=$(psql "$db" -X -qAt -v ON_ERROR_STOP=1 -c \
  "select count(*) from public.research_pipeline_runs where project_id='b3000000-0000-4000-8000-000000000001';")
if [[ "$count" != "2" ]]; then
  echo "Expected one committed pipeline per approved message, got $count" >&2
  exit 1
fi
echo "PASS: both commit and rollback interleavings create exactly one durable run per message"
