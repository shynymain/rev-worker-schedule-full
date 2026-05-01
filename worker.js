const headers = {
  "content-type": "application/json;charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

// --- 共通fetch（ブロック回避ヘッダ） ---
async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Accept": "text/html",
      "Accept-Language": "ja-JP,ja;q=0.9",
      "Referer": "https://race.netkeiba.com/"
    },
    cf: { cacheTtl: 300, cacheEverything: true }
  });
  return await res.text();
}

// --- レースID生成（当日分まとめ） ---
function makeRaceIds(dateStr = "20260502") {
  const places = ["01","02","03","04","05","06","07","08","09","10"]; // 場コード
  const races = [];
  for (const p of places) {
    for (let r = 1; r <= 12; r++) {
      const raceId = `${dateStr}${p}${String(r).padStart(2,"0")}`;
      races.push(raceId);
    }
  }
  return races;
}

// --- 出馬表パース ---
function parseHorses(html) {
  const horses = [];
  const rows = html.split("<tr");

  for (const row of rows) {
    if (!row.includes("HorseName")) continue;

    const name = (row.match(/HorseName.*?>(.*?)</) || [])[1] || "";
    const no   = (row.match(/<td class="Num">(\d+)</) || [])[1] || "";
    const frame= (row.match(/<td class="Waku">(\d+)</) || [])[1] || "";

    if (name) {
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
  }
  return horses;
}

// --- レース情報簡易 ---
function makeRaceMeta(raceId) {
  return {
    date: `${raceId.slice(0,4)}/${raceId.slice(4,6)}/${raceId.slice(6,8)}`,
    place: "", // 必要なら後で強化
    raceNo: String(Number(raceId.slice(-2))),
    raceName: "",
    grade: "",
    condition: "",
    age: "",
    sex: "",
    surface: "",
    distance: "",
    headcount: ""
  };
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    const url = new URL(request.url);

    // --- health ---
    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({
        ok: true,
        service: "rev-schedule-full",
        mode: "full-auto",
        endpoints: ["/api/schedule"]
      }), { headers });
    }

    // --- schedule ---
    if (url.pathname === "/api/schedule") {

      const raceIds = makeRaceIds(); // ←日付変えればOK
      const races = [];

      for (const raceId of raceIds) {
        try {
          const url = `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
          const html = await fetchHtml(url);

          const horses = parseHorses(html);

          // 1頭も取れなければスキップ（未開催など）
          if (!horses.length) continue;

          races.push({
            id: raceId,
            race: makeRaceMeta(raceId),
            horses,
            source: "netkeiba-auto"
          });

        } catch (e) {
          // 無視して次へ
        }
      }

      return new Response(JSON.stringify({
        ok: true,
        count: races.length,
        races
      }), { headers });
    }

    return new Response(JSON.stringify({ ok:false, error:"not found"}), { status:404, headers });
  }
};
