create table profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_]{3,20}$'),
  team int,
  kicked boolean not null default false,
  is_admin boolean not null default false
);
create table settings (
  id int primary key default 1 check (id = 1),
  teams int not null default 12,
  rounds int not null default 8,
  roster int not null default 9,
  timer int not null default 0
);
insert into settings default values;

create function is_admin() returns boolean
language sql security definer stable as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;

alter table profiles enable row level security;
alter table settings enable row level security;

create policy "read profiles" on profiles for select using (true);
create policy "create own profile" on profiles for insert
  with check (id = auth.uid() and team is null and not kicked and not is_admin);
create policy "admins update profiles" on profiles for update using (is_admin());
create policy "read settings" on settings for select using (true);
create policy "admins update settings" on settings for update using (is_admin());
