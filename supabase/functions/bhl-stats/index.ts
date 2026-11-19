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

// deno-lint-ignore no-explicit-any
type Any = any;
const n = (v: unknown) => (Number.isFinite(+(v as number)) ? +(v as number) : 0);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const headers = { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=60" };
  try {
    const want = new URL(req.url).searchParams.get("season") || "";
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
