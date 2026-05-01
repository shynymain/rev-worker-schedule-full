const headers = {
  "content-type": "application/json;charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

function ymd(d){
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const day=String(d.getDate()).padStart(2,'0');
  return `${y}/${m}/${day}`;
}
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function nextWeekend(base){
  const day=base.getDay(); // 0 Sun, 6 Sat
  const toSat = day === 6 ? 0 : (6 - day + 7) % 7;
  const sat = addDays(base, toSat);
  const sun = addDays(sat, 1);
  return [sat, sun];
}
function gradeFor(raceNo){
  if(raceNo===11) return "G3";
  if(raceNo===10) return "OP";
  if(raceNo===9) return "3勝";
  if(raceNo===8) return "2勝";
  return "1勝";
}
function surfaceFor(raceNo){ return raceNo<=4 ? "ダート" : "芝"; }
function distanceFor(raceNo){
  const list = {1:"1200m",2:"1400m",3:"1600m",4:"1800m",5:"1600m",6:"1800m",7:"2000m",8:"1400m",9:"1800m",10:"2000m",11:"2400m",12:"1600m"};
  return list[raceNo] || "1600m";
}
function ageFor(raceNo){ return raceNo<=6 ? "3歳" : "4歳以上"; }
function raceName(place, raceNo, dateIndex){
  const special = {
    8:"特別戦", 9:"条件特別", 10:"オープン特別", 11: dateIndex===0 ? "メインステークス" : "重賞ステークス", 12:"最終特別"
  };
  return `${place}${special[raceNo] || `${raceNo}R`}`;
}
function headcountFor(raceNo, placeIndex, dateIndex){
  const n = 12 + ((raceNo + placeIndex + dateIndex) % 7);
  return String(Math.min(18, n));
}
function makeHorses(headcount, raceNo){
  const names = ["アルファスター","ブリッジロード","クラウンミスト","ダイヤグレイス","エメラルドラン","ファイブライン","グランノート","ハヤテソング","イーストベル","ジャスパールート","キングアロー","ルミナスコード","ミライフォース","ノーブルサイン","オメガリバー","プライムギア","クイーンパレス","ロードフェイス"];
  const horses=[];
  for(let i=1;i<=Number(headcount);i++){
    const odds = Math.max(1.4, ((i*1.7 + raceNo*0.6) % 32) + 1.2).toFixed(1);
    horses.push({
      frame: String(Math.ceil(i/2)),
      no: String(i),
      name: names[(i+raceNo-2)%names.length],
      last1: String(((i+raceNo)%9)+1),
      last2: String(((i*2+raceNo)%9)+1),
      last3: String(((i*3+raceNo)%9)+1),
      odds
    });
  }
  return horses;
}
function makeRaces(){
  const now = new Date();
  const [sat,sun] = nextWeekend(now);
  const dates=[sat,sun];
  const places=["東京","京都","新潟"];
  const races=[];
  dates.forEach((d,di)=>{
    places.forEach((place,pi)=>{
      for(let raceNo=1; raceNo<=12; raceNo++){
        const headcount=headcountFor(raceNo,pi,di);
        const id=`${ymd(d).replaceAll('/','-')}_${place}_${String(raceNo).padStart(2,'0')}`;
        races.push({
          id,
          race:{
            date: ymd(d), place, raceNo:String(raceNo), raceName: raceName(place,raceNo,di),
            grade: gradeFor(raceNo), condition: ageFor(raceNo), age: ageFor(raceNo),
            surface: surfaceFor(raceNo), distance: distanceFor(raceNo), headcount
          },
          horses: makeHorses(headcount,raceNo),
          source:"schedule-worker-full-generated"
        });
      }
    });
  });
  return races;
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(JSON.stringify({ ok:true }), { headers });
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/api/health") {
      return new Response(JSON.stringify({ ok:true, service:"rev-schedule-worker-full", endpoints:["/api/schedule"] }), { headers });
    }
    if (url.pathname !== "/api/schedule") {
      return new Response(JSON.stringify({ ok:false, error:"not found", path:url.pathname }), { status:404, headers });
    }
    const races = makeRaces();
    return new Response(JSON.stringify({ ok:true, count:races.length, generatedAt:new Date().toISOString(), races }), { headers });
  }
};
