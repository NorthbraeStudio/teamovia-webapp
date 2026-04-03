-- Adds durable analysis lifecycle fields for each match run.
alter table public.matches
  add column if not exists analysis_status text,
  add column if not exists analysis_started_at timestamptz,
  add column if not exists analysis_completed_at timestamptz,
  add column if not exists analysis_error text;

-- Keep statuses bounded to known values.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'matches_analysis_status_check'
  ) then
    alter table public.matches
      add constraint matches_analysis_status_check
      check (analysis_status in ('queued', 'processing', 'completed', 'failed', 'stopped'));
  end if;
end$$;

create index if not exists idx_matches_analysis_status
  on public.matches (analysis_status);

create index if not exists idx_matches_analysis_started_at
  on public.matches (analysis_started_at desc);
