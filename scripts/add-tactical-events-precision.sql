-- Preserve sub-second timing for tactical analytics and improve query performance.

alter table public.tactical_events
  alter column timestamp_seconds type numeric(8,3)
  using timestamp_seconds::numeric(8,3);

create index if not exists idx_tactical_events_match_timestamp
  on public.tactical_events (match_id, timestamp_seconds);

create index if not exists idx_tactical_events_match_event_type
  on public.tactical_events (match_id, event_type);
