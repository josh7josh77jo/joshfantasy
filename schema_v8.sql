-- Run once in the Supabase SQL Editor (after schema_v7.sql).
-- Per-player weekly points (two games), locked by the team that owns the players.

create table week_points (
  week int not null check (week between 1 and 8),
  team int not null,
  pid int not null,
  start boolean not null default true,
  g1 numeric not null default 0,
  g2 numeric not null default 0,
  primary key (week, team, pid)
);
create table week_locks (
  week int not null check (week between 1 and 8),
  team int not null,
  locked_at timestamptz not null default now(),
  primary key (week, team)
);
alter table week_points enable row level security;
alter table week_locks enable row level security;
create policy "read points" on week_points for select using (true);
create policy "read locks" on week_locks for select using (true);
-- no write policies: points are only changed through the functions below

create function save_points(p_week int, p_rows jsonb) returns void
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
  if jsonb_array_length(p_rows) > 20 then raise exception 'Too many players.'; end if;
  delete from week_points where week = p_week and team = me.team;
  for x in select value from jsonb_array_elements(p_rows) loop
    v_pid := (x ->> 'pid')::int;
    if owner_of(v_pid) is distinct from me.team then raise exception 'You do not own one of those players.'; end if;
    insert into week_points (week, team, pid, start, g1, g2) values (
      p_week, me.team, v_pid, coalesce((x ->> 'start')::boolean, true),
      greatest(-1000, least(1000, coalesce((x ->> 'g1')::numeric, 0))),
      greatest(-1000, least(1000, coalesce((x ->> 'g2')::numeric, 0))));
  end loop;
end $$;

create function lock_points(p_week int) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles%rowtype;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.kicked or me.team is null then raise exception 'You need a team to lock points.'; end if;
  if not exists (select 1 from week_points where week = p_week and team = me.team) then
    raise exception 'Save your points first.';
  end if;
  insert into week_locks (week, team) values (p_week, me.team) on conflict do nothing;
end $$;

create function unlock_points(p_week int, p_team int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only the commissioner can unlock points.'; end if;
  delete from week_locks where week = p_week and team = p_team;
end $$;
