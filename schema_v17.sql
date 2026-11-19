-- Already applied to the league database on 2026-11-19 (kept here for reference).
-- Players the site drafts from (copied from index.html) so the server can score weeks.
create table if not exists fantasy_players (pid int primary key, name text not null, goalie boolean not null, team text not null, pts numeric not null default 0);
alter table fantasy_players enable row level security;
drop policy if exists "read fantasy players" on fantasy_players;
create policy "read fantasy players" on fantasy_players for select using (true);
insert into fantasy_players (pid, name, goalie, team, pts) values (100,'Robay',false,'MIN',378),(101,'Wapex',false,'CGY',292),(102,'Maspn',false,'CGY',322),(103,'Youppi',false,'BOS',262),(104,'ArdenB',false,'ORL',204),(105,'Booty',false,'MIN',190),(106,'StyxFPS',false,'PHI',206),(107,'misyuh',false,'NYC',194),(108,'StanVee',false,'SFS',204),(109,'glennyboo',false,'NYC',162),(110,'mushyplant',false,'CGY',164),(111,'Tenggo',false,'MIL',176),(112,'St8rm_',false,'ORL',172),(113,'falgaze',false,'PHI',164),(114,'pichipah',false,'SFS',164),(115,'socksPK',false,'BOS',172),(116,'Pluds',false,'CAR',134),(117,'Ghostyferret',false,'BOS',146),(118,'Drxpski',false,'CAR',148),(119,'borderlinedumb',false,'TOR',130),(120,'zCDSz',false,'MIL',134),(121,'TopRages',false,'MTL',100),(122,'catcuddler',false,'TOR',120),(123,'Sammythewhale',false,'TOR',94),(124,'Badgers777',false,'MTL',102),(125,'Ze01_',false,'CAR',98),(126,'JrGoof',false,'CGY',114),(127,'FakeMrFlimFlam',false,'BOS',110),(128,'Dcker',false,'MIN',70),(129,'Pureyst',false,'NYC',98),(130,'JigglyMercury',false,'SEA',90),(131,'Krroniikz',false,'MTL',80),(132,'Ra1ded',false,'MIN',88),(133,'shoulderxd',false,'ORL',88),(134,'B0TZ_',false,'MTL',96),(135,'Concxrd',false,'CAR',78),(136,'alexnr17',false,'PHI',74),(137,'frumpybear',false,'CGY',52),(138,'tbhsilence',false,'PHI',60),(139,'Jaydoh',false,'TOR',72),(140,'ohLuvv',false,'TOR',68),(141,'biscuitok',false,'CAR',72),(142,'syffin',false,'SFS',46),(143,'whofarted21',false,'NYC',54),(144,'xulus',false,'TOR',54),(145,'PlondTwos',false,'PHI',54),(146,'Plud5',false,'MTL',62),(147,'AlienIsLurking',false,'SFS',54),(148,'jplmao',false,'MIN',70),(149,'luisdagoat245',false,'NYC',66),(150,'JoDogg',false,'SEA',54),(151,'Birdyw',false,'SEA',48),(152,'Camper51192',false,'CAR',44),(153,'LakeAlakej',false,'NYC',40),(154,'Goriest',false,'PHI',34),(155,'noobilybridge',false,'CAR',38),(156,'Outduel',false,'CAR',34),(157,'rsktak',false,'CGY',30),(158,'Lampeyre',false,'SFS',38),(159,'Molong4',false,'MIL',34),(160,'liayno',false,'SEA',42),(161,'IamOptical',false,'MTL',46),(162,'owpn',false,'MIL',50),(163,'ShugShug22',false,'MTL',36),(164,'Farabeee',false,'MIL',36),(165,'OnlyBirb',false,'SEA',24),(166,'Viz0',false,'ORL',24),(167,'MonsterIsBlue',false,'SFS',40),(168,'Aerraax',false,'BOS',28),(169,'Shiestyferret',false,'BOS',18),(170,'OmgAj',false,'MIN',22),(171,'cga',false,'ORL',18),(172,'ItsKevout',false,'TOR',30),(173,'Frown777',false,'MTL',18),(174,'AllahFresco',false,'BOS',30),(175,'OptionalLabour',false,'MIL',18),(176,'Smartgrifin_',false,'MIL',30),(177,'Jedwando',false,'MIN',16),(178,'VacuolateBeef24',false,'PHI',16),(179,'Gusthecow8',false,'TOR',12),(180,'Bwgged',false,'MIN',20),(181,'Konecny',false,'ORL',20),(182,'lega1',false,'SFS',16),(183,'kwot',false,'SEA',12),(184,'Spray_23',false,'ORL',20),(185,'broudfn',false,'ORL',10),(186,'LilYouppi',false,'SEA',10),(187,'PandaMan1010',false,'PHI',10),(188,'seekerHAP',false,'ORL',6),(189,'DragonBallZ',false,'CAR',10),(190,'lidz',false,'PHI',6),(191,'ProbablyCaption',false,'MTL',6),(192,'MeatTortellini',false,'ORL',6),(193,'wilonoto',false,'SEA',6),(194,'Bytt',false,'CGY',6),(195,'DBGxo',false,'BOS',10),(196,'QuakeTFA',false,'MIL',10),(197,'uuluz',false,'MIL',6),(198,'Sixty04',false,'MIL',6),(300,'packrs',true,'CGY',154),(301,'Emxtion',true,'TOR',150),(302,'PandaMan1010',true,'PHI',143),(303,'Bagouu_',true,'NYC',206),(304,'bagelglazed',true,'BOS',72),(305,'ToastedXD',true,'SFS',166),(306,'zazpal',true,'MTL',37),(307,'DragonBallZ',true,'CAR',64),(308,'Color_Derp',true,'SEA',18),(309,'MF_RAYADO',true,'MIN',42),(310,'Ra1ded',true,'MIN',73),(311,'broudfn',true,'ORL',137),(312,'ZombieMagikarp',true,'MIL',-91),(313,'SpookyMount',true,'MIN',39),(314,'CartoonyMan',true,'SEA',33),(315,'AarBear_',true,'BOS',0),(316,'Nyxes12',true,'CAR',4),(317,'_bo0gie',true,'CGY',16),(318,'Gilan',true,'ORL',-52),(319,'DeBrando',true,'PHI',31)
on conflict (pid) do update set name = excluded.name, goalie = excluded.goalie, team = excluded.team, pts = excluded.pts;

