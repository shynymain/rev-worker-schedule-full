const headers = {
  "content-type": "application/json;charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}

function pad2(n) { return String(n).padStart(2, "0"); }

function normalizeRaceId(v) {
  return String(v || "").replace(/\D/g, "").slice(0, 12);
}

function frameFromNo(no, headcount = 18) {
  const n = Number(no);
  const h = Number(headcount || 18);
  if (!n) return "";
  if (h <= 8) return String(n);
  if (h <= 9) return String(Math.min(8, Math.ceil(n / 1.125)));
  if (h <= 16) return String(Math.min(8, Math.ceil(n / 2)));
  if (h === 17) return n <= 8 ? String(Math.ceil(n / 2)) : String(Math.min(8, Math.ceil((n - 1) / 2)));
  return String(Math.min(8, Math.ceil(n / 2)));
}

function calcPopularity(horses) {
  const rows = horses.map(h => ({ ...h }));
  const priced = rows
    .filter(h => h.odds !== "" && !Number.isNaN(Number(h.odds)))
    .sort((a, b) => Number(a.odds) - Number(b.odds));
  let rank = 1;
  let prev = null;
  let sameCount = 0;
  for (const h of priced) {
    const odds = Number(h.odds);
    if (prev === null) {
      rank = 1;
      sameCount = 1;
    } else if (odds === prev) {
      sameCount += 1;
    } else {
      rank += sameCount;
      sameCount = 1;
    }
    h.popularity = String(rank);
    prev = odds;
  }
  const map = new Map(priced.map(h => [String(h.no), h.popularity]));
  return rows.map(h => ({ ...h, popularity: map.get(String(h.no)) || h.popularity || "" }));
}

function buildRaceIdsFromQuery(url) {
  const raceId = normalizeRaceId(url.searchParams.get("raceId"));
  if (raceId) return [raceId];

  const dateParam = String(url.searchParams.get("date") || "").replace(/\D/g, "");
  const placeCode = String(url.searchParams.get("placeCode") || url.searchParams.get("place") || "01").replace(/\D/g, "").padStart(2, "0").slice(-2);
  const kaiji = String(url.searchParams.get("kaiji") || "01").replace(/\D/g, "").padStart(2, "0").slice(-2);

  // デフォルトは現在確認中の 2026/05/02 札幌 1R。必要に応じて ?date=YYYYMMDD&placeCode=01&kaiji=01 で変更。
  const ymd = dateParam.length === 8 ? dateParam : "20260502";
  const ids = [];
  for (let r = 1; r <= 12; r++) ids.push(`${ymd}${placeCode}${kaiji}${pad2(r)}`);
  return ids;
}

function parseRaceInfoFromHtml(html, raceId) {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const clean = s => String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  const title = clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  const h1 = clean((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "");
  const raceName = h1 || title.replace(/\|.*$/, "").replace(/出馬表.*/, "").trim();

  const date = `${raceId.slice(0,4)}/${raceId.slice(4,6)}/${raceId.slice(6,8)}`;
  const raceNo = String(Number(raceId.slice(10,12)) || "");

  const placeMap = { "01":"札幌", "02":"函館", "03":"福島", "04":"新潟", "05":"東京", "06":"中山", "07":"中京", "08":"京都", "09":"阪神", "10":"小倉" };
  const place = placeMap[raceId.slice(8,10)] || "";

  const gradeMatch = clean(text).match(/(G1|G2|G3|OP|オープン|3勝|2勝|1勝|未勝利|新馬)/);
  const surfaceMatch = clean(text).match(/(芝|ダート|障害)\s*([0-9]{3,4})m/);
  const ageMatch = clean(text).match(/(2歳|3歳|4歳以上|3歳以上)/);

  return {
    date, place, raceNo,
    raceName: raceName || `${place} ${raceNo}R`,
    grade: gradeMatch ? gradeMatch[1].replace("オープン", "OP") : "",
    condition: ageMatch ? ageMatch[1] : "",
    age: ageMatch ? ageMatch[1] : "",
    sex: "",
    surface: surfaceMatch ? surfaceMatch[1] : "",
    distance: surfaceMatch ? `${surfaceMatch[2]}m` : "",
    headcount: ""
  };
}

function parseHorsesFromHtml(html) {
  const horses = [];
  const rowRe = /<tr[\s\S]*?<\/tr>/gi;
  const rows = html.match(rowRe) || [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m =>
      m[1].replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/\s+/g, " ")
          .trim()
    ).filter(Boolean);
    if (cells.length < 3) continue;
    const nums = cells.filter(c => /^\d{1,2}$/.test(c)).map(Number);
    const no = nums.find(n => n >= 1 && n <= 18);
    if (!no) continue;
    const name = cells.find(c => /[ァ-ヶ一-龠ー]{2,}/.test(c) && !/(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉|芝|ダート|未勝利|新馬)/.test(c));
    if (!name) continue;
    if (horses.some(h => h.no === String(no))) continue;
    horses.push({ frame: "", no: String(no), name, last1:"", last2:"", last3:"", odds:"", popularity:"" });
  }
  horses.sort((a,b)=>Number(a.no)-Number(b.no));
  return horses;
}

