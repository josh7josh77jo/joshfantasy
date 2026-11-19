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
    if (cache && cache.key === want && Date.now() - cache.at < 120_000) {
      return new Response(cache.body, { headers });
    }
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
    const games: Any[] = [];
    for (const b of boxes) {
      const m = /Week\s*(\d+)/i.exec(b.week_label || "");
      const gd = b.gameData;
      if (!m || b.is_playoff_game || !gd || !Array.isArray(gd.teams)) continue;
      games.push({
        w: +m[1],
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
    const body = JSON.stringify({ season: { id: s.id, name: s.name }, updated: new Date().toISOString(), games });
    cache = { at: Date.now(), key: want, body };
    return new Response(body, { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
