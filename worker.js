const JSON_HEADERS = {
  "content-type": "application/json;charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

const SERVICE = "rev-worker-schedule-full";
const MODE = "schedule-full-eucjp-plus-odds-api-debug-v2";

function okJson(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function normalize(v) {
  return String(v || "").normalize("NFKC").replace(/\s+/g, " ").trim();
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

function scoreDecodedText(s) {
  const text = String(s || "");
  const jp = (text.match(/[ぁ-んァ-ン一-龯]/g) || []).length;
  const bad = (text.match(/[�]/g) || []).length;
  const mojibake = (text.match(/[縺蜊譁莨逕繧]/g) || []).length;
  const common = (text.match(/(馬|枠|人気|オッズ|単勝|レース|札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉|HorseName|Umaban|Odds)/g) || []).length;
  return jp + common * 20 - bad * 100 - mojibake * 10;
}

function decodeBest(buffer) {
  const labels = ["euc-jp", "shift_jis", "utf-8"];
  const candidates = [];
  for (const label of labels) {
    try {
      const text = new TextDecoder(label).decode(buffer);
      candidates.push({ label, text, score: scoreDecodedText(text) });
    } catch (_) {}
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || { label: "utf-8", text: new TextDecoder().decode(buffer), score: 0 };
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
      "accept-language": "ja-JP,ja;q=0.9,en;q=0.7",
      "referer": "https://race.netkeiba.com/"
    },
    cf: { cacheTtl: 120, cacheEverything: true }
  });
  const buf = await res.arrayBuffer();
  const decoded = decodeBest(buf);
  return { status: res.status, ok: res.ok, url, html: decoded.text, encoding: decoded.label, score: decoded.score };
}

function pickCellNumber(row, names, min, max) {
  for (const name of names) {
    const re = new RegExp(`<td[^>]*class=["'][^"']*${name}[^"']*["'][^>]*>\\s*([0-9]+)\\s*<`, "i");
    const m = row.match(re);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= min && n <= max) return String(n);
    }
  }
  return "";
}

function cleanHorseName(v) {
  return stripTags(v)
    .replace(/[\[\]【】]/g, "")
    .replace(/^[・\s]+|[・\s]+$/g, "")
    .trim();
}