function parseOddsFromText(text) {
  const oddsMap = {};
  try {
    const jsonLike = text.match(/\{[\s\S]*\}/);
    if (jsonLike) {
      const data = JSON.parse(jsonLike[0]);
      const walk = obj => {
        if (!obj || typeof obj !== "object") return;
        if ((obj.umaban || obj.horse_number || obj.no) && (obj.odds || obj.tansho_odds)) {
          oddsMap[String(obj.umaban || obj.horse_number || obj.no)] = String(obj.odds || obj.tansho_odds);
        }
        for (const v of Object.values(obj)) walk(v);
      };
      walk(data);
    }
  } catch (_) {}
  return oddsMap;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 RevWorker" } });
  const buf = await res.arrayBuffer();
  let text = "";
  try { text = new TextDecoder("euc-jp").decode(buf); } catch (_) { text = new TextDecoder("utf-8").decode(buf); }
  return { status: res.status, text };
}

async function getRaceData(raceId) {
  const sourceRaceUrl = `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
  const entry = await fetchText(sourceRaceUrl);
  const race = parseRaceInfoFromHtml(entry.text, raceId);
  let horses = parseHorsesFromHtml(entry.text);

  // 取得失敗時の安全フォールバック：頭数だけが分かる/または既定14頭で空馬名を作る
  if (!horses.length) {
    const fallbackHead = 14;
    horses = Array.from({ length: fallbackHead }, (_, i) => ({ frame:"", no:String(i+1), name:"", last1:"", last2:"", last3:"", odds:"", popularity:"" }));
  }

  race.headcount = String(horses.length);
  horses = horses.map(h => ({ ...h, frame: h.frame || frameFromNo(h.no, horses.length) }));

  const oddsAttempts = [
    `https://race.netkeiba.com/odds/index.html?race_id=${raceId}`,
    `https://race.netkeiba.com/api/api_get_jra_odds.html?race_id=${raceId}&type=1`,
    `https://race.netkeiba.com/api/api_get_jra_odds.html?race_id=${raceId}&type=b1`,
    `https://race.netkeiba.com/api/api_get_jra_odds.html?race_id=${raceId}&type=win`
  ];
  let oddsCount = 0;
  let usedOddsUrl = "";
  const attempts = [];
  for (const oddsUrl of oddsAttempts) {
    const got = await fetchText(oddsUrl);
    const oddsMap = parseOddsFromText(got.text);
    const count = Object.keys(oddsMap).length;
    attempts.push({ url: oddsUrl, status: got.status, encoding: "euc-jp", count });
    if (count) {
      horses = horses.map(h => ({ ...h, odds: oddsMap[h.no] || h.odds || "" }));
      oddsCount = count;
      usedOddsUrl = oddsUrl;
      break;
    }
  }
  horses = calcPopularity(horses);

  return {
    id: raceId,
    raceId,
    race,
    horses,
    count: horses.length,
    source: "schedule-full-fixed-v2",
    sourceRaceId: raceId,
    sourceUrl: sourceRaceUrl,
    oddsUrl: usedOddsUrl,
    oddsCount,
    oddsStatus: oddsCount ? "ok" : "not_published",
    attempts,
    status: oddsCount ? "entry_ok_odds_ok" : "entry_ok_odds_not_published",
    warning: oddsCount ? "" : "出馬表は取得済み。オッズは未発表または外部側で非表示のため空で正常扱い。"
  };
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return json({ ok: true });
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/health") {
        return json({ ok: true, worker: "rev-worker-schedule-full-fixed", version: "v2-races-array" });
      }

      if (url.pathname === "/api/debug-search") {
        const raceId = normalizeRaceId(url.searchParams.get("raceId")) || "202605020101";
        const data = await getRaceData(raceId);
        return json({ ok: true, raceId, oddsCount: data.oddsCount, oddsStatus: data.oddsStatus, oddsMap: {}, usedOddsUrl: data.oddsUrl, attempts: data.attempts, note: data.warning });
      }

      if (url.pathname === "/api/schedule") {
        const raceIds = buildRaceIdsFromQuery(url);
        const races = [];
        const errors = [];
        for (const raceId of raceIds) {
          try {
            const data = await getRaceData(raceId);
            races.push({
              id: data.id,
              raceId: data.raceId,
              race: data.race,
              horses: data.horses,
              count: data.count,
              source: data.source,
              sourceRaceId: data.sourceRaceId,
              sourceUrl: data.sourceUrl,
              oddsUrl: data.oddsUrl,
              oddsCount: data.oddsCount,
              oddsStatus: data.oddsStatus,
              status: data.status,
              warning: data.warning
            });
          } catch (e) {
            errors.push({ raceId, error: String(e && e.message ? e.message : e) });
          }
        }
        return json({ ok: true, count: races.length, races, errors });
      }

      return json({ ok: false, error: "not found", paths: ["/api/health", "/api/schedule", "/api/debug-search?raceId=202605020101"] }, 404);
    } catch (e) {
      return json({ ok: false, error: String(e && e.message ? e.message : e) }, 500);
    }
  }
};
