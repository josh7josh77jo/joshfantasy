// Relay for public BHL box scores from blockey.net.
// blockey.net does not allow other sites to read its API from the browser,
// so the league site asks this function instead. Read-only, public data.
const API = "https://blockey.net/api";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
let cache: { at: number; key: string; body: string } | null = null;

const HIDE = new Set(["chicago dawgs", "halifax highlanders"]);
// Correct logos for teams whose blockey.net logo is wrong (hosted with the league site).
const CUSTOM = [
  { id: "custom-chi", name: "Chicago Dawgs", abbr: "CHI", url: "https://josh7josh77jo.github.io/joshfantasy/logos/chicago-dawgs.png" },
  { id: "custom-hfx", name: "Halifax Highlanders", abbr: "HFX", url: "https://josh7josh77jo.github.io/joshfantasy/logos/halifax-highlanders.png" },
];
type Team = { id: string; name: string; abbr: string; season: string; seasonName: string; order: number; logo: string };
let teamCache: { at: number; teams: Team[]; list: Omit<Team, "logo">[] } | null = null;

// All BHL teams from every season, newest season first, with their logos.
async function loadTeams() {
  if (teamCache && Date.now() - teamCache.at < 6 * 3600_000) return teamCache;
  const seasons: Any[] = ((await (await fetch(API + "/seasons")).json()).seasons || []).filter((s: Any) => s.league_id === "BHL");
  const newest = (a: Any, b: Any) => String(b.created_at).localeCompare(String(a.created_at));
  const ordered = [...seasons.filter((x) => !x.is_finished).sort(newest), ...seasons.filter((x) => x.is_finished).sort(newest)];
  const rank = new Map(ordered.map((x, i) => [x.id, i]));
  const sname = new Map(ordered.map((x) => [x.id, x.name]));
  const raw: Any[] = (await (await fetch(API + "/teams?league_id=BHL")).json()).teams || [];
  const teams: Team[] = raw
    .filter((t) => typeof t.logo_url === "string" && t.logo_url.startsWith("data:image/"))
    .map((t) => ({
      id: String(t.id), name: String(t.name || ""), abbr: String(t.abbreviation || t.abbr || "").toUpperCase(),
      season: String(t.season_id || ""), seasonName: String(sname.get(t.season_id) || ""), order: rank.get(t.season_id) ?? 999, logo: t.logo_url,
    }))
    .sort((a, b) => a.order - b.order);
  // One entry per team name and per distinct image (newest first). Teams whose logo on blockey.net
  // is known to be wrong are left out of the picker.
  const seen = new Set<string>(), seenImg = new Set<string>();
  const list: Omit<Team, "logo">[] = [];
  for (const t of teams) {
    const key = t.name.trim().toLowerCase();
    const img = t.logo.length + ":" + t.logo.slice(100, 300) + t.logo.slice(-200);
    if (!key || seen.has(key) || seenImg.has(img) || HIDE.has(key)) continue;
    seen.add(key);
    seenImg.add(img);
    const { logo: _l, ...rest } = t;
    list.push(rest);
  }
  teamCache = { at: Date.now(), teams, list };
  return teamCache;
}

const decode = (url: string) => {
  const [head, b64] = url.split(",", 2);
  return { type: /data:([^;]+)/.exec(head)?.[1] || "image/png", bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) };
};
const imgHeaders = (type: string) => ({ ...cors, "Content-Type": type, "Cache-Control": "public, max-age=604800" });

// ?logo=BOS -> current logo for that abbreviation (full size)
async function logoResponse(abbr: string): Promise<Response> {
  const t = (await loadTeams()).teams.find((x) => x.abbr === abbr);
  if (!t) return new Response("Not found", { status: 404, headers: cors });
  const d = decode(t.logo);
  return new Response(d.bytes, { headers: imgHeaders(d.type) });
}