function parseHorses(shutubaHtml) {
  const rows = String(shutubaHtml || "").match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const horses = [];

  for (const row of rows) {
    if (!/\/horse\/\d+/.test(row) && !/HorseName|Horse_Name|UmaName/i.test(row)) continue;

    const no = pickCellNumber(row, ["Umaban", "Horse_Num", "HorseNumber"], 1, 18);
    if (!no || horses.some(h => h.no === no)) continue;

    const frame = pickCellNumber(row, ["Waku", "Frame"], 1, 8) || String(Math.ceil(Number(no) / 2));

    const nameMatch =
      row.match(/<span[^>]*class=["'][^"']*(?:HorseName|Horse_Name|UmaName)[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/span>/i) ||
      row.match(/<a[^>]*href=["'][^"']*\/horse\/\d+\/?[^"']*["'][^>]*>([\s\S]*?)<\/a>/i) ||
      row.match(/<span[^>]*class=["'][^"']*(?:HorseName|Horse_Name|UmaName)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);

    const name = cleanHorseName(nameMatch ? nameMatch[1] : "");
    if (!name || name.length < 2) continue;

    horses.push({ frame, no, name, last1: "", last2: "", last3: "", odds: "", popularity: "" });
  }

  return horses.sort((a, b) => Number(a.no) - Number(b.no));
}

function parseOddsFromHtml(html) {
  const map = {};
  const src = String(html || "");
  const rows = src.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const row of rows) {
    const no = pickCellNumber(row, ["Umaban", "Horse_Num", "HorseNumber"], 1, 18) ||
      row.match(/data-(?:horse-num|umaban|no)=["']([1-9]|1[0-8])["']/i)?.[1];
    if (!no) continue;

    const odds =
      row.match(/class=["'][^"']*(?:Odds|Ozz|Txt_R|Popular)[^"']*["'][^>]*>\s*([0-9]{1,3}\.[0-9])\s*</i)?.[1] ||
      row.match(/data-odds=["']([0-9]{1,3}\.[0-9])["']/i)?.[1] ||
      row.match(/(?:odds|tan|win)[^0-9]{0,30}([0-9]{1,3}\.[0-9])/i)?.[1];

    const v = Number(odds);
    if (Number.isFinite(v) && v >= 1.0 && v <= 500) map[no] = v.toFixed(1);
  }

  // netkeiba odds pages can include JavaScript arrays. Keep these generic.
  const jsonLike = src.match(/\{[^{}]*(?:umaban|horse_num|horseNum|no|馬番)[^{}]*(?:odds|tan|win|単勝)[^{}]*\}/gi) || [];
  for (const item of jsonLike) {
    const no = item.match(/(?:umaban|horse_num|horseNum|no|馬番)["']?\s*[:=]\s*["']?([1-9]|1[0-8])/i)?.[1];
    const odds = item.match(/(?:odds|tan|win|単勝)["']?\s*[:=]\s*["']?([0-9]{1,3}\.[0-9])/i)?.[1];
    const v = Number(odds);
    if (no && Number.isFinite(v) && v >= 1.0 && v <= 500) map[no] = v.toFixed(1);
  }

  return map;
}

function parseOddsFromApiText(text) {
  const map = {};
  const raw = String(text || "");

  try {
    const data = JSON.parse(raw);
    const walk = (x) => {
      if (!x || typeof x !== "object") return;
      if (Array.isArray(x)) return x.forEach(walk);
      const no = x.umaban ?? x.horse_num ?? x.horseNum ?? x.no ?? x.num;
      const odds = x.odds ?? x.tan ?? x.win ?? x.o;
      const n = Number(no);
      const v = Number(odds);
      if (Number.isFinite(n) && n >= 1 && n <= 18 && Number.isFinite(v) && v >= 1.0 && v <= 500) {
        map[String(n)] = v.toFixed(1);
      }
      Object.values(x).forEach(walk);
    };
    walk(data);
  } catch (_) {}

  const pairs = raw.match(/(?:^|[,\[{])[^\n]{0,80}?(?:umaban|horse_num|horseNum|no|num)["']?\s*[:=]\s*["']?([1-9]|1[0-8])[^\n]{0,120}?(?:odds|tan|win|o)["']?\s*[:=]\s*["']?([0-9]{1,3}\.[0-9])/gi) || [];
  for (const p of pairs) {
    const no = p.match(/(?:umaban|horse_num|horseNum|no|num)["']?\s*[:=]\s*["']?([1-9]|1[0-8])/i)?.[1];
    const odds = p.match(/(?:odds|tan|win|o)["']?\s*[:=]\s*["']?([0-9]{1,3}\.[0-9])/i)?.[1];
    const v = Number(odds);
    if (no && Number.isFinite(v) && v >= 1.0 && v <= 500) map[no] = v.toFixed(1);
  }

  return map;
}

async function fetchOddsMap(raceId) {
  const urls = [
    `https://race.netkeiba.com/odds/index.html?race_id=${raceId}`,
    `https://race.netkeiba.com/api/api_get_jra_odds.html?race_id=${raceId}&type=1`,
    `https://race.netkeiba.com/api/api_get_jra_odds.html?race_id=${raceId}&type=b1`,
    `https://race.netkeiba.com/api/api_get_jra_odds.html?race_id=${raceId}&type=win`,
    `https://race.netkeiba.com/api/api_get_odds.html?race_id=${raceId}&type=1`,
    `https://race.netkeiba.com/odds/api_get_jra_odds.html?race_id=${raceId}&type=1`
  ];

  const attempts = [];
  for (const u of urls) {
    try {
      const r = await fetchText(u);
      const map = u.includes("api") ? parseOddsFromApiText(r.html) : parseOddsFromHtml(r.html);
      attempts.push({ url: u, status: r.status, encoding: r.encoding, count: Object.keys(map).length });
      if (Object.keys(map).length > 0) return { map, attempts, url: u };
    } catch (e) {
      attempts.push({ url: u, error: String(e.message || e), count: 0 });
    }
  }
  return { map: {}, attempts, url: "" };
}

function setPopularity(horses) {
  horses.forEach(h => h.popularity = "");
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

function raceMeta(raceId) {
  const y = raceId.slice(0, 4), m = raceId.slice(4, 6), d = raceId.slice(6, 8);
  const placeCode = raceId.slice(8, 10);
  const raceNo = String(Number(raceId.slice(10, 12)) || "");
  const placeMap = { "01":"札幌", "02":"函館", "03":"福島", "04":"新潟", "05":"東京", "06":"中山", "07":"中京", "08":"京都", "09":"阪神", "10":"小倉" };
  return { date: `${y}/${m}/${d}`, place: placeMap[placeCode] || "", raceNo };
}

function pickDebugSnippets(html) {
  const text = String(html || "");
  const keys = ["api_get", "Odds", "odds", "Umaban", "HorseName", "data-odds", "払戻", "単勝", "人気"];
  const snippets = {};
  for (const key of keys) {
    const idx = text.indexOf(key);
    snippets[key] = idx >= 0 ? text.slice(Math.max(0, idx - 800), Math.min(text.length, idx + 1800)) : "";
  }
  return snippets;
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return okJson({ ok: true });
    const url = new URL(request.url);
    const raceId = url.searchParams.get("raceId") || "202605020101";

    if (url.pathname === "/api/health") {
      return okJson({
        ok: true,
        service: SERVICE,
        mode: MODE,
        endpoints: [
          "/api/schedule?raceId=202605020101",
          "/api/debug-html?raceId=202605020101&type=shutuba",
          "/api/debug-html?raceId=202605020101&type=odds",
          "/api/debug-search?raceId=202605020101"
        ]
      });
    }

    if (url.pathname === "/api/debug-html") {
      const type = url.searchParams.get("type") || "shutuba";
      const target = type === "odds"
        ? `https://race.netkeiba.com/odds/index.html?race_id=${raceId}`
        : `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
      const r = await fetchText(target);
      return okJson({
        ok: true,
        raceId,
        type,
        targetUrl: target,
        status: r.status,
        encoding: r.encoding,
        score: r.score,
        htmlLength: r.html.length,
        snippets: pickDebugSnippets(r.html),
        sample: r.html.slice(0, 2500)
      });
    }

    if (url.pathname === "/api/debug-search") {
      const result = await fetchOddsMap(raceId);
      return okJson({ ok: true, raceId, oddsCount: Object.keys(result.map).length, oddsMap: result.map, usedOddsUrl: result.url, attempts: result.attempts });
    }

    if (url.pathname !== "/api/schedule") {
      return okJson({ ok: false, error: "not found", path: url.pathname }, 404);
    }

    const shutubaUrl = `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
    const shutuba = await fetchText(shutubaUrl);
    const horses = parseHorses(shutuba.html);
    const oddsResult = await fetchOddsMap(raceId);

    horses.forEach(h => { h.odds = oddsResult.map[h.no] || ""; });
    setPopularity(horses);

    const meta = raceMeta(raceId);
    const race = {
      id: `${meta.date}_${meta.place}_${String(meta.raceNo).padStart(2, "0")}`,
      race: {
        date: meta.date,
        place: meta.place,
        raceNo: meta.raceNo,
        raceName: `${meta.place}${meta.raceNo}R`,
        grade: "",
        condition: "",
        age: "",
        sex: "",
        surface: "",
        distance: "",
        headcount: String(horses.length)
      },
      horses,
      source: MODE,
      sourceRaceId: raceId,
      sourceUrl: shutubaUrl,
      oddsUrl: oddsResult.url,
      oddsCount: Object.keys(oddsResult.map).length
    };

    return okJson({ ok: true, raceId, count: horses.length, race, horses, oddsCount: Object.keys(oddsResult.map).length, oddsAttempts: oddsResult.attempts });
  }
};
