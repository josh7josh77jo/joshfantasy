-- Run once in the Supabase SQL Editor (after schema_v10.sql).
-- Lets each owner upload a custom team logo (shrunk to 160x160 by the site).

create table if not exists team_logos (
  idx int primary key,
  logo text not null check (length(logo) < 200000 and logo like 'data:image/%'),
  updated_at timestamptz not null default now()
);
alter table team_logos enable row level security;
drop policy if exists "read team logos" on team_logos;
create policy "read team logos" on team_logos for select using (true);
-- no write policy: logos only change through set_team_logo below

create or replace function set_team_logo(p_logo text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles%rowtype;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.kicked or me.team is null then raise exception 'You need a team to set a logo.'; end if;
  if p_logo is null or p_logo = '' then
    delete from team_logos where idx = me.team;
    return;
  end if;
  if length(p_logo) >= 200000 or p_logo not like 'data:image/%' then raise exception 'That image is too large or not an image.'; end if;
  insert into team_logos (idx, logo, updated_at) values (me.team, p_logo, now())
  on conflict (idx) do update set logo = excluded.logo, updated_at = now();
end $$;
