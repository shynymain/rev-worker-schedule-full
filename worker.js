const VERSION = "schedule-full-safe-odds-not-published-v1";

const jsonHeaders = {
  "content-type": "application/json;charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

const PLACE_MAP = {
  "01": "札幌",
  "02": "函館",
  "03": "福島",
  "04": "新潟",
  "05": "東京",
  "06": "中山",
  "07": "中京",
  "08": "京都",
  "09": "阪神",
  "10": "小倉"
};

function normalize(v) {
  return String(v || "")
    .normalize("NFKC")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(v) {
  return normalize(String(v || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">"));
}

function cleanName(v) {
  return stripTags(v)
    .replace(/[\[\]｜|]/g, "")
    .replace(/^[・\s]+|[・\s]+$/g, "")
    .trim();
}

async function fetchHtml(targetUrl) {
  const res = await fetch(targetUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
      "referer": "https://race.netkeiba.com/",
      "cache-control": "no-cache"
    }
  });

  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let html = "";
  let encoding = "utf-8";

  // netkeiba race pages are usually EUC-JP. Cloudflare Workers supports TextDecoder labels.
  for (const enc of ["euc-jp", "shift_jis", "utf-8"]) {
    try {
      const decoded = new TextDecoder(enc).decode(bytes);
      const score = scoreJapanese(decoded);
      if (!html || score > scoreJapanese(html)) {
        html = decoded;
        encoding = enc;
      }
    } catch (_) {}
  }

  return { ok: res.ok, status: res.status, url: targetUrl, html, encoding, length: html.length };
}

function scoreJapanese(text) {
  const s = String(text || "");
  let score = 0;
  score += (s.match(/[ぁ-んァ-ヶ一-龠]/g) || []).length * 2;
  score -= (s.match(/�/g) || []).length * 20;
  score += s.includes("出馬表") ? 1000 : 0;
  score += s.includes("オッズ") ? 800 : 0;
  score += s.includes("HorseList") ? 500 : 0;
  return score;
}

function parseRaceIdInfo(raceId) {
  const s = String(raceId || "");
  if (!/^\d{12}$/.test(s)) {
    return { date: "", place: "", raceNo: "" };
  }
  const y = s.slice(0, 4);
  const m = s.slice(4, 6);
  const d = s.slice(6, 8);
  const placeCode = s.slice(8, 10);
  const raceNo = String(Number(s.slice(10, 12)));
  return {
    date: `${y}/${m}/${d}`,
    place: PLACE_MAP[placeCode] || "",
    raceNo
  };
}

function pick(html, patterns) {
  for (const p of patterns) {
    const m = String(html || "").match(p);
    if (m && m[1]) return stripTags(m[1]);
  }
  return "";
}

