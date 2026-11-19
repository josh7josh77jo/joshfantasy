import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
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

type Team = { id: string; name: string; abbr: string; season: string; seasonName: string; order: number; logo: string };
let teamCache: { at: number; teams: Team[]; list: Omit<Team, "logo">[] } | null = null;
const thumbs = new Map<string, Uint8Array>();

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
  // One entry per distinct image, keeping the newest season that used it.
  const seen = new Set<string>();
  const list: Omit<Team, "logo">[] = [];
  for (const t of teams) {
    const key = t.logo.length + ":" + t.logo.slice(-64);
    if (seen.has(key)) continue;
    seen.add(key);
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

// ?team=<id>&size=96 -> any season's logo, optionally shrunk
async function teamLogoResponse(id: string, size: number): Promise<Response> {
  const t = (await loadTeams()).teams.find((x) => x.id === id);
  if (!t) return new Response("Not found", { status: 404, headers: cors });
  const d = decode(t.logo);
  if (!size) return new Response(d.bytes, { headers: imgHeaders(d.type) });
  const key = id + "@" + size;
  let out = thumbs.get(key);
  if (!out) {
    try {
      const img = await Image.decode(d.bytes);
      const k = Math.min(size / img.width, size / img.height, 1);
      img.resize(Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
      out = await img.encode(1);
      thumbs.set(key, out);
    } catch {
      return new Response(d.bytes, { headers: imgHeaders(d.type) });
    }
  }
  return new Response(out, { headers: imgHeaders("image/png") });
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
    if (team) return await teamLogoResponse(team, Math.min(320, Math.max(0, parseInt(params.get("size") || "0") || 0)));
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
