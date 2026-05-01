const headers = {
  "content-type": "application/json;charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

const PLACES = [
  { code: "01", name: "札幌" },
  { code: "02", name: "函館" },
  { code: "03", name: "福島" },
  { code: "04", name: "新潟" },
  { code: "05", name: "東京" },
  { code: "06", name: "中山" },
  { code: "07", name: "中京" },
  { code: "08", name: "京都" },
  { code: "09", name: "阪神" },
  { code: "10", name: "小倉" }
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
  return `${s.slice(0,4)}/${s.slice(4,6)}/${s.slice(6,8)}`;
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

function stripHtml(html) {
  return String(html || "")
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
    if (m && m[1]) return m[1];
  }

  return fallback;
}

function parseHorses(html) {
  const horses = [];
  const rows = String(html || "").match(/<tr[\s\S]*?<\/tr>/gi) || [];

  for (const row of rows) {
    if (!/HorseName|Umaban|Waku|馬名/.test(row)) continue;

    const rowText = stripHtml(row);

    const noMatch =
      row.match(/Umaban[^>]*>\s*([1-9]|1[0-8])\s*</i) ||
      row.match(/Horse_Num[^>]*>\s*([1-9]|1[0-8])\s*</i) ||
      rowText.match(/\b([1-9]|1[0-8])\b/);

    const frameMatch =
      row.match(/Waku[^>]*>\s*([1-8])\s*</i) ||
      row.match(/Frame[^>]*>\s*([1-8])\s*</i);

    const nameMatch =
      row.match(/HorseName[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i) ||
      row.match(/Horse_Name[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i) ||
      row.match(/\/horse\/\d+[^>]*>([^<]+)<\/a>/i);

    const oddsMatch =
      row.match(/Odds[^>]*>\s*([0-9.]+)\s*</i) ||
      rowText.match(/\b([1-9]\d{0,2}\.\d)\b/);

    if (!noMatch || !nameMatch) continue;

    const no = String(noMatch[1]).trim();
    const name = stripHtml(nameMatch[1]);
    const frame = frameMatch ? String(frameMatch[1]) : String(Math.ceil(Number(no) / 2));

    if (!name || horses.some(h => h.no === no)) continue;

    horses.push({
      frame,
      no,
      name,
      last1: "",
      last2: "",
      last3: "",
      odds: oddsMatch ? String(oddsMatch[1]) : "",
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

function makeRaceIds(dateObj) {
  const ymd = ymdCompact(dateObj);
  const ids = [];

  for (const place of PLACES) {
    for (let r = 1; r <= 12; r++) {
      ids.push({
        raceId: `${ymd}${place.code}${pad2(r)}`,
        place
      });
    }
  }

  return ids;
}

async function parseRace(item) {
  const raceId = item.raceId;
  const place = item.place;
  const raceNo = Number(raceId.slice(10, 12));
  const date = raceId.slice(0, 8);

  const shutubaUrl = `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
  const html = await fetchHtml(shutubaUrl);
  const text = stripHtml(html);

  const horses = parseHorses(html);

  if (!horses.length) return null;

  return {
    id: `${ymdSlashFromCompact(date)}_${place.name}_${pad2(raceNo)}`,
    race: {
      date: ymdSlashFromCompact(date),
      place: place.name,
      raceNo: String(raceNo),
      raceName: getRaceName(text, `${place.name}${raceNo}R`),
      grade: getGrade(text),
      condition: getCondition(text),
      age: getAge(text),
      sex: getSex(text),
      surface: getSurface(text),
      distance: getDistance(text),
      headcount: String(horses.length)
    },
    horses,
    source: "netkeiba-auto-sjis",
    sourceRaceId: raceId,
    sourceUrl: shutubaUrl
  };
}

async function getSchedule() {
  const [sat, sun] = nextWeekend();
  const items = [...makeRaceIds(sat), ...makeRaceIds(sun)];
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
        mode: "netkeiba-auto-sjis",
        endpoints: ["/api/schedule"]
      }), { headers });
    }

    if (url.pathname === "/api/schedule") {
      const races = await getSchedule();

      return new Response(JSON.stringify({
        ok: true,
        count: races.length,
        generatedAt: new Date().toISOString(),
        source: "netkeiba-auto-sjis",
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
