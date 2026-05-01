const headers = {
  "content-type": "application/json;charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

function normalize(v) {
  return String(v || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "text/html",
      "Accept-Language": "ja-JP,ja;q=0.9",
      "Referer": "https://race.netkeiba.com/"
    }
  });

  const buf = await res.arrayBuffer();

  try {
    return new TextDecoder("shift_jis").decode(buf);
  } catch (_) {
    return new TextDecoder("utf-8").decode(buf);
  }
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
    .replace(/[^\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFFa-zA-Z0-9ー・ヴァ-ヶ]/g, "")
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

function pickOddsFromRow(row) {
  const patterns = [
    /<td[^>]*class=["'][^"']*(?:Odds|Txt_R|Popular)[^"']*["'][^>]*>\s*([0-9]{1,3}\.[0-9])\s*</i,
    /<span[^>]*class=["'][^"']*(?:Odds|Txt_R|Popular)[^"']*["'][^>]*>\s*([0-9]{1,3}\.[0-9])\s*</i,
    /data-odds=["']([0-9]{1,3}\.[0-9])["']/i,
    /odds[^0-9]{0,20}([0-9]{1,3}\.[0-9])/i
  ];

  for (const p of patterns) {
    const m = row.match(p);
    if (!m || !m[1]) continue;

    const v = Number(m[1]);
    if (Number.isFinite(v) && v >= 1.1 && v <= 500) {
      return v.toFixed(1);
    }
  }

  return "";
}

function extractOddsMap(html) {
  const map = {};

  const oddsArea =
    html.match(/<table[^>]*(?:Shutuba_Table|RaceTable|HorseList)[\s\S]*?<\/table>/i)?.[0] ||
    html;

  const rows = oddsArea.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const row of rows) {
    const no =
      pickNumber(row, "Umaban", 1, 18) ||
      pickNumber(row, "Horse_Num", 1, 18);

    if (!no) continue;

    const odds = pickOddsFromRow(row);
    if (odds) map[no] = odds;
  }

  return map;
}

function parseHorses(html) {
  const oddsMap = extractOddsMap(html);
  const rows = String(html || "").match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const horses = [];

  for (const row of rows) {
    const nameMatch =
      row.match(/<a[^>]*href=["']\/horse\/\d+\/?["'][^>]*>([^<]+)<\/a>/i) ||
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

    const odds = oddsMap[no] || pickOddsFromRow(row) || "";

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

  return setPopularityPerfect(horses.sort((a, b) => Number(a.no) - Number(b.no)));
}

function setPopularityPerfect(horses) {
  horses.forEach(h => {
    h.popularity = "";
  });

  const valid = horses
    .map(h => ({ h, odds: Number(h.odds) }))
    .filter(x => Number.isFinite(x.odds) && x.odds >= 1.1 && x.odds <= 500)
    .sort((a, b) => a.odds - b.odds);

  if (!valid.length) return horses;

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
        mode: "odds-perfect-popularity-perfect",
        endpoints: ["/api/schedule"]
      }), { headers });
    }

    if (url.pathname === "/api/schedule") {
      const raceId = url.searchParams.get("raceId") || "202605020101";
      const html = await fetchHtml(`https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`);
      const horses = parseHorses(html);

      return new Response(JSON.stringify({
        ok: true,
        raceId,
        count: horses.length,
        horses
      }), { headers });
    }

    return new Response(JSON.stringify({
      ok: false,
      error: "not found",
      path: url.pathname
    }), { status: 404, headers });
  }
};