-- Weeks that have been finalized (locked and scored).
create table if not exists week_final (week int primary key check (week between 1 and 8), at timestamptz not null default now());
alter table week_final enable row level security;
drop policy if exists "read week final" on week_final;
create policy "read week final" on week_final for select using (true);

-- Each team's starters for a week: saved picks first, then the shared lineup, then the best players by last season's points.
create or replace function week_lineups(p_week int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare n int; t int; out jsonb := '[]'; st jsonb; sk int; g int; r record;
begin
  select teams into n from settings where id = 1;
  for t in 0 .. n - 1 loop
    select coalesce(jsonb_agg(jsonb_build_object('pid', wp.pid, 'pick', wp.pick, 'name', fp.name, 'goalie', fp.goalie, 'team', fp.team)), '[]')
      into st from week_points wp join fantasy_players fp on fp.pid = wp.pid
      where wp.week = p_week and wp.team = t and wp.start and owner_of(wp.pid) = t;
    if jsonb_array_length(st) = 0 then
      select coalesce(jsonb_agg(jsonb_build_object('pid', fp.pid, 'pick', 1, 'name', fp.name, 'goalie', fp.goalie, 'team', fp.team)), '[]')
        into st from lineups l cross join unnest(l.starters) s(pid) join fantasy_players fp on fp.pid = s.pid
        where l.team = t and owner_of(s.pid) = t;
    end if;
    if jsonb_array_length(st) = 0 then
      sk := 0; g := 0;
      for r in select fp.* from draft_state d cross join jsonb_array_elements_text(d.picks) v join fantasy_players fp on fp.pid = v::int
               where owner_of(v::int) = t order by (fp.goalie and fp.pid = (select fp2.pid from draft_state d2 cross join jsonb_array_elements_text(d2.picks) v2 join fantasy_players fp2 on fp2.pid = v2::int where owner_of(v2::int) = t and fp2.goalie order by fp2.pts desc limit 1)) desc, fp.pts desc loop
        if (r.goalie and g < 3 and sk + g < 6) or (not r.goalie and sk < 5 and sk + g < 6) then
          st := st || jsonb_build_array(jsonb_build_object('pid', r.pid, 'pick', 1, 'name', r.name, 'goalie', r.goalie, 'team', r.team));
          if r.goalie then g := g + 1; else sk := sk + 1; end if;
        end if;
      end loop;
    end if;
    out := out || jsonb_build_array(jsonb_build_object('team', t, 'starters', st));
  end loop;
  return out;
end $$;

-- Called by the bhl-stats function (service role only) to lock and score a finished week.
-- p_points: [{team, rows:[{pid,g1,g2,g3,g4,pick}]}]   p_results: [{a,b,ta,tb}]
create or replace function finalize_week(p_week int, p_points jsonb, p_results jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare x jsonb; y jsonb; t int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Not allowed.'; end if;
  if exists (select 1 from week_final where week = p_week) then return; end if;
  for x in select value from jsonb_array_elements(p_points) loop
    t := (x ->> 'team')::int;
    delete from week_points where week = p_week and team = t;
    for y in select value from jsonb_array_elements(x -> 'rows') loop
      insert into week_points (week, team, pid, start, g1, g2, g3, g4, pick) values (p_week, t, (y ->> 'pid')::int, true,
        coalesce((y ->> 'g1')::numeric, 0), coalesce((y ->> 'g2')::numeric, 0), coalesce((y ->> 'g3')::numeric, 0), coalesce((y ->> 'g4')::numeric, 0),
        least(4, greatest(1, coalesce((y ->> 'pick')::int, 1))));
    end loop;
    insert into week_locks (week, team) values (p_week, t) on conflict do nothing;
  end loop;
  for x in select value from jsonb_array_elements(p_results) loop
    insert into scores (week, team_a, team_b, a1, a2, b1, b2) values (p_week, (x ->> 'a')::int, (x ->> 'b')::int, (x ->> 'ta')::numeric, 0, (x ->> 'tb')::numeric, 0)
    on conflict (week, team_a, team_b) do update set a1 = excluded.a1, a2 = 0, b1 = excluded.b1, b2 = 0;
  end loop;
  insert into week_final (week) values (p_week);
end $$;
revoke execute on function finalize_week(int, jsonb, jsonb) from public, anon, authenticated;
