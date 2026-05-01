const headers = {
  "content-type": "application/json;charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

const PLACES = [
  ["01", "札幌"],
  ["02", "函館"],
  ["03", "福島"],
  ["04", "新潟"],
  ["05", "東京"],
  ["06", "中山"],
  ["07", "中京"],
  ["08", "京都"],
  ["09", "阪神"],
  ["10", "小倉"]
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function nextWeekend() {
  const now = new Date();
  const day = now.getDay();
  const toSat = day === 6 ? 0 : (6 - day + 7) % 7;
  const sat = addDays(now, toSat);
  const sun = addDays(sat, 1);
  return [sat, sun];
}

function ymdCompact(d) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

function ymdSlashFromCompact(s) {
  return `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6, 8)}`;
}

function normalize(v) {
  return String(v || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(v) {
  return normalize(
    String(v || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
  );
}

function cleanName(v) {
  return normalize(stripHtml(v))
    .replace(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFFa-zA-Z0-9ー・ヴァ-ヶ]/g, "")
    .trim();
}

function pickNumber(row, className, min, max) {
  const re = new RegExp(
    `<td[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>\\s*([0-9]+)\\s*<`,
    "i"
  );
  const m = row.match(re);
  if (!m) return "";
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < min || n > max) return "";
  return String(n);
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
      "Referer": "https://race.netkeiba.com/"
    },
    cf: {
      cacheTtl: 180,
      cacheEverything: true
    }
  });

  if (!res.ok) {
    throw new Error(`fetch failed ${res.status} ${url}`);
  }

  const buf = await res.arrayBuffer();

  try {
    return new TextDecoder("shift_jis").decode(buf);
  } catch (_) {
    return new TextDecoder("utf-8").decode(buf);
  }
}

function getRaceName(text, fallback) {
  const patterns = [
    /([^\s　]+ステークス)/,
    /([^\s　]+特別)/,
    /([^\s　]+記念)/,
    /([^\s　]+カップ)/,
    /([^\s　]+賞)/
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return normalize(m[1]);
  }

  return fallback;
}

function getSurface(text) {
  if (/芝/.test(text)) return "芝";
  if (/ダート|ダ/.test(text)) return "ダート";
  return "";
}

function getDistance(text) {
  const m = text.match(/(?:芝|ダート|ダ)\s*(\d{3,4})m?/);
  return m ? `${m[1]}m` : "";
}

function getGrade(text) {
  if (/G1|Ｇ１|GI/.test(text)) return "G1";
  if (/G2|Ｇ２|GII/.test(text)) return "G2";
  if (/G3|Ｇ３|GIII/.test(text)) return "G3";
  if (/リステッド|Listed|L\b/.test(text)) return "L";
  if (/オープン|OP/.test(text)) return "OP";
  if (/3勝/.test(text)) return "3勝";
  if (/2勝/.test(text)) return "2勝";
  if (/1勝/.test(text)) return "1勝";
  if (/未勝利/.test(text)) return "未勝利";
  if (/新馬/.test(text)) return "新馬";
  return "";
}

function getAge(text) {
  if (/4歳以上/.test(text)) return "4歳以上";
  if (/3歳以上/.test(text)) return "3歳以上";
  if (/3歳/.test(text)) return "3歳";
  if (/2歳/.test(text)) return "2歳";
  return "";
}

function getCondition(text) {
  if (/ハンデ/.test(text)) return "ハンデ";
  if (/別定/.test(text)) return "別定";
  if (/定量/.test(text)) return "定量";
  return "";
}

function getSex(text) {
  if (/牝/.test(text)) return "牝馬";
  return "混合";
}