function parseRaceInfo(html, raceId) {
  const base = parseRaceIdInfo(raceId);
  const text = stripTags(html);

  const raceNo = pick(html, [
    /<dt[^>]*class=["'][^"']*Race_Num[^"']*["'][^>]*>\s*(\d+)R/i,
    /(\d{1,2})R\s/i
  ]) || base.raceNo;

  const raceName = pick(html, [
    /<h1[^>]*class=["'][^"']*RaceName[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
    /<div[^>]*class=["'][^"']*RaceName[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  ]) || `${base.place}${raceNo}R`;

  const detail = pick(html, [
    /<div[^>]*class=["'][^"']*RaceData01[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<p[^>]*class=["'][^"']*RaceData01[^"']*["'][^>]*>([\s\S]*?)<\/p>/i
  ]) + " " + pick(html, [
    /<div[^>]*class=["'][^"']*RaceData02[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<p[^>]*class=["'][^"']*RaceData02[^"']*["'][^>]*>([\s\S]*?)<\/p>/i
  ]) + " " + text.slice(0, 3000);

  const surface = /ダート|ダ\s*\d{3,4}/.test(detail) ? "ダート" : (/芝\s*\d{3,4}|芝/.test(detail) ? "芝" : "");
  const distance = (detail.match(/(?:芝|ダート|ダ)\s*(\d{3,4})m?/) || detail.match(/(\d{3,4})m/))?.[1] || "";
  const age = detail.match(/(2歳|3歳|3歳以上|4歳以上)/)?.[1] || "";
  const sex = detail.match(/(牡馬|牝馬|混合|国際)/)?.[1] || "";
  const condition = detail.match(/(ハンデ|別定|定量|馬齢)/)?.[1] || "";
  const grade = raceName.match(/G[123]/i)?.[0]?.toUpperCase() || (raceName.match(/リステッド|L/) ? "L" : "");

  return {
    date: base.date,
    place: base.place,
    raceNo,
    raceName,
    grade,
    condition,
    age,
    sex,
    surface,
    distance: distance ? `${distance}m` : "",
    headcount: ""
  };
}

function parseHorseRows(html) {
  const rows = String(html || "").match(/<tr[^>]*class=["'][^"']*HorseList[^"']*["'][^>]*>[\s\S]*?<\/tr>/gi) || [];
  const horses = [];

  for (const row of rows) {
    const no = pickNumber(row, [
      /<td[^>]*class=["'][^"']*Umaban[^"']*["'][^>]*>\s*(\d{1,2})\s*<\/td>/i,
      /<td[^>]*class=["'][^"']*Horse_Num[^"']*["'][^>]*>\s*(\d{1,2})\s*<\/td>/i
    ], 1, 18);

    if (!no || horses.some(h => h.no === no)) continue;

    const frame = pickNumber(row, [
      /<td[^>]*class=["'][^"']*Waku[^"']*["'][^>]*>\s*(\d)\s*<\/td>/i,
      /class=["'][^"']*Waku(\d)[^"']*["']/i
    ], 1, 8) || String(Math.ceil(Number(no) / 2));

    const name = cleanName(pickRaw(row, [
      /<span[^>]*class=["'][^"']*HorseName[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
      /<td[^>]*class=["'][^"']*HorseInfo[^"']*["'][^>]*>[\s\S]*?<a[^>]*href=["'][^"']*\/horse\/\d+[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
      /<a[^>]*href=["'][^"']*\/horse\/\d+[^"']*["'][^>]*>([\s\S]*?)<\/a>/i
    ]));

    if (!name || name.length < 2) continue;

    horses.push({
      frame,
      no,
      name,
      last1: "",
      last2: "",
      last3: "",
      odds: "",
      popularity: ""
    });
  }

  return horses.sort((a, b) => Number(a.no) - Number(b.no));
}

function pickRaw(text, patterns) {
  for (const p of patterns) {
    const m = String(text || "").match(p);
    if (m && m[1]) return m[1];
  }
  return "";
}

function pickNumber(text, patterns, min, max) {
  const raw = pickRaw(text, patterns);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return "";
  return String(n);
}

function normalizeOdds(v) {
  const s = String(v || "").normalize("NFKC").replace(/[,\s]/g, "");
  const m = s.match(/^(\d{1,3})(?:\.(\d))?$/);
  if (!m) return "";
  const num = Number(m[2] ? `${m[1]}.${m[2]}` : m[1]);
  if (!Number.isFinite(num) || num < 1.0 || num > 999.9) return "";
  return num.toFixed(1);
}

function parseOddsMapFromHtml(html) {
  const map = {};
  const source = String(html || "");

  // Pattern A: explicit data attributes if present.
  const attrRows = source.match(/data-[^=]*(?:horse|umaban|num)[^=]*=["']\d{1,2}["'][\s\S]{0,800}?data-[^=]*odds[^=]*=["'][0-9.]+["']/gi) || [];
  for (const r of attrRows) {
    const no = r.match(/data-[^=]*(?:horse|umaban|num)[^=]*=["'](\d{1,2})["']/i)?.[1];
    const odds = normalizeOdds(r.match(/data-[^=]*odds[^=]*=["']([0-9.]+)["']/i)?.[1]);
    if (no && odds) map[no] = odds;
  }

  // Pattern B: table row containing Umaban and odds-ish class.
  const rows = source.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const no = pickNumber(row, [
      /<td[^>]*class=["'][^"']*Umaban[^"']*["'][^>]*>\s*(\d{1,2})\s*<\/td>/i,
      /<td[^>]*class=["'][^"']*Horse_Num[^"']*["'][^>]*>\s*(\d{1,2})\s*<\/td>/i,
      /(?:umaban|horse_num|num)["']?\s*[:=]\s*["']?(\d{1,2})/i
    ], 1, 18);
    if (!no) continue;

    const oddsRaw = pickRaw(row, [
      /<[^>]*class=["'][^"']*(?:Odds|odds|Popular|Txt_R)[^"']*["'][^>]*>\s*([0-9]{1,3}(?:\.[0-9])?)\s*</i,
      /(?:odds|Odds)["']?\s*[:=]\s*["']?([0-9]{1,3}(?:\.[0-9])?)/i
    ]);
    const odds = normalizeOdds(oddsRaw);
    if (odds) map[no] = odds;
  }

  // Pattern C: JSON fragments like odds: "12.3", umaban: "5".
  const jsonLike = source.match(/(?:umaban|horse_num|num|Umaban)["']?\s*[:=]\s*["']?\d{1,2}["']?[\s\S]{0,300}?(?:odds|Odds)["']?\s*[:=]\s*["']?[0-9]{1,3}(?:\.[0-9])?["']?/gi) || [];
  for (const r of jsonLike) {
    const no = r.match(/(?:umaban|horse_num|num|Umaban)["']?\s*[:=]\s*["']?(\d{1,2})/i)?.[1];
    const odds = normalizeOdds(r.match(/(?:odds|Odds)["']?\s*[:=]\s*["']?([0-9]{1,3}(?:\.[0-9])?)/i)?.[1]);
    if (no && odds) map[no] = odds;
  }

  return map;
}

function applyPopularity(horses) {
  horses.forEach(h => h.popularity = "");

  const valid = horses
    .map(h => ({ h, odds: Number(h.odds) }))
    .filter(x => Number.isFinite(x.odds) && x.odds > 0)
    .sort((a, b) => a.odds - b.odds);

  let rank = 1;
  let prev = null;
  for (let i = 0; i < valid.length; i++) {
    if (prev !== null && valid[i].odds !== prev) rank = i + 1;
    valid[i].h.popularity = String(rank);
    prev = valid[i].odds;
  }
  return horses;
}

function mergeOdds(horses, oddsMap) {
  for (const h of horses) {
    h.odds = oddsMap[h.no] || "";
  }
  return applyPopularity(horses);
}

function buildRaceObject(raceId, race, horses, source, sourceUrl, oddsUrl, oddsMap, status, errors = []) {
  race.headcount = String(horses.length || race.headcount || "");
  const oddsCount = Object.keys(oddsMap || {}).length;
  return {
    id: `${race.date}_${race.place}_${String(race.raceNo || "").padStart(2, "0")}`,
    race,
    horses,
    source,
    sourceRaceId: raceId,
    sourceUrl,
    oddsUrl,
    oddsCount,
    oddsStatus: oddsCount > 0 ? "published" : "not_published",
    status: status || (oddsCount > 0 ? "ok" : "entry_ok_odds_not_published"),
    warnings: oddsCount > 0 ? [] : ["odds_not_published_or_blocked"],
    errors
  };
}

async function getEntryAndOdds(raceId) {
  const shutubaUrl = `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
  const oddsCandidates = [
    `https://race.netkeiba.com/odds/index.html?race_id=${raceId}`,
    `https://race.netkeiba.com/api/api_get_jra_odds.html?race_id=${raceId}&type=1`,
    `https://race.netkeiba.com/api/api_get_jra_odds.html?race_id=${raceId}&type=b1`,
    `https://race.netkeiba.com/api/api_get_jra_odds.html?race_id=${raceId}&type=win`
  ];

  const entryFetch = await fetchHtml(shutubaUrl);
  if (!entryFetch.ok) throw new Error(`entry fetch failed ${entryFetch.status}`);

  const race = parseRaceInfo(entryFetch.html, raceId);
  const horses = parseHorseRows(entryFetch.html);

  const entryOddsMap = parseOddsMapFromHtml(entryFetch.html);
  let bestOddsMap = { ...entryOddsMap };
  let usedOddsUrl = Object.keys(bestOddsMap).length ? shutubaUrl : "";
  const attempts = [];

  for (const candidate of oddsCandidates) {
    try {
      const got = await fetchHtml(candidate);
      const map = parseOddsMapFromHtml(got.html);
      const count = Object.keys(map).length;
      attempts.push({ url: candidate, status: got.status, encoding: got.encoding, count });
      if (count > Object.keys(bestOddsMap).length) {
        bestOddsMap = map;
        usedOddsUrl = candidate;
      }
    } catch (e) {
      attempts.push({ url: candidate, error: String(e.message || e), count: 0 });
    }
  }

  mergeOdds(horses, bestOddsMap);

  return {
    raceObj: buildRaceObject(
      raceId,
      race,
      horses,
      "schedule-full-safe-v1",
      shutubaUrl,
      usedOddsUrl,
      bestOddsMap,
      "",
      attempts.filter(a => a.error)
    ),
    debug: { attempts, entryEncoding: entryFetch.encoding }
  };
}

function responseJson(data, init = {}) {
  return new Response(JSON.stringify(data), { ...init, headers: jsonHeaders });
}

function debugSnippet(html, key = "Odds") {
  const s = String(html || "");
  const idx = s.toLowerCase().indexOf(String(key || "").toLowerCase());
  const start = idx >= 0 ? Math.max(0, idx - 1000) : 0;
  return s.slice(start, Math.min(s.length, start + 5000));
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return responseJson({ ok: true });

    const url = new URL(request.url);
    const raceId = url.searchParams.get("raceId") || "202605020101";

    try {
      if (url.pathname === "/" || url.pathname === "/api/health") {
        return responseJson({
          ok: true,
          service: "rev-worker-schedule-full",
          mode: VERSION,
          safety: "odds_not_published_is_not_error",
          endpoints: [
            "/api/schedule?raceId=202605020101",
            "/api/debug-search?raceId=202605020101",
            "/api/debug-html?raceId=202605020101&type=shutuba",
            "/api/debug-html?raceId=202605020101&type=odds",
            "/api/raw-html?raceId=202605020101&type=odds&key=Odds"
          ]
        });
      }

      if (url.pathname === "/api/schedule") {
        const { raceObj } = await getEntryAndOdds(raceId);
        return responseJson({
          ok: true,
          raceId,
          count: raceObj.horses.length,
          race: raceObj,
          horses: raceObj.horses,
          oddsCount: raceObj.oddsCount,
          oddsStatus: raceObj.oddsStatus,
          status: raceObj.status,
          warnings: raceObj.warnings
        });
      }

      if (url.pathname === "/api/debug-search") {
        const { raceObj, debug } = await getEntryAndOdds(raceId);
        return responseJson({
          ok: true,
          raceId,
          oddsCount: raceObj.oddsCount,
          oddsStatus: raceObj.oddsStatus,
          oddsMap: Object.fromEntries(raceObj.horses.filter(h => h.odds).map(h => [h.no, h.odds])),
          usedOddsUrl: raceObj.oddsUrl,
          attempts: debug.attempts,
          note: raceObj.oddsCount === 0 ? "出馬表は取得済み。オッズは未発表または外部側で非表示のため空で正常扱い。" : "オッズ取得済み。"
        });
      }

      if (url.pathname === "/api/debug-html" || url.pathname === "/api/raw-html") {
        const type = url.searchParams.get("type") || "odds";
        const key = url.searchParams.get("key") || "Odds";
        const target = type === "shutuba"
          ? `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`
          : `https://race.netkeiba.com/odds/index.html?race_id=${raceId}`;
        const got = await fetchHtml(target);
        const map = parseOddsMapFromHtml(got.html);

        if (url.pathname === "/api/raw-html") {
          return new Response(debugSnippet(got.html, key), {
            headers: { ...jsonHeaders, "content-type": "text/plain;charset=utf-8" }
          });
        }

        return responseJson({
          ok: true,
          raceId,
          type,
          targetUrl: target,
          status: got.status,
          encoding: got.encoding,
          htmlLength: got.length,
          oddsMap: map,
          oddsCount: Object.keys(map).length,
          snippets: {
            [key]: debugSnippet(got.html, key)
          }
        });
      }

      return responseJson({ ok: false, error: "not found", path: url.pathname }, { status: 404 });
    } catch (e) {
      return responseJson({ ok: false, error: String(e.message || e), version: VERSION }, { status: 500 });
    }
  }
};
