-- Already applied to the league database on 2026-11-18 (kept here for reference).
-- Bid Battle clock: every bid resets the clock (snipe_ms, default 20 s), bids close at 0,
-- and there is a 3 second break (gap_until) before the next player opens.
-- server_ms() lets the site sync its clock to the database clock.
alter table game_state add column if not exists gap_until bigint;
update game_state set snipe_ms = 20000, round_ms = greatest(round_ms, 20000) where id = 1;
create or replace function server_ms() returns bigint
language sql stable as $$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;
-- place_bid: rejects bids during the break or after the clock ends; sets ends_at = now + snipe_ms.
-- resolve_round / skip_round / start_game: set gap_until = now + 3 s and ends_at = gap + round_ms.
-- resume_game / open_lobby: clear gap_until. game_settings / open_lobby: snipe_ms clamped to 5-60 s.
-- Full function bodies: see the Supabase migration "schema_v12_game_clock".

-- 2026-11-19 (migration "schema_v18_game_positions"): the break between players is now 5 seconds,
-- and game_players.pos (jsonb, player id -> W/C/D/G) stores the position each winner picks
-- through set_game_pos(p_pid, p_pos).