function parseHorsesFromShutuba(html) {
  const rows = String(html || "").match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const horses = [];

  for (const row of rows) {
    const nameMatch =
      row.match(/<a[^>]*href=["'][^"']*\/horse\/\d+\/?[^"']*["'][^>]*>([^<]+)<\/a>/i) ||
      row.match(/HorseName[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i) ||
      row.match(/Horse_Name[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);

    if (!nameMatch) continue;

    const no =
      pickNumber(row, "Umaban", 1, 18) ||
      pickNumber(row, "Horse_Num", 1, 18);

    if (!no) continue;
    if (horses.some(h => h.no === no)) continue;

    const frame =
      pickNumber(row, "Waku", 1, 8) ||
      pickNumber(row, "Frame", 1, 8) ||
      String(Math.ceil(Number(no) / 2));

    const name = cleanName(nameMatch[1]);
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

function parseOddsMapFromOddsPage(html) {
  const map = {};
  const rows = String(html || "").match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const row of rows) {
    const no =
      pickNumber(row, "Umaban", 1, 18) ||
      pickNumber(row, "Horse_Num", 1, 18) ||
      row.match(/(?:umaban|horse_num|horse-number)[^0-9]{0,30}([1-9]|1[0-8])/i)?.[1];

    if (!no) continue;

    const odds =
      row.match(/<td[^>]*class=["'][^"']*(?:Odds|Txt_R|Popular)[^"']*["'][^>]*>\s*([0-9]{1,3}\.[0-9])\s*</i)?.[1] ||
      row.match(/<span[^>]*class=["'][^"']*(?:Odds|Txt_R|Popular)[^"']*["'][^>]*>\s*([0-9]{1,3}\.[0-9])\s*</i)?.[1] ||
      row.match(/data-odds=["']([0-9]{1,3}\.[0-9])["']/i)?.[1] ||
      row.match(/odds[^0-9]{0,60}([0-9]{1,3}\.[0-9])/i)?.[1];

    if (!odds) continue;

    const v = Number(odds);
    if (Number.isFinite(v) && v >= 1.0 && v <= 500) {
      map[String(no)] = v.toFixed(1);
    }
  }

  // JSON風データ埋め込み対策
  const jsonLike = String(html || "").match(/(?:umaban|horse_number|horseNo|no)["']?\s*[:=]\s*["']?([1-9]|1[0-8])["']?[\s\S]{0,250}?(?:odds|winOdds)["']?\s*[:=]\s*["']?([0-9]{1,3}\.[0-9])["']?/gi) || [];
  for (const part of jsonLike) {
    const no = part.match(/(?:umaban|horse_number|horseNo|no)["']?\s*[:=]\s*["']?([1-9]|1[0-8])["']?/i)?.[1];
    const odds = part.match(/(?:odds|winOdds)["']?\s*[:=]\s*["']?([0-9]{1,3}\.[0-9])["']?/i)?.[1];
    if (no && odds) {
      const v = Number(odds);
      if (Number.isFinite(v) && v >= 1.0 && v <= 500) map[String(no)] = v.toFixed(1);
    }
  }

  return map;
}

function setPopularityPerfect(horses) {
  horses.forEach(h => {
    h.popularity = "";
  });

  const valid = horses
    .map(h => ({ h, odds: Number(h.odds) }))
    .filter(x => Number.isFinite(x.odds) && x.odds > 0)
    .sort((a, b) => a.odds - b.odds);

  let rank = 1;
  let prevOdds = null;

  valid.forEach((x, index) => {
    if (prevOdds !== null && x.odds !== prevOdds) {
      rank = index + 1;
    }
    x.h.popularity = String(rank);
    prevOdds = x.odds;
  });

  return horses;
}

function buildRaceUrls(raceId) {
  return {
    shutubaUrl: `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`,
    oddsUrls: [
      `https://race.netkeiba.com/odds/index.html?race_id=${raceId}`,
      `https://race.netkeiba.com/odds/index.html?type=b1&race_id=${raceId}`,
      `https://race.netkeiba.com/odds/index.html?type=1&race_id=${raceId}`
    ]
  };
}

async function parseRaceByRaceId(raceId) {
  const { shutubaUrl, oddsUrls } = buildRaceUrls(raceId);
  const shutubaHtml = await fetchHtml(shutubaUrl);
  const shutubaText = stripHtml(shutubaHtml);
  const horses = parseHorsesFromShutuba(shutubaHtml);

  let oddsMap = {};
  let usedOddsUrl = "";

  for (const oddsUrl of oddsUrls) {
    try {
      const oddsHtml = await fetchHtml(oddsUrl);
      const candidate = parseOddsMapFromOddsPage(oddsHtml);
      if (Object.keys(candidate).length > Object.keys(oddsMap).length) {
        oddsMap = candidate;
        usedOddsUrl = oddsUrl;
      }
      if (Object.keys(oddsMap).length >= Math.max(1, Math.floor(horses.length * 0.6))) break;
    } catch (_) {}
  }

  horses.forEach(h => {
    h.odds = oddsMap[h.no] || "";
  });

  setPopularityPerfect(horses);

  const date = raceId.slice(0, 8);
  const placeCode = raceId.slice(8, 10);
  const raceNo = Number(raceId.slice(10, 12));
  const place = (PLACES.find(p => p[0] === placeCode) || ["", ""])[1];

  return {
    id: `${ymdSlashFromCompact(date)}_${place}_${pad2(raceNo)}`,
    race: {
      date: ymdSlashFromCompact(date),
      place,
      raceNo: String(raceNo),
      raceName: getRaceName(shutubaText, `${place}${raceNo}R`),
      grade: getGrade(shutubaText),
      condition: getCondition(shutubaText),
      age: getAge(shutubaText),
      sex: getSex(shutubaText),
      surface: getSurface(shutubaText),
      distance: getDistance(shutubaText),
      headcount: String(horses.length)
    },
    horses,
    source: "netkeiba-shutuba-plus-odds",
    sourceRaceId: raceId,
    sourceUrl: shutubaUrl,
    oddsUrl: usedOddsUrl,
    oddsCount: Object.keys(oddsMap).length
  };
}

function makeRaceIdsForDate(dateObj) {
  const date = ymdCompact(dateObj);
  const ids = [];

  for (const [code] of PLACES) {
    for (let r = 1; r <= 12; r++) {
      ids.push(`${date}${code}${pad2(r)}`);
    }
  }

  return ids;
}

async function getSchedule() {
  const [sat, sun] = nextWeekend();
  const raceIds = [...makeRaceIdsForDate(sat), ...makeRaceIdsForDate(sun)];
  const races = [];

  for (const raceId of raceIds) {
    try {
      const r = await parseRaceByRaceId(raceId);
      if (r.horses && r.horses.length >= 8) races.push(r);
    } catch (_) {}
  }

  return races;
}

function pickDebugSnippets(html) {
  const text = String(html || "");
  const keys = ["Odds", "odds", "Popular", "Umaban", "Horse_Num", "HorseName", "data-odds", "/horse/"];
  const snippets = {};

  for (const key of keys) {
    const idx = text.indexOf(key);
    snippets[key] = idx >= 0
      ? text.slice(Math.max(0, idx - 500), Math.min(text.length, idx + 1600))
      : "";
  }

  const rows = text.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const sampleRows = rows.slice(0, 5).map(r => r.slice(0, 2500));
  return { snippets, sampleRows };
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    const url = new URL(request.url);
    const raceId = url.searchParams.get("raceId") || "202605020101";

    if (url.pathname === "/" || url.pathname === "/api/health") {
      return new Response(JSON.stringify({
        ok: true,
        service: "rev-worker-schedule-full",
        mode: "schedule-full-shutuba-plus-odds-github-final",
        endpoints: [
          "/api/schedule",
          "/api/schedule?raceId=202605020101",
          "/api/debug-html?raceId=202605020101&type=shutuba",
          "/api/debug-html?raceId=202605020101&type=odds"
        ]
      }), { headers });
    }

    if (url.pathname === "/api/debug-html") {
      const type = url.searchParams.get("type") || "odds";
      const { shutubaUrl, oddsUrls } = buildRaceUrls(raceId);
      const targetUrl = type === "shutuba" ? shutubaUrl : oddsUrls[0];
      const html = await fetchHtml(targetUrl);
      const debug = pickDebugSnippets(html);

      return new Response(JSON.stringify({
        ok: true,
        raceId,
        type,
        targetUrl,
        htmlLength: html.length,
        hasOddsText: /Odds|odds|Popular|data-odds/i.test(html),
        oddsMap: parseOddsMapFromOddsPage(html),
        debug
      }), { headers });
    }

    if (url.pathname === "/api/schedule") {
      if (url.searchParams.get("raceId")) {
        const race = await parseRaceByRaceId(raceId);
        return new Response(JSON.stringify({
          ok: true,
          raceId,
          count: race.horses.length,
          race,
          horses: race.horses,
          oddsCount: race.oddsCount,
          oddsUrl: race.oddsUrl
        }), { headers });
      }

      const races = await getSchedule();
      return new Response(JSON.stringify({
        ok: true,
        count: races.length,
        generatedAt: new Date().toISOString(),
        source: "netkeiba-shutuba-plus-odds",
        races
      }), { headers });
    }

    return new Response(JSON.stringify({
      ok: false,
      error: "not found",
      path: url.pathname
    }), { status: 404, headers });
  }
};