// ?team=<id> -> any season's logo (full size)
async function teamLogoResponse(id: string): Promise<Response> {
  const t = (await loadTeams()).teams.find((x) => x.id === id);
  if (!t) return new Response("Not found", { status: 404, headers: cors });
  const d = decode(t.logo);
  return new Response(d.bytes, { headers: imgHeaders(d.type) });
}

// Saves every distinct BHL logo into the public "bhl-logos" storage folder,
// plus list.json, so the site can load them quickly from the CDN.
const BUCKET = "bhl-logos";
async function buildLogos(force = false): Promise<Response> {
  const base = Deno.env.get("SUPABASE_URL")!, key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const pub = `${base}/storage/v1/object/public/${BUCKET}/list.json`;
  try {
    const old = await fetch(pub + "?t=" + Date.now());
    if (old.ok) {
      const j = await old.json();
      if (Date.now() - Date.parse(j.builtAt) < (force ? 60_000 : 10 * 60_000)) return new Response(JSON.stringify(j), { headers: { ...cors, "Content-Type": "application/json" } });
    }
  } catch { /* rebuild */ }
  const auth = { Authorization: `Bearer ${key}`, apikey: key };
  await fetch(`${base}/storage/v1/bucket`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  }).catch(() => null);
  const put = async (path: string, body: Uint8Array | string, type: string) => {
    const r = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST", headers: { ...auth, "Content-Type": type, "x-upsert": "true", "cache-control": "3600" }, body,
    });
    if (!r.ok) throw new Error(`upload ${path}: ${r.status} ${await r.text()}`);
  };
  const { teams, list } = await loadTeams();
  const ext = (type: string) => (type.split("/")[1] || "png").replace("jpeg", "jpg").replace("svg+xml", "svg");
  const safe = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "_");
  const out: Any[] = [];
  for (const item of list) {
    const t = teams.find((x) => x.id === item.id)!;
    const d = decode(t.logo);
    const file = `t/${safe(t.id)}.${ext(d.type)}`;
    await put(file, d.bytes, d.type);
    out.push({ id: t.id, name: t.name, abbr: t.abbr, seasonName: t.seasonName, file });
  }
  for (const c of CUSTOM) out.push({ id: c.id, name: c.name, abbr: c.abbr, seasonName: "", url: c.url });
  const current: Record<string, string> = {};
  const firstOrder = teams.length ? teams[0].order : 0;
  for (const t of teams) {
    if (t.order !== firstOrder || !t.abbr || current[t.abbr]) continue;
    const d = decode(t.logo);
    const file = `cur/${t.abbr}.${ext(d.type)}`;
    await put(file, d.bytes, d.type);
    current[t.abbr] = file;
  }
  const json = JSON.stringify({ builtAt: new Date().toISOString(), logos: out, current });
  await put("list.json", json, "application/json");
  return new Response(json, { headers: { ...cors, "Content-Type": "application/json" } });
}

// Fantasy weeks follow BHL's regular-season weeks in order, skipping the All-Star break.
// Returns a map from BHL week number to fantasy week number.
const isBreak = (label: string) => /all.?star/i.test(label);
async function weekMap(seasonId: string): Promise<{ map: Map<number, number>; games: Any[] }> {
  const games: Any[] = (await (await fetch(API + "/games?season_id=" + encodeURIComponent(seasonId))).json()).games || [];
  const nums = new Set<number>();
  for (const g of games) {
    const label = String(g.week_label || g.weekLabel || "");
    const m = /Week\s*(\d+)/i.exec(label);
    if (m && !isBreak(label) && !g.is_playoff_game) nums.add(+m[1]);
  }
  const map = new Map<number, number>();
  [...nums].sort((a, b) => a - b).forEach((w, i) => map.set(w, i + 1));
  return { map, games };
}

