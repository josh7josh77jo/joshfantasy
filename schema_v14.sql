-- Already applied to the league database on 2026-11-18 (kept here for reference).
-- Start-draft options: snake or straight, time per pick, and a draft order (default, random or custom).
alter table draft_state add column if not exists snake boolean not null default true;
alter table draft_state add column if not exists ord jsonb;  -- team indexes, first pick first; null = default order
-- draft_start(p_snake, p_timer, p_order): commissioner only; timer must be 0/30/60/300/600/1200/1800/3600 seconds;
--   saves the timer to settings and starts the draft with a database-timed deadline.
-- make_pick: works out whose turn it is from snake + ord (falls back to the old default order).
-- Full function bodies: see the Supabase migration "schema_v14_draft_options".
