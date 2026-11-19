-- Already applied to the league database on 2026-11-19 (kept here for reference).
-- Up to 4 games per player per week (BHL makeup weeks), and owner_of follows the real draft order.
alter table week_points add column if not exists g3 numeric not null default 0;
alter table week_points add column if not exists g4 numeric not null default 0;
alter table week_points drop constraint if exists week_points_pick_check;
alter table week_points add constraint week_points_pick_check check (pick between 1 and 4);
-- save_points now stores g1-g4 and a pick of 1-4 (see migration "schema_v16_more_games").
-- owner_of / draft_owner / draft_start: see migration "schema_v15_owner_fix".
-- The week advances automatically: the bhl-stats function (?advance=1) moves settings.league_week
-- forward to BHL's current "Week N" (never backward, max 8, only after Week 1 has started).