// The BHL regular-season week in progress, from blockey.net's schedule:
// the highest "Week N" with a game on or before today (Eastern time).
let weekCache: { at: number; week: number; season: string; playoffs: boolean } | null = null;
async function bhlWeek(): Promise<{ week: number; season: string; playoffs: boolean }> {
  if (weekCache && Date.now() - weekCache.at < 10 * 60_000) return weekCache;
  const seasons: Any[] = ((await (await fetch(API + "/seasons")).json()).seasons || []).filter((s: Any) => s.league_id === "BHL");
  const newest = (a: Any, b: Any) => String(b.created_at).localeCompare(String(a.created_at));
  const s = seasons.filter((x) => !x.is_finished).sort(newest)[0] || seasons.sort(newest)[0];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const { map, games } = await weekMap(s.id);
  let week = 0, playoffs = !!s.is_finished;
  for (const g of games) {
    const label = String(g.week_label || g.weekLabel || "");
    if (g.is_playoff_game && String(g.game_date || g.date || "") && String(g.game_date || g.date || "") <= today) playoffs = true;
    const m = /Week\s*(\d+)/i.exec(label);
    const d = String(g.game_date || g.date || "");
    if (m && d && d <= today && !g.is_playoff_game && !isBreak(label)) week = Math.max(week, map.get(+m[1]) || 0);
  }
  weekCache = { at: Date.now(), week, season: s.name, playoffs };
  return weekCache;
}

