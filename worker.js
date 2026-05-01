export default {
  async fetch(request) {

    const headers = {
      "content-type": "application/json;charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type"
    };

    if (request.method === "OPTIONS") {
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({
        ok: true,
        service: "rev-worker-schedule-full",
        mode: "FINAL-SJIS-ODDS-FIX-DEPLOY",
        endpoints: [
          "/api/health",
          "/api/schedule?raceId=202605020101",
          "/api/debug-html?raceId=202605020101&type=shutuba",
          "/api/debug-html?raceId=202605020101&type=odds"
        ]
      }), { headers });
    }

    if (url.pathname === "/api/debug-html") {
      const raceId = url.searchParams.get("raceId") || "202605020101";
      const type = url.searchParams.get("type") || "shutuba";
      const targetUrl = type === "odds"
        ? `https://race.netkeiba.com/odds/index.html?race_id=${raceId}`
        : `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;

      const html = await fetchSjis(targetUrl);
      return new Response(JSON.stringify({
        ok: true,
        raceId,
        type,
        targetUrl,
        htmlLength: html.length,
        hasHorseList: /HorseList|HorseName|Umaban|horse\//i.test(html),
        hasOddsText: /Odds|odds|TanOdds|Ninki|人気/i.test(html),
        sample: html.slice(0, 5000)
      }), { headers });
    }

    if (url.pathname !== "/api/schedule") {
      return new Response(JSON.stringify({
        ok: false,
        error: "not found",
        path: url.pathname
      }), { status: 404, headers });
    }

    const raceId = url.searchParams.get("raceId") || "202605020101";

    const shutubaUrl = `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
    const oddsUrl = `https://race.netkeiba.com/odds/index.html?race_id=${raceId}`;

    const shutubaHtml = await fetchSjis(shutubaUrl);
    const oddsHtml = await fetchSjis(oddsUrl);

    const horses = parseHorses(shutubaHtml);
    const oddsMap = parseOddsMap(oddsHtml);

    horses.forEach(h => {
      const o = oddsMap[h.no];
      if (o) h.odds = o;
    });

    setPopularity(horses);

    const date = raceId.slice(0, 8);
    const place = placeName(raceId.slice(8, 10));
    const raceNo = Number(raceId.slice(10, 12));

    const race = {
      id: `${ymdSlash(date)}_${place}_${String(raceNo).padStart(2, "0")}`,
      race: {
        date: ymdSlash(date),
        place,
        raceNo: String(raceNo),
        raceName: `${place}${raceNo}R`,
        grade: extractGrade(shutubaHtml),
        condition: extractCondition(shutubaHtml),
        age: extractAge(shutubaHtml),
        sex: /牝/.test(shutubaHtml) ? "牝馬" : "混合",
        surface: extractSurface(shutubaHtml),
        distance: extractDistance(shutubaHtml),
        headcount: String(horses.length)
      },
      horses,
      source: "netkeiba-shutuba-plus-odds-final-deploy",
      sourceRaceId: raceId,
      sourceUrl: shutubaUrl,
      oddsUrl,
      oddsCount: Object.keys(oddsMap).length
    };

    return new Response(JSON.stringify({
      ok: true,
      raceId,
      count: horses.length,
      race,
      horses,
      oddsCount: Object.keys(oddsMap).length
    }), { headers });
  }
};

async function fetchSjis(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "ja-JP,ja;q=0.9,en;q=0.8",
      "referer": "https://race.netkeiba.com/"
    }
  });

  const buf = await res.arrayBuffer();
  try {
    return new TextDecoder("shift_jis").decode(buf);
  } catch (_) {
    return new TextDecoder("utf-8").decode(buf);
  }
}

