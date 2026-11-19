-- Run once in the Supabase SQL Editor (after schema_v9.sql).
-- Shares each team's starting lineup so everyone sees it on the Matchup tab without saving.

create table if not exists lineups (
  team int primary key,
  starters int[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table lineups enable row level security;
drop policy if exists "read lineups" on lineups;
create policy "read lineups" on lineups for select using (true);
-- no write policy: lineups only change through set_lineup below

create or replace function set_lineup(p_starters int[]) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles%rowtype; v int[];
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.kicked or me.team is null then raise exception 'You need a team to set a lineup.'; end if;
  select coalesce(array_agg(x), '{}') into v from (
    select distinct x from unnest(coalesce(p_starters, '{}')) as x where owner_of(x) = me.team limit 6) q;
  insert into lineups (team, starters, updated_at) values (me.team, v, now())
  on conflict (team) do update set starters = excluded.starters, updated_at = now();
end $$;