// Moves the league's current week forward to match BHL. Never goes backward,
// never past Week 8, and does nothing before the commissioner starts Week 1.
async function advanceWeek(): Promise<Response> {
  const base = Deno.env.get("SUPABASE_URL")!, key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" };
  const { week, season, playoffs } = await bhlWeek();
  const r = await fetch(`${base}/rest/v1/settings?id=eq.1&select=league_week`, { headers: auth });
  const cur = +(((await r.json()) || [])[0]?.league_week ?? 0);
  let now = cur;
  if (cur >= 1 && week > cur) {
    now = Math.min(8, week);
    await fetch(`${base}/rest/v1/settings?id=eq.1`, { method: "PATCH", headers: auth, body: JSON.stringify({ league_week: now }) });
  }
  let finished: number[] = [], finishError = "";
  try { finished = await finishWeeks(week, playoffs); } catch (e) { finishError = String(e); }
  return new Response(JSON.stringify({ bhlWeek: week, bhlSeason: season, leagueWeek: now, advanced: now !== cur, finished, finishError }), {
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Box scores for a BHL season, with fantasy week numbers (All-Star break skipped).
async function loadStats(want = ""): Promise<{ s: Any; games: Any[] }> {
  const get = async (p: string) => {
    const r = await fetch(API + p, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`${p} returned ${r.status}`);
    return r.json();
  };
  const seasons: Any[] = ((await get("/seasons")).seasons || []).filter((s: Any) => s.league_id === "BHL");
  const newest = (a: Any, b: Any) => String(b.created_at).localeCompare(String(a.created_at));
  let s = want ? seasons.find((x) => x.id === want || x.name === want) : null;
  if (!s) s = seasons.filter((x) => !x.is_finished).sort(newest)[0] || seasons.sort(newest)[0];
  if (!s) throw new Error("No BHL season found");

  const boxes: Any[] = (await get("/box-scores?season_id=" + encodeURIComponent(s.id))).box_scores || [];
  const { map } = await weekMap(s.id);
  const games: Any[] = [];
  for (const b of boxes) {
    const label = String(b.week_label || "");
    const m = /Week\s*(\d+)/i.exec(label);
    const gd = b.gameData;
    if (!m || isBreak(label) || b.is_playoff_game || !gd || !Array.isArray(gd.teams)) continue;
    const fw = map.get(+m[1]);
    if (!fw) continue;
    games.push({
      w: fw,
      bw: +m[1],
      d: b.game_date || "",
      t: b.game_time || "",
      id: b.id,
      teams: gd.teams.map((t: Any) => ({
        ab: t.abbr,
        gf: (t.periods || []).reduce((x: number, y: unknown) => x + n(y), 0),
        players: (t.players || []).map((p: Any) => ({
          u: p.username || p.name, g: n(p.g), a: n(p.a), sog: n(p.sog), gf: n(p.gf), ga: n(p.ga),
          tou: n(p.tou), toi: n(p.toi), hit: n(p.hit),
        })),
        goalies: (t.goalies || (t.goalie ? [t.goalie] : [])).map((g: Any) => ({
          u: g.username || g.name, sv: n(g.sv), sa: n(g.sa), ga: n(g.ga), toi: n(g.toi),
        })),
      })),
    });
  }
  games.sort((a, b) => (a.d + a.t).localeCompare(b.d + b.t));
  return { s, games };
}

// ---------- Finishing weeks ----------
const r2 = (x: number) => Math.round(x * 100) / 100;
function schedule(n: number): number[][][] {
  const t = [...Array(n).keys()]; if (n % 2) t.push(-1);
  const m = t.length, out: number[][][] = [];
  for (let r = 0; r < 6; r++) {
    const k = r % (m - 1), arr = [t[0], ...t.slice(1).map((_, i) => t[1 + ((i + k) % (m - 1))])], g: number[][] = [];
    for (let i = 0; i < m / 2; i++) { const a = arr[i], b = arr[m - 1 - i]; if (a >= 0 && b >= 0) g.push([a, b]); }
    out.push(g);
  }
  return out;
}
// Same rules as the site: the higher total wins; a tie goes to more points, then the lower team number.
function result(rows: Any[], w: number, a: number, b: number) {
  const r = rows.find((x) => x.week == w && x.team_a == a && x.team_b == b);
  const q = rows.find((x) => x.week == w && x.team_a == b && x.team_b == a);
  const sc = r ? { a: [+r.a1, +r.a2], b: [+r.b1, +r.b2] } : q ? { a: [+q.b1, +q.b2], b: [+q.a1, +q.a2] } : null;
  if (!sc || ![...sc.a, ...sc.b].some((v) => v > 0)) return null;
  const x = Math.max(...sc.a), y = Math.max(...sc.b);
  let win: number;
  if (x != y) win = x > y ? a : b; else { const sx = sc.a[0] + sc.a[1], sy = sc.b[0] + sc.b[1]; win = sx != sy ? (sx > sy ? a : b) : Math.min(a, b); }
  return { win, x, y };
}
function pairsFor(w: number, n: number, rows: Any[]): number[][] {
  if (w <= 6) return schedule(n)[w - 1] || [];
  const t = [...Array(n).keys()].map((i) => ({ i, w: 0, pf: 0 }));
  schedule(n).forEach((g, wi) => g.forEach(([a, b]) => {
    const r = result(rows, wi + 1, a, b); if (!r) return;
    t[a].pf += r.x; t[b].pf += r.y; if (r.win == a) t[a].w++; else t[b].w++;
  }));
  const s = t.sort((p, q) => q.w - p.w || q.pf - p.pf || p.i - q.i).slice(0, 4).map((x) => x.i);
  if (s.length < 4) return [];
  if (w == 7) return [[s[0], s[3]], [s[1], s[2]]];
  const f1 = result(rows, 7, s[0], s[3]), f2 = result(rows, 7, s[1], s[2]);
  return f1 && f2 ? [[f1.win, f2.win]] : [];
}
function playerGames(games: Any[], w: number, p: Any): Any[] {
  const nm = String(p.name).toLowerCase(), key = p.goalie ? "goalies" : "players";
  let team = "";
  for (const g of games) if (g.w == w) for (const t of g.teams) if (t[key].some((l: Any) => String(l.u).toLowerCase() == nm)) team = t.ab;
  team = team || p.team;
  const list: Any[] = [];
  for (const g of games) {
    if (g.w != w) continue;
    const i = g.teams.findIndex((t: Any) => t.ab == team);
    if (i < 0) continue;
    const t = g.teams[i], o = g.teams[1 - i], l = t[key].find((x: Any) => String(x.u).toLowerCase() == nm);
    let pts = 0;
    if (l && !p.goalie) pts = r2(10 * l.g + 6 * l.a + 4 * l.gf - 4 * l.ga + l.sog + 0.1 * l.tou);
    if (l && p.goalie) {
      const main = t.goalies.reduce((m: Any, x: Any) => (x.toi > (m ? m.toi : -1) ? x : m), null), isMain = main && main.u === l.u;
      pts = r2((isMain ? (t.gf > o.gf ? 8 : -6) : 0) + 3 * l.sv - 8 * l.ga + (isMain && o.gf == 0 ? 10 : 0));
    }
    list.push(pts);
  }
  return list.slice(0, 4);
}
async function finishWeeks(bhl: number, playoffsStarted: boolean): Promise<number[]> {
  const base = Deno.env.get("SUPABASE_URL")!, key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" };
  const rest = async (path: string, init?: RequestInit) => {
    const r = await fetch(`${base}/rest/v1/${path}`, { ...init, headers: auth });
    if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
    const txt = await r.text(); return txt ? JSON.parse(txt) : null;
  };
  const set = (await rest("settings?id=eq.1&select=teams,league_week"))[0];
  const n = +set.teams, lw = +set.league_week;
  const done = new Set(((await rest("week_final?select=week")) || []).map((x: Any) => +x.week));
  const todo = [];
  for (let w = 1; w <= Math.min(8, lw); w++) if (!done.has(w) && (bhl > w || playoffsStarted)) todo.push(w);
  if (!todo.length) return [];
  const { games } = await loadStats();
  const finished: number[] = [];
  for (const w of todo) {
    const rows = (await rest("scores?select=*")) || [];
    const lineups: Any[] = await rest("rpc/week_lineups", { method: "POST", body: JSON.stringify({ p_week: w }) });
    const totals: Record<number, number> = {};
    const points = lineups.map((L: Any) => {
      let total = 0;
      const out = (L.starters || []).map((p: Any) => {
        const G = playerGames(games, w, p);
        let pick = +p.pick || 1; if (pick > Math.max(1, G.length)) pick = 1;
        total += G[pick - 1] || 0;
        return { pid: p.pid, g1: G[0] || 0, g2: G[1] || 0, g3: G[2] || 0, g4: G[3] || 0, pick };
      });
      totals[L.team] = r2(total);
      return { team: L.team, rows: out };
    });
    const results = pairsFor(w, n, rows).map(([a, b]) => ({ a, b, ta: totals[a] || 0, tb: totals[b] || 0 }));
    await rest("rpc/finalize_week", { method: "POST", body: JSON.stringify({ p_week: w, p_points: points, p_results: results }) });
    finished.push(w);
  }
  return finished;
}

// deno-lint-ignore no-explicit-any
type Any = any;
const n = (v: unknown) => (Number.isFinite(+(v as number)) ? +(v as number) : 0);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const headers = { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=60" };
  try {
    const params = new URL(req.url).searchParams;
    const want = params.get("season") || "";
    const logo = (params.get("logo") || "").toUpperCase();
    if (logo) return await logoResponse(logo);
    if (params.get("logos") === "list") {
      const { list } = await loadTeams();
      return new Response(JSON.stringify({ logos: list }), { headers: { ...headers, "Cache-Control": "public, max-age=3600" } });
    }
    const team = params.get("team");
    if (team) return await teamLogoResponse(team);
    if (params.get("build") === "1") return await buildLogos(params.get("force") === "1");
    if (params.get("advance") === "1") return await advanceWeek();
    if (cache && cache.key === want && Date.now() - cache.at < 120_000) {
      return new Response(cache.body, { headers });
    }
    const { s, games } = await loadStats(want);
    const body = JSON.stringify({ season: { id: s.id, name: s.name }, updated: new Date().toISOString(), games });
    cache = { at: Date.now(), key: want, body };
    return new Response(body, { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