function normalize(v) {
  return String(v || "")
    .normalize("NFKC")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanName(v) {
  return normalize(v)
    .replace(/[^$B$!-(B$B$s(B$B%!-(B$B%v(B$B0l-(B$B龯(Ba-zA-Z0-9ー・ヴァ-ヶ]/g, "")
    .trim();
}

function parseHorses(html) {
  const rows = String(html || "").match(/<tr[^>]*class=["'][^"']*HorseList[^"']*["'][^>]*>[\s\S]*?<\/tr>/gi)
    || String(html || "").match(/<tr[^>]*>[\s\S]*?\/horse\/\d+[\s\S]*?<\/tr>/gi)
    || [];

  const horses = [];

  for (const row of rows) {
    const no =
      row.match(/class=["'][^"']*Umaban[^"']*["'][^>]*>\s*([1-9]|1[0-8])\s*</i)?.[1] ||
      row.match(/class=["'][^"']*Horse_Num[^"']*["'][^>]*>\s*([1-9]|1[0-8])\s*</i)?.[1] ||
      "";

    const nameRaw =
      row.match(/<span[^>]*class=["'][^"']*HorseName[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ||
      row.match(/<a[^>]*href=["'][^"']*\/horse\/\d+[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] ||
      "";

    if (!no || !nameRaw) continue;

    const frame =
      row.match(/class=["'][^"']*Waku[^"']*["'][^>]*>\s*([1-8])\s*</i)?.[1] ||
      String(Math.ceil(Number(no) / 2));

    const name = cleanName(nameRaw);
    if (!name || name.length < 2) continue;
    if (horses.some(h => h.no === no)) continue;

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

function parseOddsMap(html) {
  const map = {};
  const text = String(html || "");

  const rows = text.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const row of rows) {
    const no =
      row.match(/class=["'][^"']*Umaban[^"']*["'][^>]*>\s*([1-9]|1[0-8])\s*</i)?.[1] ||
      row.match(/data-horse-num=["']([1-9]|1[0-8])["']/i)?.[1] ||
      row.match(/data-umaban=["']([1-9]|1[0-8])["']/i)?.[1] ||
      "";

    if (!no) continue;

    const odds =
      row.match(/class=["'][^"']*(?:Odds|TanOdds|odds)[^"']*["'][^>]*>\s*([0-9]{1,3}\.[0-9])\s*</i)?.[1] ||
      row.match(/data-odds=["']([0-9]{1,3}\.[0-9])["']/i)?.[1] ||
      row.match(/(?:odds|Odds)[^0-9]{0,80}([0-9]{1,3}\.[0-9])/i)?.[1] ||
      "";

    if (validOdds(odds)) map[no] = Number(odds).toFixed(1);
  }

  // Fallback: race.netkeiba sometimes embeds odds in JS arrays/objects.
  const jsPairs = [
    ...text.matchAll(/["'](?:umaban|horse_number|horseNo|num)["']\s*:\s*["']?([1-9]|1[0-8])["']?[\s\S]{0,180}?["'](?:odds|tan_odds|win_odds)["']\s*:\s*["']?([0-9]{1,3}\.[0-9])["']?/gi),
    ...text.matchAll(/["'](?:odds|tan_odds|win_odds)["']\s*:\s*["']?([0-9]{1,3}\.[0-9])["']?[\s\S]{0,180}?["'](?:umaban|horse_number|horseNo|num)["']\s*:\s*["']?([1-9]|1[0-8])["']?/gi)
  ];

  for (const m of jsPairs) {
    let no, odds;
    if (validOdds(m[2])) { no = m[1]; odds = m[2]; }
    else if (validOdds(m[1])) { no = m[2]; odds = m[1]; }
    if (no && odds) map[no] = Number(odds).toFixed(1);
  }

  return map;
}

function validOdds(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1.0 && n <= 500;
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

function ymdSlash(s) {
  return `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6, 8)}`;
}

function placeName(code) {
  return {
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
  }[code] || "";
}

function extractSurface(html) {
  const t = normalize(html);
  if (/芝/.test(t)) return "芝";
  if (/ダート|ダ/.test(t)) return "ダート";
  return "";
}

function extractDistance(html) {
  const t = normalize(html);
  const m = t.match(/(?:芝|ダート|ダ)\s*(\d{3,4})m?/);
  return m ? `${m[1]}m` : "";
}

function extractGrade(html) {
  const t = normalize(html);
  if (/G1|Ｇ１|GI/.test(t)) return "G1";
  if (/G2|Ｇ２|GII/.test(t)) return "G2";
  if (/G3|Ｇ３|GIII/.test(t)) return "G3";
  if (/リステッド|Listed|L\b/.test(t)) return "L";
  if (/オープン|OP/.test(t)) return "OP";
  if (/3勝/.test(t)) return "3勝";
  if (/2勝/.test(t)) return "2勝";
  if (/1勝/.test(t)) return "1勝";
  if (/未勝利/.test(t)) return "未勝利";
  if (/新馬/.test(t)) return "新馬";
  return "";
}

function extractAge(html) {
  const t = normalize(html);
  if (/4歳以上/.test(t)) return "4歳以上";
  if (/3歳以上/.test(t)) return "3歳以上";
  if (/3歳/.test(t)) return "3歳";
  if (/2歳/.test(t)) return "2歳";
  return "";
}

function extractCondition(html) {
  const t = normalize(html);
  if (/ハンデ/.test(t)) return "ハンデ";
  if (/別定/.test(t)) return "別定";
  if (/定量/.test(t)) return "定量";
  return "";
}
