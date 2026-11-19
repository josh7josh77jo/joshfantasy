-- Already applied to the league database on 2026-11-18 (kept here for reference).
-- Draft clock: 60 seconds per pick by default, and every deadline is set by the database clock.
alter table settings alter column timer set default 60;

create or replace function draft_start() returns void
language plpgsql security definer set search_path = public as $$
declare s settings%rowtype; nowms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if not is_admin() then raise exception 'Only the commissioner can start the draft.'; end if;
  select * into s from settings where id = 1;
  update draft_state set started = true, picks = '[]',
    deadline = case when s.timer > 0 then nowms + s.timer * 1000 else null end where id = 1;
end $$;

create or replace function draft_undo() returns void
language plpgsql security definer set search_path = public as $$
declare d draft_state%rowtype; s settings%rowtype; nowms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if not is_admin() then raise exception 'Only the commissioner can undo picks.'; end if;
  select * into d from draft_state where id = 1 for update;
  select * into s from settings where id = 1;
  if jsonb_array_length(d.picks) = 0 then return; end if;
  update draft_state set picks = d.picks - (jsonb_array_length(d.picks) - 1),
    deadline = case when s.timer > 0 then nowms + s.timer * 1000 else null end where id = 1;
end $$;

create or replace function draft_reset() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only the commissioner can reset the draft.'; end if;
  update draft_state set started = false, picks = '[]', deadline = null where id = 1;
end $$;
