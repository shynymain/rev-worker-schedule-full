以下を rev-worker-schedule-full の worker.js に全部上書きしてください。
JavaScript
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

function ymdSlash(s) {
  return `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6, 8)}`;
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
      cacheTtl: 300,
      cacheEverything: true
    }
  });

  const buf = await res.arrayBuffer();

  try {
    return new TextDecoder("shift_jis").decode(buf);
  } catch (_) {
    return new TextDecoder("utf-8").decode(buf);
  }
}

function normalizeText(v) {
  return String(v || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(v) {
  return normalizeText(
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
  return normalizeText(stripHtml(v))
    .replace(/[^\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFFa-zA-Z0-9ー・ヴァ-ヶ]/g, "")
    .trim();
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
    if (m && m[1]) return normalizeText(m[1]);
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

function pickOdds(row) {
  const patterns = [
    /<td[^>]*class=["'][^"']*Odds[^"']*["'][^>]*>\s*([0-9]+(?:\.[0-9]+)?)\s*</i,
    /<span[^>]*class=["'][^"']*Odds[^"']*["'][^>]*>\s*([0-9]+(?:\.[0-9]+)?)\s*</i,
    /Odds[^>]*>\s*([0-9]+(?:\.[0-9]+)?)\s*</i,
    /<td[^>]*data-odds=["']([0-9]+(?:\.[0-9]+)?)["']/i,
    /<span[^>]*>\s*([0-9]+(?:\.[0-9]+)?)\s*<\/span>/i,
    />([0-9]+\.[0-9]+)<\/td>/i
  ];

  for (const p of patterns) {
    const m = row.match(p);
    if (m && m[1] && !Number.isNaN(Number(m[1]))) {
      const value = String(m[1]);
      if (Number(value) > 0) return value;
    }
  }

  return "";
}

function parseHorses(html) {
  const horses = [];
  const rows = String(html || "").match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const row of rows) {
    const nameMatch =
      row.match(/<a[^>]*href=["']\/horse\/\d+\/?["'][^>]*>([^<]+)<\/a>/i) ||
      row.match(/HorseName[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i) ||
      row.match(/Horse_Name[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);

    if (!nameMatch) continue;

    const noMatch =
      row.match(/<td[^>]*class=["'][^"']*Umaban[^"']*["'][^>]*>\s*([1-9]|1[0-8])\s*</i) ||
      row.match(/<td[^>]*class=["'][^"']*Horse_Num[^"']*["'][^>]*>\s*([1-9]|1[0-8])\s*</i);

    if (!noMatch) continue;

    const frameMatch =
      row.match(/<td[^>]*class=["'][^"']*Waku[^"']*["'][^>]*>\s*([1-8])\s*</i) ||
      row.match(/<td[^>]*class=["'][^"']*Frame[^"']*["'][^>]*>\s*([1-8])\s*</i);

    const no = String(noMatch[1]);
    const name = cleanName(nameMatch[1]);
    const frame = frameMatch ? String(frameMatch[1]) : String(Math.ceil(Number(no) / 2));

    const pickedOdds = pickOdds(row);
    const odds = pickedOdds && !Number.isNaN(Number(pickedOdds)) ? String(pickedOdds) : "";

    if (!name || horses.some(h => h.no === no)) continue;

    horses.push({
      frame,
      no,
      name,
      last1: "",
      last2: "",
      last3: "",
      odds,
      popularity: ""
    });
  }

  return addPopularity(horses.sort((a, b) => Number(a.no) - Number(b.no)));
}

function addPopularity(horses) {
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

function makeRaceItems(dateObj) {
  const date = ymdCompact(dateObj);
  const items = [];

  for (const [code, place] of PLACES) {
    for (let r = 1; r <= 12; r++) {
      items.push({
        raceId: `${date}${code}${pad2(r)}`,
        date,
        place,
        raceNo: r
      });
    }
  }

  return items;
}

async function parseRace(item) {
  const url = `https://race.netkeiba.com/race/shutuba.html?race_id=${item.raceId}`;
  const html = await fetchHtml(url);
  const text = stripHtml(html);
  const horses = parseHorses(html);

  if (!horses.length) return null;

  return {
    id: `${ymdSlash(item.date)}_${item.place}_${pad2(item.raceNo)}`,
    race: {
      date: ymdSlash(item.date),
      place: item.place,
      raceNo: String(item.raceNo),
      raceName: getRaceName(text, `${item.place}${item.raceNo}R`),
      grade: getGrade(text),
      condition: getCondition(text),
      age: getAge(text),
      sex: getSex(text),
      surface: getSurface(text),
      distance: getDistance(text),
      headcount: String(horses.length)
    },
    horses,
    source: "netkeiba-dom-fixed-odds-safe",
    sourceRaceId: item.raceId,
    sourceUrl: url
  };
}

async function getSchedule() {
  const [sat, sun] = nextWeekend();
  const items = [...makeRaceItems(sat), ...makeRaceItems(sun)];
  const races = [];

  for (const item of items) {
    try {
      const race = await parseRace(item);
      if (race) races.push(race);
    } catch (_) {}
  }

  return races;
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({
        ok: true,
        service: "rev-worker-schedule-full",
        mode: "netkeiba-dom-fixed-odds-safe",
        endpoints: ["/api/schedule"]
      }), { headers });
    }

    if (url.pathname === "/api/schedule") {
      const races = await getSchedule();

      return new Response(JSON.stringify({
        ok: true,
        count: races.length,
        generatedAt: new Date().toISOString(),
        source: "netkeiba-dom-fixed-odds-safe",
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
