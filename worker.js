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
  } catch {
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

function extractOddsMap(html) {
  const map = {};

  const dataRows =
    html.match(/data-odds=["'][0-9]+\.[0-9]["'][\s\S]{0,300}?data-horse-num=["'][0-9]+["']/gi) || [];

  for (const row of dataRows) {
    const odds = row.match(/data-odds=["']([0-9]+\.[0-9])["']/i)?.[1];
    const no = row.match(/data-horse-num=["']([0-9]+)["']/i)?.[1];
    if (odds && no) map[no] = odds;
  }

  const rows = String(html || "").match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const row of rows) {
    const no =
      row.match(/Umaban[^>]*>\s*([1-9]|1[0-8])\s*</i)?.[1] ||
      row.match(/Horse_Num[^>]*>\s*([1-9]|1[0-8])\s*</i)?.[1];

    if (!no) continue;

    const odds =
      row.match(/Odds[^>]*>\s*([0-9]{1,3}\.[0-9])\s*</i)?.[1] ||
      row.match(/Popular[^>]*>\s*([0-9]{1,3}\.[0-9])\s*</i)?.[1] ||
      row.match(/data-odds=["']([0-9]{1,3}\.[0-9])["']/i)?.[1];

    if (odds) {
      const v = Number(odds);
      if (Number.isFinite(v) && v >= 1.0 && v <= 500) {
        map[no] = v.toFixed(1);
      }
    }
  }

  return map;
}

function parseHorses(html) {
  const oddsMap = extractOddsMap(html);
  const rows = String(html || "").match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const horses = [];

  for (const row of rows) {
    const nameMatch =
      row.match(/<a[^>]*href=["'][^"']*\/horse\/\d+\/?[^"']*["'][^>]*>([^<]+)<\/a>/i) ||
      row.match(/HorseName[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i) ||
      row.match(/Horse_Name[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);

    if (!nameMatch) continue;

    const no =
      row.match(/Umaban[^>]*>\s*([1-9]|1[0-8])\s*</i)?.[1] ||
      row.match(/Horse_Num[^>]*>\s*([1-9]|1[0-8])\s*</i)?.[1];

    if (!no) continue;
    if (horses.some(h => h.no === no)) continue;

    const frame =
      row.match(/Waku[^>]*>\s*([1-8])\s*</i)?.[1] ||
      row.match(/Frame[^>]*>\s*([1-8])\s*</i)?.[1] ||
      String(Math.ceil(Number(no) / 2));

    horses.push({
      frame,
      no,
      name: normalize(stripHtml(nameMatch[1])),
      last1: "",
      last2: "",
      last3: "",
      odds: oddsMap[no] || "",
      popularity: ""
    });
  }

  return setPopularity(horses.sort((a, b) => Number(a.no) - Number(b.no)));
}

function setPopularity(horses) {
  horses.forEach(h => {
    h.popularity = "";
  });

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

function pickDebugSnippets(html) {
  const text = String(html || "");
  const keys = [
    "Odds",
    "odds",
    "Popular",
    "Umaban",
    "Horse_Num",
    "HorseName",
    "data-odds",
    "data-horse-num",
    "/horse/"
  ];

  const snippets = {};

  for (const key of keys) {
    const idx = text.indexOf(key);
    if (idx >= 0) {
      snippets[key] = text.slice(Math.max(0, idx - 500), Math.min(text.length, idx + 1200));
    } else {
      snippets[key] = "";
    }
  }

  const rows = text.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const horseRows = rows
    .filter(r => /\/horse\/\d+/.test(r))
    .slice(0, 3)
    .map(r => r.slice(0, 2500));

  return { snippets, horseRows };
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    const url = new URL(request.url);
    const raceId = url.searchParams.get("raceId") || "202605020101";
    const targetUrl = `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;

    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({
        ok: true,
        service: "rev-worker-schedule-full",
        mode: "debug-html-enabled",
        endpoints: ["/api/schedule", "/api/debug-html?raceId=202605020101"]
      }), { headers });
    }

    if (url.pathname === "/api/debug-html") {
      const html = await fetchHtml(targetUrl);
      const debug = pickDebugSnippets(html);
      const oddsMap = extractOddsMap(html);
      const horses = parseHorses(html);

      return new Response(JSON.stringify({
        ok: true,
        raceId,
        targetUrl,
        htmlLength: html.length,
        hasOddsText: /Odds|odds|Popular|data-odds/i.test(html),
        oddsMap,
        parsedCount: horses.length,
        parsedSample: horses.slice(0, 5),
        debug
      }), { headers });
    }

    if (url.pathname === "/api/schedule") {
      const html = await fetchHtml(targetUrl);
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
