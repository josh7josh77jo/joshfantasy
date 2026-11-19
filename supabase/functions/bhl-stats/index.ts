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
let logoCache: { at: number; map: Record<string, string> } | null = null;

// Serves one team's logo as a cacheable PNG, e.g. ?logo=BOS
async function logoResponse(abbr: string): Promise<Response> {
  if (!logoCache || Date.now() - logoCache.at > 6 * 3600_000) {
    const seasons: Any[] = ((await (await fetch(API + "/seasons")).json()).seasons || []).filter((s: Any) => s.league_id === "BHL");
    const newest = (a: Any, b: Any) => String(b.created_at).localeCompare(String(a.created_at));
    const ids = [...seasons.filter((x) => !x.is_finished).sort(newest), ...seasons.filter((x) => x.is_finished).sort(newest)].map((x) => x.id);
    const teams: Any[] = (await (await fetch(API + "/teams?league_id=BHL")).json()).teams || [];
    const map: Record<string, string> = {};
    for (const id of ids) for (const t of teams) {
      const ab = String(t.abbreviation || t.abbr || "").toUpperCase();
      if (t.season_id === id && ab && !map[ab] && typeof t.logo_url === "string" && t.logo_url.startsWith("data:image/")) map[ab] = t.logo_url;
    }
    logoCache = { at: Date.now(), map };
  }
  const url = logoCache.map[abbr];
  if (!url) return new Response("Not found", { status: 404, headers: cors });
  const [head, b64] = url.split(",", 2);
  const type = /data:([^;]+)/.exec(head)?.[1] || "image/png";
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Response(bytes, { headers: { ...cors, "Content-Type": type, "Cache-Control": "public, max-age=86400" } });
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
