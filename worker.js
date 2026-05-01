const headers = {
  "content-type": "application/json;charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
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

async function fetchHtml(targetUrl) {
  const res = await fetch(targetUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "ja-JP,ja;q=0.9,en;q=0.8",
      "referer": "https://race.netkeiba.com/"
    },
    cf: { cacheTtl: 60, cacheEverything: true }
  });

  const buf = await res.arrayBuffer();
  let html = "";
  try { html = new TextDecoder("shift_jis").decode(buf); }
  catch (_) { html = new TextDecoder("utf-8").decode(buf); }

  return { ok: res.ok, status: res.status, url: targetUrl, html };
}

function cleanName(v) {
  return normalize(stripHtml(v))
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[<>]/g, "")
    .trim();
}

function pickNumber(row, names, min, max) {
  for (const name of names) {
    const patterns = [
      new RegExp(`<td[^>]*class=["'][^"']*${name}[^"']*["'][^>]*>\\s*([0-9]+)\\s*<`, "i"),
      new RegExp(`${name}[^>]*>\\s*([0-9]+)\\s*<`, "i")
    ];
    for (const p of patterns) {
      const m = row.match(p);
      if (!m || !m[1]) continue;
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= min && n <= max) return String(n);
    }
  }
  return "";
}

function parseHorsesFromShutuba(html) {
  const rows = String(html || "").match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const horses = [];

  for (const row of rows) {
    if (!/\/horse\/\d+/.test(row)) continue;

    const nameMatch =
      row.match(/<a[^>]*href=["'][^"']*\/horse\/\d+\/?[^"']*["'][^>]*>([\s\S]*?)<\/a>/i) ||
      row.match(/HorseName[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
      row.match(/Horse_Name[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);

    const no = pickNumber(row, ["Umaban", "Horse_Num", "HorseNum"], 1, 18);
    if (!nameMatch || !no) continue;
    if (horses.some(h => h.no === no)) continue;

    const frame = pickNumber(row, ["Waku", "Frame"], 1, 8) || String(Math.ceil(Number(no) / 2));
    const name = cleanName(nameMatch[1]);
    if (!name || name.length < 1) continue;

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
  const body = String(html || "");

  // pattern A: horse number and odds in same row
  const rows = body.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const no = pickNumber(row, ["Umaban", "Horse_Num", "HorseNum", "Name"], 1, 18);
    const oddsMatch =
      row.match(/<td[^>]*class=["'][^"']*(?:Odds|Txt_R|Popular)[^"']*["'][^>]*>\s*([0-9]{1,3}(?:\.[0-9])?)\s*</i) ||
      row.match(/<span[^>]*class=["'][^"']*(?:Odds|Txt_R|Popular)[^"']*["'][^>]*>\s*([0-9]{1,3}(?:\.[0-9])?)\s*</i) ||
      row.match(/data-odds=["']([0-9]{1,3}(?:\.[0-9])?)["']/i);

    if (no && oddsMatch && oddsMatch[1]) {
      const v = Number(oddsMatch[1]);
      if (Number.isFinite(v) && v >= 1.0 && v <= 500) map[no] = v.toFixed(1);
    }
  }

  // pattern B: javascript/json-like odds data
  const pairPatterns = [
    /["'](?:umaban|horse_number|num|no)["']\s*:\s*["']?([1-9]|1[0-8])["']?[\s\S]{0,120}?["'](?:odds|tan_odds|win_odds)["']\s*:\s*["']?([0-9]{1,3}(?:\.[0-9])?)["']?/gi,
    /["'](?:odds|tan_odds|win_odds)["']\s*:\s*["']?([0-9]{1,3}(?:\.[0-9])?)["']?[\s\S]{0,120}?["'](?:umaban|horse_number|num|no)["']\s*:\s*["']?([1-9]|1[0-8])["']?/gi
  ];

  for (const p of pairPatterns) {
    let m;
    while ((m = p.exec(body))) {
      let no, odds;
      if (/odds|tan_odds|win_odds/i.test(p.source.slice(0, 30))) {
        odds = m[1]; no = m[2];
      } else {
        no = m[1]; odds = m[2];
      }
      const v = Number(odds);
      if (no && Number.isFinite(v) && v >= 1.0 && v <= 500) map[String(Number(no))] = v.toFixed(1);
    }
  }

  // pattern C: netkeiba sometimes exposes odds blocks with id including horse number
  const idBlocks = body.match(/<[^>]*(?:id|data-horse-num|data-umaban)=["'][^"']*(?:[1-9]|1[0-8])[^"']*["'][^>]*>[\s\S]{0,800}?/gi) || [];
  for (const block of idBlocks) {
    const no =
      block.match(/data-horse-num=["']([1-9]|1[0-8])["']/i)?.[1] ||
      block.match(/data-umaban=["']([1-9]|1[0-8])["']/i)?.[1] ||
      block.match(/(?:id|class)=["'][^"']*(?:umaban|horse|odds)[^"']*([1-9]|1[0-8])[^"']*["']/i)?.[1];
    const odds = block.match(/([0-9]{1,3}\.[0-9])/i)?.[1];
    if (no && odds) {
      const v = Number(odds);
      if (Number.isFinite(v) && v >= 1.0 && v <= 500) map[String(Number(no))] = v.toFixed(1);
    }
  }

  return map;
}

function applyOddsAndPopularity(horses, oddsMap) {
  for (const h of horses) {
    h.odds = oddsMap[h.no] || "";
    h.popularity = "";
  }

  const valid = horses
    .map(h => ({ h, odds: Number(h.odds) }))
    .filter(x => Number.isFinite(x.odds) && x.odds > 0)
    .sort((a, b) => a.odds - b.odds);

  let rank = 1;
  let prev = null;
  valid.forEach((x, i) => {
    if (prev !== null && x.odds !== prev) rank = i + 1;
    x.h.popularity = String(rank);
    prev = x.odds;
  });

  return horses;
}

function parseRaceBasic(raceId, shutubaHtml, horses) {
  const date = `${raceId.slice(0, 4)}/${raceId.slice(4, 6)}/${raceId.slice(6, 8)}`;
  const placeCode = raceId.slice(8, 10);
  const raceNo = String(Number(raceId.slice(10, 12)));
  const placeMap = {"01":"札幌","02":"函館","03":"福島","04":"新潟","05":"東京","06":"中山","07":"中京","08":"京都","09":"阪神","10":"小倉"};
  const place = placeMap[placeCode] || "";
  const text = stripHtml(shutubaHtml);

  const raceName =
    text.match(/([ァ-ヶー一-龯A-Za-z0-9・]+(?:ステークス|特別|記念|カップ|賞))/)?.[1] ||
    `${place}${raceNo}R`;

  const surface = /芝/.test(text) ? "芝" : (/ダート|ダ/.test(text) ? "ダート" : "");
  const distance = text.match(/(?:芝|ダート|ダ)\s*(\d{3,4})m?/)?.[1] || "";

  return {
    id: `${date}_${place}_${String(raceNo).padStart(2, "0")}`,
    race: {
      date,
      place,
      raceNo,
      raceName,
      grade: /G1|Ｇ１|GI/.test(text) ? "G1" : /G2|Ｇ２|GII/.test(text) ? "G2" : /G3|Ｇ３|GIII/.test(text) ? "G3" : /リステッド|Listed|L\b/.test(text) ? "L" : /オープン|OP/.test(text) ? "OP" : "",
      condition: /ハンデ/.test(text) ? "ハンデ" : /別定/.test(text) ? "別定" : /定量/.test(text) ? "定量" : "",
      age: /4歳以上/.test(text) ? "4歳以上" : /3歳以上/.test(text) ? "3歳以上" : /3歳/.test(text) ? "3歳" : /2歳/.test(text) ? "2歳" : "",
      sex: /牝/.test(text) ? "牝馬" : "混合",
      surface,
      distance: distance ? `${distance}m` : "",
      headcount: String(horses.length)
    },
    horses,
    source: "netkeiba-shutuba-plus-odds-deploy-stable",
    sourceRaceId: raceId
  };
}

async function buildRace(raceId) {
  const shutubaUrl = `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
  const oddsUrl = `https://race.netkeiba.com/odds/index.html?race_id=${raceId}`;

  const [shutuba, odds] = await Promise.all([fetchHtml(shutubaUrl), fetchHtml(oddsUrl)]);
  const horses = parseHorsesFromShutuba(shutuba.html);
  const oddsMap = parseOddsMapFromOddsPage(odds.html);
  const merged = applyOddsAndPopularity(horses, oddsMap);
  const race = parseRaceBasic(raceId, shutuba.html, merged);

  return {
    ...race,
    sourceUrl: shutubaUrl,
    oddsUrl,
    oddsCount: Object.keys(oddsMap).length
  };
}

function debugHtml(html) {
  const keys = ["Odds", "odds", "Popular", "Umaban", "Horse_Num", "HorseName", "data-odds", "data-horse-num", "/horse/"];
  const snippets = {};
  for (const k of keys) {
    const idx = html.indexOf(k);
    snippets[k] = idx >= 0 ? html.slice(Math.max(0, idx - 600), Math.min(html.length, idx + 1800)) : "";
  }
  return snippets;
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return json({ ok: true });

    const url = new URL(request.url);
    const raceId = url.searchParams.get("raceId") || "202605020101";

    if (url.pathname === "/" || url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "rev-worker-schedule-full",
        mode: "schedule-full-shutuba-plus-odds-deploy-stable",
        endpoints: [
          "/api/schedule?raceId=202605020101",
          "/api/debug-html?raceId=202605020101&type=shutuba",
          "/api/debug-html?raceId=202605020101&type=odds"
        ]
      });
    }

    if (url.pathname === "/api/debug-html") {
      const type = url.searchParams.get("type") || "odds";
      const targetUrl = type === "shutuba"
        ? `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`
        : `https://race.netkeiba.com/odds/index.html?race_id=${raceId}`;
      const fetched = await fetchHtml(targetUrl);
      return json({
        ok: true,
        raceId,
        type,
        targetUrl,
        status: fetched.status,
        htmlLength: fetched.html.length,
        hasOddsText: /Odds|odds|Popular|data-odds/i.test(fetched.html),
        snippets: debugHtml(fetched.html)
      });
    }

    if (url.pathname === "/api/schedule") {
      try {
        const race = await buildRace(raceId);
        return json({
          ok: true,
          raceId,
          count: race.horses.length,
          race,
          horses: race.horses,
          oddsCount: race.oddsCount,
          oddsUrl: race.oddsUrl
        });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message ? e.message : e), raceId }, 500);
      }
    }

    return json({ ok: false, error: "not found", path: url.pathname }, 404);
  }
};
