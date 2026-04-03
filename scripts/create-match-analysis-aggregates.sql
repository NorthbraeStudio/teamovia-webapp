-- Stores precomputed timeline windows and summary metrics per match for fast dashboard reads.

create table if not exists public.match_analysis_aggregates (
  match_id uuid primary key references public.matches(id) on delete cascade,
  source_event_count integer not null default 0,
  source_min_timestamp numeric(8,3),
  source_max_timestamp numeric(8,3),
  base_bin_seconds numeric(6,3) not null default 1.000,
  timeline_windows jsonb not null default '[]'::jsonb,
  summary_metrics jsonb not null default '[]'::jsonb,
  insight_cards jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_match_analysis_aggregates_generated_at
  on public.match_analysis_aggregates (generated_at desc);

create index if not exists idx_match_analysis_aggregates_updated_at
  on public.match_analysis_aggregates (updated_at desc);
