-- Run once in the Supabase SQL Editor (after schema_v8.sql).
-- Each starter stores which of the two games counts (pick = 1 or 2).
-- Only the owning team can save its own points (save_points checks this).

alter table week_points add column if not exists pick smallint not null default 1 check (pick in (1, 2));

create or replace function save_points(p_week int, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles%rowtype; s settings%rowtype; x jsonb; v_pid int;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.kicked or me.team is null then raise exception 'You need a team to enter points.'; end if;
  select * into s from settings where id = 1;
  if p_week < 1 or p_week > 8 or p_week > greatest(1, s.league_week) then raise exception 'That week has not started.'; end if;
  if exists (select 1 from week_locks where week = p_week and team = me.team) then
    raise exception 'Your points for this week are locked.';
  end if;
  if jsonb_array_length(p_rows) > 6 then raise exception 'A lineup has at most 6 starters.'; end if;
  delete from week_points where week = p_week and team = me.team;
  for x in select value from jsonb_array_elements(p_rows) loop
    v_pid := (x ->> 'pid')::int;
    if owner_of(v_pid) is distinct from me.team then raise exception 'You do not own one of those players.'; end if;
    insert into week_points (week, team, pid, start, g1, g2, pick) values (
      p_week, me.team, v_pid, coalesce((x ->> 'start')::boolean, true),
      greatest(-1000, least(1000, coalesce((x ->> 'g1')::numeric, 0))),
      greatest(-1000, least(1000, coalesce((x ->> 'g2')::numeric, 0))),
      case when (x ->> 'pick') = '2' then 2 else 1 end);
  end loop;
end $$;
