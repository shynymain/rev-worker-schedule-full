const JSON_HEADERS = {
  "content-type": "application/json;charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

const TEXT_HEADERS = {
  "content-type": "text/plain;charset=utf-8",
  "access-control-allow-origin": "*"
};

const MODE = "schedule-full-complete-shutuba-plus-odds-fallback-v1";

function j(data, init = {}) {
  return new Response(JSON.stringify(data), { ...init, headers: JSON_HEADERS });
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function normalize(s) {
  return String(s || "")
    .normalize("NFKC")
    .replace(/\r?\n|\t/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlDecode(s) {
  return String(s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(s) {
  return normalize(htmlDecode(String(s || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")));
}

function cleanName(s) {
  return stripTags(s)
    .replace(/[\[\]【】]/g, "")
    .replace(/^[\s\d.・\-]+/, "")
    .replace(/[\s]+$/g, "")
    .trim();
}

function scoreDecoded(text) {
  const s = String(text || "");
  let score = 0;
  score += (s.match(/[ぁ-んァ-ヶー一-龯]/g) || []).length * 4;
  score += (s.match(/HorseList|HorseName|Umaban|Waku|Odds|オッズ|単勝|人気/g) || []).length * 20;
  score -= (s.match(/�/g) || []).length * 100;
  return score;
}

function decodeBuffer(buf) {
  const encs = ["utf-8", "euc-jp", "shift_jis"];
  const candidates = encs.map(enc => {
    try {
      const text = new TextDecoder(enc).decode(buf);
      return { enc, text, score: scoreDecoded(text) };
    } catch (_) {
      return { enc, text: "", score: -999999 };
    }
  });
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

async function fetchDecoded(url, extraHeaders = {}) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Referer": "https://race.netkeiba.com/",
      ...extraHeaders
    },
    cf: { cacheTtl: 60, cacheEverything: false }
  });
  const buf = await res.arrayBuffer();
  const dec = decodeBuffer(buf);
  return { url, status: res.status, ok: res.ok, encoding: dec.enc, score: dec.score, html: dec.text };
}

function findRaceMeta(html, raceId) {
  const text = stripTags(html);
  const y = raceId ? raceId.slice(0, 4) : "";
  const m = raceId ? raceId.slice(4, 6) : "";
  const d = raceId ? raceId.slice(6, 8) : "";
  const raceNo = raceId ? String(Number(raceId.slice(10, 12))) : "";

  const placeMap = { "01":"札幌", "02":"函館", "03":"福島", "04":"新潟", "05":"東京", "06":"中山", "07":"中京", "08":"京都", "09":"阪神", "10":"小倉" };
  const place = raceId ? (placeMap[raceId.slice(8, 10)] || "") : "";

  const raceName =
    stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
      .replace(/出馬表.*$/, "")
      .replace(/オッズ.*$/, "")
      .replace(/\|.*$/, "")
      .replace(/^\d+R\s*/, "") || `${place}${raceNo}R`;

  const surface = /芝/.test(text) ? "芝" : (/ダート|ダ\s*\d{3,4}/.test(text) ? "ダート" : "");
  const distance = (text.match(/(?:芝|ダート|ダ)\s*(\d{3,4})m?/) || [])[1];
  const grade = /G1|Ｇ１|GI/.test(text) ? "G1" : /G2|Ｇ２|GII/.test(text) ? "G2" : /G3|Ｇ３|GIII/.test(text) ? "G3" : /リステッド|Listed|\bL\b/.test(text) ? "L" : /OP|オープン/.test(text) ? "OP" : "";
  const condition = /ハンデ/.test(text) ? "ハンデ" : /別定/.test(text) ? "別定" : /定量/.test(text) ? "定量" : "";
  const age = /4歳以上/.test(text) ? "4歳以上" : /3歳以上/.test(text) ? "3歳以上" : /3歳/.test(text) ? "3歳" : /2歳/.test(text) ? "2歳" : "";

  return {
    date: y && m && d ? `${y}/${m}/${d}` : "",
    place,
    raceNo,
    raceName,
    grade,
    condition,
    age,
    sex: /牝/.test(text) ? "牝馬" : "混合",
    surface,
    distance: distance ? `${distance}m` : "",
    headcount: ""
  };
}

function extractRows(html) {
  const rows = String(html || "").match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  return rows.filter(r => /\/horse\//i.test(r) || /HorseList|HorseName|Umaban|Waku/i.test(r));
}

function pickNo(row) {
  const pats = [
    /class=["'][^"']*Umaban[^"']*["'][^>]*>\s*(?:<[^>]+>\s*)*([1-9]|1[0-8])\s*</i,
    /class=["'][^"']*Horse_Num[^"']*["'][^>]*>\s*(?:<[^>]+>\s*)*([1-9]|1[0-8])\s*</i,
    /data-umaban=["']([1-9]|1[0-8])["']/i,
    /data-horse-num=["']([1-9]|1[0-8])["']/i
  ];
  for (const p of pats) {
    const m = row.match(p);
    if (m) return m[1];
  }
  return "";
}

function pickFrame(row, no) {
  const pats = [
    /class=["'][^"']*Waku[^"']*["'][^>]*>\s*(?:<[^>]+>\s*)*([1-8])\s*</i,
    /class=["'][^"']*Frame[^"']*["'][^>]*>\s*(?:<[^>]+>\s*)*([1-8])\s*</i,
    /class=["'][^"']*Waku(\d)[^"']*["']/i,
    /data-waku=["']([1-8])["']/i
  ];
  for (const p of pats) {
    const m = row.match(p);
    if (m) return m[1];
  }
  return no ? String(Math.ceil(Number(no) / 2)) : "";
}

function pickName(row) {
  const pats = [
    /<span[^>]*class=["'][^"']*HorseName[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    /class=["'][^"']*HorseName[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
    /<a[^>]*href=["'][^"']*\/horse\/\d+[^"']*["'][^>]*>([\s\S]*?)<\/a>/i
  ];
  for (const p of pats) {
    const m = row.match(p);
    if (m) {
      const n = cleanName(m[1]);
      if (n && n.length >= 2) return n;
    }
  }
  return "";
}

function parseHorsesFromShutuba(html) {
  const rows = extractRows(html);
  const horses = [];
  for (const row of rows) {
    const no = pickNo(row);
    const name = pickName(row);
    if (!no || !name) continue;
    if (horses.some(h => h.no === no)) continue;
    horses.push({
      frame: pickFrame(row, no),
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

function validOdds(v) {
  const n = Number(String(v || "").replace(/,/g, ""));
  return Number.isFinite(n) && n >= 1.0 && n <= 999.9 ? n.toFixed(1) : "";
}

function parseOddsFromJsonText(text) {
  const map = {};
  const raw = String(text || "");

  try {
    const obj = JSON.parse(raw);
    const walk = (x) => {
      if (!x || typeof x !== "object") return;
      if (Array.isArray(x)) { x.forEach(walk); return; }
      const keys = Object.keys(x);
      const noKey = keys.find(k => /^(umaban|horse_num|num|no|馬番)$/i.test(k));
      const oddsKey = keys.find(k => /(odds|tan|単勝)/i.test(k));
      if (noKey && oddsKey) {
        const no = String(x[noKey]);
        const odds = validOdds(x[oddsKey]);
        if (/^([1-9]|1[0-8])$/.test(no) && odds) map[no] = odds;
      }
      keys.forEach(k => walk(x[k]));
    };
    walk(obj);
  } catch (_) {}

  return map;
}

function parseOddsFromHtml(html) {
  const map = {};
  const raw = String(html || "");

  // JSON embedded in script often contains odds. Try broad pair patterns.
  const pairPats = [
    /["'](?:umaban|horse_num|num|no)["']\s*:\s*["']?([1-9]|1[0-8])["']?[\s\S]{0,160}?["'](?:odds|tan_odds|win_odds|単勝)["']\s*:\s*["']?([0-9]{1,3}(?:\.[0-9])?)["']?/gi,
    /["'](?:odds|tan_odds|win_odds|単勝)["']\s*:\s*["']?([0-9]{1,3}(?:\.[0-9])?)["']?[\s\S]{0,160}?["'](?:umaban|horse_num|num|no)["']\s*:\s*["']?([1-9]|1[0-8])["']?/gi
  ];
  for (const p of pairPats) {
    let m;
    while ((m = p.exec(raw))) {
      let no, odds;
      if (/odds|tan|win|単勝/i.test(p.source.slice(0, 50))) {
        odds = validOdds(m[1]); no = m[2];
      } else {
        no = m[1]; odds = validOdds(m[2]);
      }
      if (no && odds) map[no] = odds;
    }
  }

  const rows = raw.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const no = pickNo(row);
    if (!no) continue;
    const txt = stripTags(row);
    const candidates = [];
    const classOdds = row.match(/class=["'][^"']*(?:Odds|odds|Popular|popular)[^"']*["'][^>]*>\s*(?:<[^>]+>\s*)*([0-9]{1,3}(?:\.[0-9])?)\s*</i)?.[1];
    if (classOdds) candidates.push(classOdds);
    const dataOdds = row.match(/data-(?:odds|tan_odds|win_odds)=["']([0-9]{1,3}(?:\.[0-9])?)["']/i)?.[1];
    if (dataOdds) candidates.push(dataOdds);
    const nums = txt.match(/\b[0-9]{1,3}\.[0-9]\b/g) || [];
    candidates.push(...nums);
    for (const c of candidates) {
      const odds = validOdds(c);
      if (odds) { map[no] = odds; break; }
    }
  }

  return map;
}

function parseOddsAnywhere(text) {
  return { ...parseOddsFromJsonText(text), ...parseOddsFromHtml(text) };
}

async function getOddsMap(raceId) {
  const urls = [
    `https://race.netkeiba.com/odds/index.html?race_id=${raceId}`,
    `https://race.netkeiba.com/api/api_get_jra_odds.html?race_id=${raceId}&type=1`,
    `https://race.netkeiba.com/api/api_get_jra_odds.html?race_id=${raceId}&type=b1`,
    `https://race.netkeiba.com/api/api_get_jra_odds.html?race_id=${raceId}&type=win`,
    `https://race.netkeiba.com/odds/api_get_jra_odds.html?race_id=${raceId}&type=1`
  ];
  const attempts = [];
  for (const u of urls) {
    try {
      const r = await fetchDecoded(u, { "Accept": "text/html,application/json,*/*" });
      const map = parseOddsAnywhere(r.html);
      attempts.push({ url: u, status: r.status, encoding: r.encoding, count: Object.keys(map).length });
      if (Object.keys(map).length > 0) return { oddsMap: map, usedOddsUrl: u, attempts };
    } catch (e) {
      attempts.push({ url: u, error: String(e.message || e), count: 0 });
    }
  }
  return { oddsMap: {}, usedOddsUrl: "", attempts };
}

function setPopularity(horses) {
  horses.forEach(h => { h.popularity = ""; });
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

async function buildRace(raceId) {
  const shutubaUrl = `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
  const shutuba = await fetchDecoded(shutubaUrl);
  const race = findRaceMeta(shutuba.html, raceId);
  const horses = parseHorsesFromShutuba(shutuba.html);
  const oddsResult = await getOddsMap(raceId);

  horses.forEach(h => { h.odds = oddsResult.oddsMap[h.no] || ""; });
  setPopularity(horses);
  race.headcount = String(horses.length || "");

  return {
    race: {
      id: `${race.date}_${race.place}_${pad2(race.raceNo || 0)}`,
      race,
      horses,
      source: "schedule-full-complete-v1",
      sourceRaceId: raceId,
      sourceUrl: shutubaUrl,
      oddsUrl: oddsResult.usedOddsUrl,
      oddsCount: Object.keys(oddsResult.oddsMap).length
    },
    debug: { shutuba: { status: shutuba.status, encoding: shutuba.encoding, score: shutuba.score, length: shutuba.html.length }, odds: oddsResult }
  };
}

function snippetAround(html, key) {
  const idx = String(html || "").indexOf(key);
  if (idx < 0) return "";
  return String(html).slice(Math.max(0, idx - 800), Math.min(String(html).length, idx + 2500));
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return j({ ok: true });
    const url = new URL(request.url);
    const raceId = url.searchParams.get("raceId") || "202605020101";

    if (url.pathname === "/" || url.pathname === "/api/health") {
      return j({
        ok: true,
        service: "rev-worker-schedule-full",
        mode: MODE,
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
      try {
        const built = await buildRace(raceId);
        return j({
          ok: true,
          raceId,
          count: built.race.horses.length,
          race: built.race,
          horses: built.race.horses,
          oddsCount: built.race.oddsCount,
          warnings: built.race.oddsCount === 0 ? ["オッズは取得できませんでした。出馬表は正常取得。netkeiba側がAPI/HTMLでオッズを返していない可能性があります。"] : []
        });
      } catch (e) {
        return j({ ok: false, raceId, error: String(e.message || e) }, { status: 500 });
      }
    }

    if (url.pathname === "/api/debug-search") {
      const result = await getOddsMap(raceId);
      return j({ ok: true, raceId, oddsCount: Object.keys(result.oddsMap).length, oddsMap: result.oddsMap, usedOddsUrl: result.usedOddsUrl, attempts: result.attempts });
    }

    if (url.pathname === "/api/debug-html" || url.pathname === "/api/raw-html") {
      const type = url.searchParams.get("type") || "shutuba";
      const targetUrl = type === "odds"
        ? `https://race.netkeiba.com/odds/index.html?race_id=${raceId}`
        : `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
      const r = await fetchDecoded(targetUrl);
      const key = url.searchParams.get("key") || "Odds";
      if (url.pathname === "/api/raw-html") {
        return new Response(snippetAround(r.html, key) || r.html.slice(0, 8000), { headers: TEXT_HEADERS });
      }
      return j({
        ok: true,
        raceId,
        type,
        targetUrl,
        status: r.status,
        encoding: r.encoding,
        score: r.score,
        htmlLength: r.html.length,
        oddsMap: parseOddsAnywhere(r.html),
        snippets: {
          Odds: snippetAround(r.html, "Odds"),
          odds: snippetAround(r.html, "odds"),
          Umaban: snippetAround(r.html, "Umaban"),
          HorseName: snippetAround(r.html, "HorseName"),
          api_get: snippetAround(r.html, "api_get")
        }
      });
    }

    return j({ ok: false, error: "not found", path: url.pathname }, { status: 404 });
  }
};
